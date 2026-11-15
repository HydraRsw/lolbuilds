package main

import "time"

// fetchGuide reads OP.GG's comp detail (getTftCompDetailAction) and keeps the
// parts the app shows: final-board variants, situational units, the level-up
// timeline (stage, rolls and common units per level), item priority per unit
// and the key components.
func (t *tftService) fetchGuide(actionID, deckID string, gen map[string]any, region string, window any) (map[string]any, error) {
	r, data, err := t.callAction(actionID, map[string]any{"deckId": deckID, "generation": gen, "region": region, "tier": "PLATINUM+", "window": window, "locale": "en"})
	if err != nil {
		return nil, err
	}
	g := mapOf(r.val(data["guide"]))
	if g == nil {
		return nil, nil
	}
	key := func(v any) string { return str(mapOf(r.val(v))["key"]) }
	itemKeys := func(v any) []string {
		var out []string
		for _, iv := range asList(r.val(v)) {
			switch it := r.val(iv).(type) {
			case map[string]any:
				if k := str(it["key"]); k != "" {
					out = append(out, k)
				}
			case string:
				if it != "" && it[0] != '$' {
					out = append(out, it)
				}
			}
		}
		return out
	}
	out := map[string]any{}

	var variants []any
	for _, vv := range asList(r.val(g["variants"])) {
		v := mapOf(r.val(vv))
		if v == nil {
			continue
		}
		var units []any
		for _, uv := range asList(r.val(v["units"])) {
			u := mapOf(r.val(uv))
			if u == nil || str(u["key"]) == "" {
				continue
			}
			units = append(units, map[string]any{"key": str(u["key"]), "tier": r.val(u["star"]), "items": itemKeys(u["items"])})
		}
		var added, removed []string
		for _, a := range asList(r.val(v["addedUnits"])) {
			added = append(added, key(a))
		}
		for _, a := range asList(r.val(v["removedUnits"])) {
			removed = append(removed, key(a))
		}
		variants = append(variants, map[string]any{
			"base": str(v["role"]) == "base", "share": r.val(v["share"]), "count": r.val(v["count"]), "avg": r.val(v["avgPlacement"]),
			"level": r.val(v["level"]), "units": units, "added": added, "removed": removed,
		})
	}
	if variants != nil {
		out["variants"] = variants
	}

	var situ []any
	for _, sv := range asList(r.val(g["situationalUnits"])) {
		s := mapOf(r.val(sv))
		if k := key(s["unit"]); k != "" {
			situ = append(situ, map[string]any{"key": k, "share": r.val(s["share"]), "count": r.val(s["count"]), "avg": r.val(s["avgPlacement"])})
		}
	}
	if situ != nil {
		out["situational"] = situ
	}

	if tl := mapOf(r.val(g["timeline"])); tl != nil && tl["available"] == true {
		var lv []any
		for _, lvv := range asList(r.val(tl["levels"])) {
			l := mapOf(r.val(lvv))
			if l == nil {
				continue
			}
			var units []any
			for _, uv := range asList(r.val(l["units"])) {
				u := mapOf(r.val(uv))
				if k := key(u["unit"]); k != "" {
					units = append(units, map[string]any{"key": k, "rate": r.val(u["appearanceRate"])})
				}
			}
			lv = append(lv, map[string]any{"level": r.val(l["level"]), "stage": str(l["stage"]), "rolls": r.val(l["averageRolls"]),
				"count": r.val(l["count"]), "winRate": r.val(l["roundWinRate"]), "units": units})
		}
		if lv != nil {
			out["timeline"] = lv
		}
	}

	var prio []any
	for _, pv := range asList(r.val(g["itemPriority"])) {
		p := mapOf(r.val(pv))
		k := key(p["unit"])
		if k == "" {
			continue
		}
		e := map[string]any{"unit": k, "priority": r.val(p["priority"])}
		for _, grp := range []string{"core", "important", "optional", "artifact", "radiant"} {
			var list []any
			for _, iv := range asList(r.val(p[grp])) {
				it := mapOf(r.val(iv))
				ik := key(it["item"])
				if ik == "" {
					continue
				}
				list = append(list, map[string]any{"item": ik, "delta": r.val(it["delta"]), "hold": r.val(it["holdRate"]), "avg": r.val(it["avgPlacement"])})
			}
			if list != nil {
				e[grp] = list
			}
		}
		prio = append(prio, e)
	}
	if prio != nil {
		out["itemPriority"] = prio
	}

	var comps []any
	for _, cv := range asList(r.val(g["coreComponents"])) {
		c := mapOf(r.val(cv))
		if k := key(c["item"]); k != "" {
			comps = append(comps, map[string]any{"key": k, "copies": r.val(c["copies"])})
		}
	}
	if comps != nil {
		out["components"] = comps
	}
	if len(out) == 0 {
		return nil, nil
	}
	out["fetchedAt"] = time.Now().Format(time.RFC3339)
	return out, nil
}
