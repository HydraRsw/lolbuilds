package main

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// lcu talks to the local League of Legends client (the "LCU" API) to detect
// champion select and to import rune pages, summoner spells and item sets.
type lcu struct {
	mu       sync.Mutex
	port     string
	password string
	client   *http.Client
	lastTry  time.Time
}

func newLCU() *lcu {
	return &lcu{client: &http.Client{
		Timeout: 4 * time.Second,
		// The client serves a self-signed certificate on 127.0.0.1 only.
		Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
	}}
}

// parseLockfile reads "name:pid:port:password:protocol".
func parseLockfile(path string) (port, pass string, ok bool) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", "", false
	}
	parts := strings.Split(strings.TrimSpace(string(b)), ":")
	if len(parts) < 5 {
		return "", "", false
	}
	return parts[2], parts[3], true
}

func (l *lcu) connect() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.port != "" {
		return true
	}
	if time.Since(l.lastTry) < 2*time.Second {
		return false
	}
	l.lastTry = time.Now()
	for _, p := range lockfileCandidates() {
		if port, pass, ok := parseLockfile(p); ok {
			l.port, l.password = port, pass
			return true
		}
	}
	return false
}

func (l *lcu) reset() {
	l.mu.Lock()
	l.port, l.password = "", ""
	l.mu.Unlock()
}

func (l *lcu) do(method, path string, body any, out any) (int, error) {
	if !l.connect() {
		return 0, fmt.Errorf("cliente de LoL no detectado")
	}
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	l.mu.Lock()
	url := "https://127.0.0.1:" + l.port + path
	pass := l.password
	l.mu.Unlock()
	req, _ := http.NewRequest(method, url, rd)
	req.SetBasicAuth("riot", pass)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := l.client.Do(req)
	if err != nil {
		l.reset() // client closed or restarted: re-read lockfile next time
		return 0, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return resp.StatusCode, fmt.Errorf("LCU %s %s: %d %s", method, path, resp.StatusCode, trunc(b, 200))
	}
	if out != nil && len(b) > 0 {
		_ = json.Unmarshal(b, out)
	}
	return resp.StatusCode, nil
}

type lcuState struct {
	Connected  bool   `json:"connected"`
	Phase      string `json:"phase"`
	ChampionID int    `json:"championId"`
	Locked     bool   `json:"locked"`
	QueueID    int    `json:"queueId"`
	Position   string `json:"position"`
}

func (l *lcu) handleState(w http.ResponseWriter, r *http.Request) {
	st := lcuState{}
	var phase string
	if _, err := l.do("GET", "/lol-gameflow/v1/gameflow-phase", nil, &phase); err != nil {
		writeJSON(w, 200, st)
		return
	}
	st.Connected, st.Phase = true, phase

	var flow struct {
		GameData struct {
			Queue struct {
				ID int `json:"id"`
			} `json:"queue"`
		} `json:"gameData"`
	}
	if _, err := l.do("GET", "/lol-gameflow/v1/session", nil, &flow); err == nil {
		st.QueueID = flow.GameData.Queue.ID
	}

	if phase == "ChampSelect" {
		var sess struct {
			LocalPlayerCellID int `json:"localPlayerCellId"`
			MyTeam            []struct {
				CellID             int    `json:"cellId"`
				ChampionID         int    `json:"championId"`
				ChampionPickIntent int    `json:"championPickIntent"`
				AssignedPosition   string `json:"assignedPosition"`
			} `json:"myTeam"`
		}
		if _, err := l.do("GET", "/lol-champ-select/v1/session", nil, &sess); err == nil {
			for _, m := range sess.MyTeam {
				if m.CellID == sess.LocalPlayerCellID {
					st.ChampionID = m.ChampionID
					if st.ChampionID == 0 {
						st.ChampionID = m.ChampionPickIntent
					}
					st.Position = m.AssignedPosition
				}
			}
		}
		var cur int
		if _, err := l.do("GET", "/lol-champ-select/v1/current-champion", nil, &cur); err == nil && cur > 0 {
			st.ChampionID, st.Locked = cur, true
		}
	}
	writeJSON(w, 200, st)
}

type runePage struct {
	Name            string `json:"name"`
	PrimaryStyleID  int    `json:"primaryStyleId"`
	SubStyleID      int    `json:"subStyleId"`
	SelectedPerkIDs []int  `json:"selectedPerkIds"`
	Current         bool   `json:"current"`
}

func (l *lcu) handleRunes(w http.ResponseWriter, r *http.Request) {
	var page runePage
	if err := json.NewDecoder(r.Body).Decode(&page); err != nil || len(page.SelectedPerkIDs) < 6 {
		writeJSON(w, 400, map[string]string{"error": "página de runas inválida"})
		return
	}
	page.Current = true
	if len(page.Name) > 25 {
		page.Name = page.Name[:25]
	}

	type existing struct {
		ID          int    `json:"id"`
		Name        string `json:"name"`
		IsDeletable bool   `json:"isDeletable"`
		IsEditable  bool   `json:"isEditable"`
		IsActive    bool   `json:"isActive"`
		Current     bool   `json:"current"`
	}
	var pages []existing
	if _, err := l.do("GET", "/lol-perks/v1/pages", nil, &pages); err != nil {
		writeJSON(w, 502, map[string]string{"error": err.Error()})
		return
	}
	// Replace a page we created before; otherwise replace the current page
	// if it is editable, like Blitz/OP.GG do.
	var victim *existing
	for i := range pages {
		if pages[i].IsDeletable && strings.HasPrefix(pages[i].Name, "LB ") {
			victim = &pages[i]
			break
		}
	}
	if victim == nil {
		for i := range pages {
			if pages[i].IsDeletable && (pages[i].Current || pages[i].IsActive) {
				victim = &pages[i]
				break
			}
		}
	}
	if victim != nil {
		_, _ = l.do("DELETE", fmt.Sprintf("/lol-perks/v1/pages/%d", victim.ID), nil, nil)
	}
	_, err := l.do("POST", "/lol-perks/v1/pages", page, nil)
	if err != nil {
		// page limit reached: free one deletable page and retry
		for _, p := range pages {
			if p.IsDeletable && (victim == nil || p.ID != victim.ID) {
				_, _ = l.do("DELETE", fmt.Sprintf("/lol-perks/v1/pages/%d", p.ID), nil, nil)
				_, err = l.do("POST", "/lol-perks/v1/pages", page, nil)
				break
			}
		}
	}
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (l *lcu) handleSpells(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Spell1ID int `json:"spell1Id"`
		Spell2ID int `json:"spell2Id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]string{"error": "datos inválidos"})
		return
	}
	if _, err := l.do("PATCH", "/lol-champ-select/v1/session/my-selection", body, nil); err != nil {
		writeJSON(w, 502, map[string]string{"error": "Solo se puede durante la selección de campeón"})
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// handleItemSet adds (or replaces) an item set in the client so the build
// shows up in the in-game shop under "Recommended".
func (l *lcu) handleItemSet(w http.ResponseWriter, r *http.Request) {
	var set map[string]any
	if err := json.NewDecoder(r.Body).Decode(&set); err != nil {
		writeJSON(w, 400, map[string]string{"error": "datos inválidos"})
		return
	}
	var me struct {
		SummonerID int64 `json:"summonerId"`
	}
	if _, err := l.do("GET", "/lol-summoner/v1/current-summoner", nil, &me); err != nil {
		writeJSON(w, 502, map[string]string{"error": err.Error()})
		return
	}
	path := fmt.Sprintf("/lol-item-sets/v1/item-sets/%d/sets", me.SummonerID)
	var doc map[string]any
	if _, err := l.do("GET", path, nil, &doc); err != nil || doc == nil {
		doc = map[string]any{"itemSets": []any{}}
	}
	uid, _ := set["uid"].(string)
	list, _ := doc["itemSets"].([]any)
	kept := []any{}
	for _, it := range list {
		if m, ok := it.(map[string]any); ok && m["uid"] == uid {
			continue
		}
		kept = append(kept, it)
	}
	doc["itemSets"] = append(kept, set)
	doc["timestamp"] = time.Now().UnixMilli()
	if _, err := l.do("PUT", path, doc, nil); err != nil {
		writeJSON(w, 502, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
