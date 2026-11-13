package main

import (
	"encoding/json"
	"net/http"
	"net/url"
	"sort"
)

// TFT match history from the local client (same data as the client's profile).
func (l *lcu) handleTFTHistory(w http.ResponseWriter, r *http.Request) {
	var me struct {
		PUUID string `json:"puuid"`
	}
	if _, err := l.do("GET", "/lol-summoner/v1/current-summoner", nil, &me); err != nil || me.PUUID == "" {
		msg := "cliente de LoL no detectado"
		if err == nil {
			msg = "no hay sesión iniciada en el cliente"
		}
		writeJSON(w, 503, map[string]string{"error": msg})
		return
	}
	var raw struct {
		Games []json.RawMessage `json:"games"`
	}
	path := "/lol-match-history/v1/products/tft/" + url.PathEscape(me.PUUID) + "/matches?begin=0&count=20"
	if _, err := l.do("GET", path, nil, &raw); err != nil {
		writeJSON(w, 502, map[string]string{"error": err.Error()})
		return
	}
	type unit struct {
		ID    string   `json:"id"`
		Tier  int      `json:"tier"`
		Items []string `json:"items"`
	}
	type trait struct {
		Name  string `json:"name"`
		Units int    `json:"units"`
		Style int    `json:"style"`
	}
	type game struct {
		Date      int64    `json:"date"`
		Queue     int      `json:"queue"`
		Placement int      `json:"placement"`
		Level     int      `json:"level"`
		Augments  []string `json:"augments"`
		Traits    []trait  `json:"traits"`
		Units     []unit   `json:"units"`
	}
	var out []game
	for _, gr := range raw.Games {
		var wrap struct {
			JSON json.RawMessage `json:"json"`
		}
		body := []byte(gr)
		if json.Unmarshal(gr, &wrap) == nil && len(wrap.JSON) > 0 {
			body = wrap.JSON
		}
		var g struct {
			Date         int64 `json:"game_datetime"`
			Queue        int   `json:"queue_id"`
			Participants []struct {
				PUUID     string   `json:"puuid"`
				Placement int      `json:"placement"`
				Level     int      `json:"level"`
				Augments  []string `json:"augments"`
				Traits    []struct {
					Name     string `json:"name"`
					NumUnits int    `json:"num_units"`
					Style    int    `json:"style"`
				} `json:"traits"`
				Units []struct {
					CharacterID string   `json:"character_id"`
					Tier        int      `json:"tier"`
					ItemNames   []string `json:"itemNames"`
				} `json:"units"`
			} `json:"participants"`
		}
		if json.Unmarshal(body, &g) != nil {
			continue
		}
		for _, p := range g.Participants {
			if p.PUUID != me.PUUID {
				continue
			}
			ng := game{Date: g.Date, Queue: g.Queue, Placement: p.Placement, Level: p.Level, Augments: p.Augments}
			for _, t := range p.Traits {
				ng.Traits = append(ng.Traits, trait{t.Name, t.NumUnits, t.Style})
			}
			for _, u := range p.Units {
				ng.Units = append(ng.Units, unit{u.CharacterID, u.Tier, u.ItemNames})
			}
			out = append(out, ng)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Date > out[j].Date })
	writeJSON(w, 200, map[string]any{"games": out})
}
