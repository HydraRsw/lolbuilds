package main

import (
	"encoding/json"
	"regexp"
	"strings"
)

// OP.GG's comps page (format "v2", Nov 2026) embeds a React Server Components
// stream: rows "<hex id>:<json>". Comps live in an object with a "comps" array;
// many fields are references like "$6c:props:children:props:data:items:116"
// (row 6c, then a path where "props" is the 4th entry of a React element).
// This file turns those comps into the deck shape the UI already uses.

type rsc map[string]any

var rscRowRe = regexp.MustCompile(`^([0-9a-f]+):(.*)$`)
var rscRefRe = regexp.MustCompile(`^\$[0-9a-f]+(:|$)`)

func parseRSC(html []byte) rsc {
	var stream strings.Builder
	for _, m := range nextChunkRe.FindAllSubmatch(html, -1) {
		var s string
		if json.Unmarshal(append(append([]byte{'"'}, m[1]...), '"'), &s) == nil {
			stream.WriteString(s)
		}
	}
	rows := rsc{}
	for _, line := range strings.Split(stream.String(), "\n") {
		m := rscRowRe.FindStringSubmatch(line)
		if m == nil || m[2] == "" || !strings.ContainsAny(m[2][:1], "[{\"") {
			continue
		}
		var v any
		if json.Unmarshal([]byte(m[2]), &v) == nil {
			rows[m[1]] = v
		}
	}
	return rows
}

// ref resolves one "$id:path" reference (following nested references).
func (r rsc) ref(s string, depth int) any {
	if depth > 8 || !rscRefRe.MatchString(s) {
		return s
	}
	parts := strings.Split(s[1:], ":")
	var o any = r[parts[0]]
	for _, k := range parts[1:] {
		switch x := o.(type) {
		case []any:
			if k == "props" && len(x) >= 4 && x[0] == "$" {
				o = x[3]
				break
			}
			i := 0
			for _, c := range k {
				if c < '0' || c > '9' {
					return nil
				}
				i = i*10 + int(c-'0')
			}
			if i >= len(x) {
				return nil
			}
			o = x[i]
		case map[string]any:
			o = x[k]
		default:
			return nil
		}
		if str, ok := o.(string); ok && rscRefRe.MatchString(str) {
			o = r.ref(str, depth+1)
		}
	}
	return o
}

func (r rsc) val(v any) any {
	if s, ok := v.(string); ok {
		return r.ref(s, 0)
	}
	return v
}

func (r rsc) findComps() []any {
	var found []any
	var walk func(v any, depth int)
	walk = func(v any, depth int) {
		if found != nil || depth > 40 {
			return
		}
		switch x := v.(type) {
		case map[string]any:
			if arr, ok := x["comps"].([]any); ok && len(arr) > 0 {
				if c, ok := arr[0].(map[string]any); ok && c["teamCode"] != nil {
					found = arr
					return
				}
			}
			for _, c := range x {
				walk(c, depth+1)
			}
		case []any:
			for _, c := range x {
				walk(c, depth+1)
			}
		}
	}
	for _, row := range r {
		walk(row, 0)
	}
	return found
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

func num(v any) float64 {
	f, _ := v.(float64)
	return f
}

// compsV2 parses one page into decks keyed by id, in page order.
func compsV2(html []byte) ([]map[string]any, map[string]map[string]any) {
	r := parseRSC(html)
	byID := map[string]map[string]any{}
	var out []map[string]any
	for _, cv := range r.findComps() {
		c, ok := r.val(cv).(map[string]any)
		if !ok {
			continue
		}
		d := convertV2(c, r)
		if id := str(d["id"]); id != "" && byID[id] == nil {
			byID[id] = d
			out = append(out, d)
		}
	}
	return out, byID
}

func convertV2(c map[string]any, r rsc) map[string]any {
	var units []any
	for _, uv := range asList(r.val(c["units"])) {
		u, ok := r.val(uv).(map[string]any)
		if !ok {
			continue
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
		if items == nil {
			items = []any{}
		}
		var cell any
		if m, ok := r.val(u["cell"]).(map[string]any); ok && m["x"] != nil {
			cell = map[string]any{"x": m["x"], "y": m["y"]}
		}
		star := r.val(u["star"])
		if star == nil {
			star = r.val(u["observedStar"])
		}
		units = append(units, map[string]any{
			"key": str(u["key"]), "items": items, "tier": star, "cell": cell,
			"isCore": u["isCore"] == true, "priority": u["priority"], "role": u["role"],
			"meta": map[string]any{"apiName": str(u["key"]), "name": str(u["name"]), "imageUrl": str(u["imageUrl"]), "cost": u["cost"]},
		})
	}
	var traits []any
	for _, tv := range asList(r.val(c["traits"])) {
		t, ok := r.val(tv).(map[string]any)
		if !ok {
			continue
		}
		traits = append(traits, map[string]any{
			"key": str(t["key"]), "style": r.val(t["style"]), "numUnits": r.val(t["count"]),
			"meta": map[string]any{"name": str(t["name"]), "imageUrl": str(t["imageUrl"])},
		})
	}
	st, _ := r.val(c["stats"]).(map[string]any)
	if st == nil {
		st = map[string]any{}
	}
	reroll := r.val(c["strategyLevel"])
	if reroll == nil {
		reroll = r.val(c["level"])
	}
	var reqs []any
	for _, bv := range asList(r.val(c["requirementBadges"])) {
		b, ok := r.val(bv).(map[string]any)
		if !ok {
			continue
		}
		reqs = append(reqs, map[string]any{
			"type": str(b["type"]), "key": str(b["key"]), "imageUrl": str(b["imageUrl"]),
			"name": map[string]any{}, "description": str(b["description"]), "_name": str(b["name"]),
		})
	}
	return map[string]any{
		"id": str(c["id"]), "name": map[string]any{}, "_name": str(c["name"]),
		"cost": c["cost"], "teamCode": str(c["teamCode"]),
		"units": units, "traits": traits,
		"badge": []any{
			map[string]any{"key": "difficulty", "value": r.val(c["difficulty"])},
			map[string]any{"key": "reroll", "value": reroll},
			map[string]any{"key": "isReroll", "value": r.val(c["isReroll"])},
		},
		"stat": map[string]any{
			"opTier": str(st["tier"]), "opScore": st["score"],
			"deck": map[string]any{
				"avgPlacement": st["avgPlacement"], "winRate": st["winRate"], "top4Rate": st["top4Rate"],
				"pickRate": st["pickRate"], "compsCount": st["count"],
			},
		},
		"requirements": reqs,
	}
}

func asList(v any) []any {
	l, _ := v.([]any)
	return l
}

// setNames fills the per-language names (comp and requirement) from one page.
func setNames(decks map[string]map[string]any, lang string, from map[string]map[string]any) {
	for id, d := range decks {
		src := from[id]
		if src == nil {
			src = d
		}
		if n := str(src["_name"]); n != "" {
			d["name"].(map[string]any)[lang] = n
		}
		sreqs := asList(src["requirements"])
		for i, rv := range asList(d["requirements"]) {
			rq := rv.(map[string]any)
			name := str(rq["_name"])
			if i < len(sreqs) {
				if s, ok := sreqs[i].(map[string]any); ok && s["key"] == rq["key"] && str(s["_name"]) != "" {
					name = str(s["_name"])
				}
			}
			if name != "" {
				rq["name"].(map[string]any)[lang] = name
			}
		}
	}
}

func cleanupV2(d map[string]any) {
	delete(d, "_name")
	for _, rv := range asList(d["requirements"]) {
		delete(rv.(map[string]any), "_name")
	}
}

// mergeBoards copies early/mid boards and positions from the most similar deck
// of another source (the OP.GG MCP list still has them) into decks without them.
func mergeBoards(decks []map[string]any, donors []map[string]any) int {
	merged := 0
	for _, d := range decks {
		keys := map[string]bool{}
		units := asList(d["units"])
		for _, uv := range units {
			keys[str(uv.(map[string]any)["key"])] = true
		}
		var best map[string]any
		bestN := 0
		for _, o := range donors {
			n := 0
			for _, uv := range asList(o["units"]) {
				if u, ok := uv.(map[string]any); ok && keys[str(u["key"])] {
					n++
				}
			}
			if str(o["teamCode"]) == str(d["teamCode"]) {
				n += 100
			}
			if n > bestN {
				best, bestN = o, n
			}
		}
		min := len(units) - 2
		if min > 6 {
			min = 6
		}
		if best == nil || bestN < min {
			continue
		}
		if e, ok := best["early"].(map[string]any); ok && len(asList(e["units"])) > 0 && len(asList(mapOf(d["early"])["units"])) == 0 {
			d["early"] = e
		}
		if m, ok := best["middle"].(map[string]any); ok && len(asList(m["units"])) > 0 && len(asList(mapOf(d["middle"])["units"])) == 0 {
			d["middle"] = m
		}
		taken := map[string]bool{}
		cellOf := map[string]any{}
		for _, uv := range asList(best["units"]) {
			if u, ok := uv.(map[string]any); ok && u["cell"] != nil {
				cellOf[str(u["key"])] = u["cell"]
			}
		}
		for _, uv := range units {
			if c := mapOf(uv.(map[string]any)["cell"]); c != nil {
				taken[jsonKey(c)] = true
			}
		}
		for _, uv := range units {
			u := uv.(map[string]any)
			if u["cell"] != nil {
				continue
			}
			if c := mapOf(cellOf[str(u["key"])]); c != nil && !taken[jsonKey(c)] {
				u["cell"] = c
				taken[jsonKey(c)] = true
			}
		}
		merged++
	}
	return merged
}

func mapOf(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func jsonKey(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
