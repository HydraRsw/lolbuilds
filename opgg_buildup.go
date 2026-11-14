package main

import (
	"encoding/json"
	"fmt"
	"log"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// OP.GG "Progresión": boards actually played at levels 4..9 for each comp. The
// page loads them with a Next.js server action (getTftCompBuildUpAction); we call
// it the same way. Its id changes when OP.GG deploys, so we look it up in their
// scripts, and the request needs the data "generation" shown on the comps page.

var (
	scriptSrcRe   = regexp.MustCompile(`<script[^>]+src="([^"]+/_next/static/chunks/[^"]+\.js)"`)
	buildUpIDRe   = regexp.MustCompile(`"([0-9a-f]{40,44})",\w+\.callServer,void 0,\w+\.findSourceMapURL,"getTftCompBuildUpAction"`)
	buildUpMu     sync.Mutex
	buildUpID     string
	buildUpIDAt   time.Time
	buildUpTimout = 90 * time.Second
)

func (t *tftService) buildUpActionID(html []byte) (string, error) {
	buildUpMu.Lock()
	defer buildUpMu.Unlock()
	if buildUpID != "" && time.Since(buildUpIDAt) < 6*time.Hour {
		return buildUpID, nil
	}
	srcs := scriptSrcRe.FindAllSubmatch(html, -1)
	// the comps code is usually in one of the last chunks: search from the end
	for i := len(srcs) - 1; i >= 0; i-- {
		u := string(srcs[i][1])
		if strings.HasPrefix(u, "/") {
			u = "https://op.gg" + u
		}
		b, err := t.p.download(u, map[string]string{"Accept": "*/*"})
		if err != nil {
			continue
		}
		if m := buildUpIDRe.FindSubmatch(b); m != nil {
			buildUpID, buildUpIDAt = string(m[1]), time.Now()
			return buildUpID, nil
		}
	}
	return "", fmt.Errorf("getTftCompBuildUpAction not found in %d scripts", len(srcs))
}

// pageGeneration finds {"filters":{...},"generation":{...}} in the comps page.
func pageGeneration(r rsc) (gen map[string]any, region string, window any) {
	region, window = "global", 72
	var walk func(v any, depth int) bool
	walk = func(v any, depth int) bool {
		if depth > 30 {
			return false
		}
		switch x := v.(type) {
		case map[string]any:
			if g, ok := x["generation"].(map[string]any); ok && g["runId"] != nil {
				gen = g
				if f, ok := x["filters"].(map[string]any); ok {
					if s, ok := f["region"].(string); ok {
						region = s
					}
					if f["window"] != nil {
						window = f["window"]
					}
				}
				return true
			}
			for _, c := range x {
				if walk(c, depth+1) {
					return true
				}
			}
		case []any:
			for _, c := range x {
				if walk(c, depth+1) {
					return true
				}
			}
		}
		return false
	}
	for _, row := range r {
		if walk(row, 0) {
			break
		}
	}
	return
}

type lvlBoard struct {
	Level   int              `json:"level"`
	Units   []map[string]any `json:"units"`
	Traits  []map[string]any `json:"traits,omitempty"`
	Play    float64          `json:"play"`
	WinRate float64          `json:"winRate"`
	Alts    int              `json:"alts,omitempty"` // other boards seen at this level
}

func (t *tftService) fetchBuildUp(actionID, deckID string, gen map[string]any, region string, window any) ([]lvlBoard, error) {
	arg := []any{map[string]any{"deckId": deckID, "generation": gen, "region": region, "window": window, "locale": "en"}}
	body, _ := json.Marshal(arg)
	b, err := t.p.post(opggCompsURL, body, map[string]string{
		"Next-Action": actionID, "Accept": "text/x-component", "Content-Type": "text/plain;charset=UTF-8",
	})
	if err != nil {
		return nil, err
	}
	r := rowsFromStream(string(b))
	var res map[string]any
	for _, row := range r {
		if m, ok := row.(map[string]any); ok && m["data"] != nil {
			res = m
		}
	}
	if res == nil || res["ok"] != true {
		return nil, fmt.Errorf("unexpected build-up reply")
	}
	data := mapOf(res["data"])
	byLevel := map[int][]lvlBoard{}
	for _, bv := range asList(r.val(data["boards"])) {
		bd := mapOf(r.val(bv))
		if bd == nil {
			continue
		}
		lv := int(num(bd["level"]))
		lb := lvlBoard{Level: lv, Play: num(bd["play"]), WinRate: num(bd["winRate"])}
		for _, uv := range asList(r.val(bd["units"])) {
			u := mapOf(r.val(uv))
			if u == nil || str(u["key"]) == "" {
				continue
			}
			nu := map[string]any{"key": str(u["key"]), "tier": r.val(u["star"])}
			if c := mapOf(r.val(u["cell"])); c != nil && c["x"] != nil {
				nu["cell"] = map[string]any{"x": c["x"], "y": c["y"]}
			}
			var items []any
			for _, iv := range asList(r.val(u["items"])) {
				switch it := r.val(iv).(type) {
				case map[string]any:
					if k := str(it["key"]); k != "" {
						items = append(items, k)
					}
				case string:
					if !strings.HasPrefix(it, "$") {
						items = append(items, it)
					}
				}
			}
			if items != nil {
				nu["items"] = items
			}
			lb.Units = append(lb.Units, nu)
		}
		for _, tv := range asList(r.val(bd["traits"])) {
			tr := mapOf(r.val(tv))
			if tr == nil || str(tr["key"]) == "" {
				continue
			}
			lb.Traits = append(lb.Traits, map[string]any{"key": str(tr["key"]), "numUnits": r.val(tr["count"]), "style": r.val(tr["style"]),
				"meta": map[string]any{"name": str(tr["name"]), "imageUrl": str(tr["imageUrl"])}})
		}
		if lv > 0 && len(lb.Units) > 0 {
			byLevel[lv] = append(byLevel[lv], lb)
		}
	}
	var out []lvlBoard
	for lv, list := range byLevel {
		// OP.GG shows the most played board of each level first
		sort.SliceStable(list, func(i, j int) bool { return list[i].Play > list[j].Play })
		best := list[0]
		best.Alts = len(list) - 1
		out = append(out, best)
		_ = lv
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Level < out[j].Level })
	return out, nil
}

// addBuildUps fills d["levels"] for every deck (6 at a time, bounded in time).
func (t *tftService) addBuildUps(html []byte, decks []map[string]any) (int, error) {
	id, err := t.buildUpActionID(html)
	if err != nil {
		return 0, err
	}
	gen, region, window := pageGeneration(parseRSC(html))
	if gen == nil {
		return 0, fmt.Errorf("generation not found")
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	sem := make(chan struct{}, 6)
	deadline := time.Now().Add(buildUpTimout)
	ok := 0
	var lastErr error
	for _, d := range decks {
		d := d
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			if time.Now().After(deadline) {
				return
			}
			lv, err := t.fetchBuildUp(id, str(d["id"]), gen, region, window)
			for try := 0; err != nil && try < 2 && time.Now().Before(deadline); try++ {
				time.Sleep(time.Duration(800*(try+1)) * time.Millisecond)
				lv, err = t.fetchBuildUp(id, str(d["id"]), gen, region, window)
			}
			if err != nil {
				log.Printf("op.gg build-up %s: %v", str(d["id"]), err)
			}
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				lastErr = err
				return
			}
			if len(lv) > 0 {
				d["levels"] = lv
				fillFinalCells(d, lv)
				ok++
			}
		}()
	}
	wg.Wait()
	if ok == 0 && lastErr != nil {
		// the action id may have changed: look it up again next time
		buildUpMu.Lock()
		buildUpID = ""
		buildUpMu.Unlock()
		return 0, lastErr
	}
	return ok, nil
}

// fillFinalCells positions the final board's units like in the most played late
// board (highest level first) when OP.GG did not send positions.
func fillFinalCells(d map[string]any, lv []lvlBoard) {
	units := asList(d["units"])
	taken := map[string]bool{}
	for _, uv := range units {
		if c := mapOf(mapOf(uv)["cell"]); c != nil {
			taken[jsonKey(c)] = true
		}
	}
	for i := len(lv) - 1; i >= 0; i-- {
		for _, uv := range units {
			u := mapOf(uv)
			if u["cell"] != nil {
				continue
			}
			for _, bu := range lv[i].Units {
				if bu["key"] == u["key"] && bu["cell"] != nil && !taken[jsonKey(bu["cell"])] {
					u["cell"] = bu["cell"]
					taken[jsonKey(bu["cell"])] = true
					break
				}
			}
		}
	}
}
