package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// Augments per comp: MetaTFT publishes an augment tier list (S/A/B) for each of its
// comp clusters, curated by top players. We send the cluster units (to match them
// with OP.GG comps in the UI), the per-comp tiers and the global augment tier list.

const (
	mtCompsData = "https://api-hc.metatft.com/tft-comps-api/comps_data?queue=1100"
	mtCompAugs  = "https://api-hc.metatft.com/tft-comps-api/comp_augment_tiers"
	mtAugTiers  = "https://api-hc.metatft.com/tft-stat-api/augments_tiers"
)

func (t *tftService) handleAugs(w http.ResponseWriter, r *http.Request) {
	force := r.URL.Query().Get("fresh") == "1"
	b, err := t.p.cached("tft:augs:v1", 3*time.Hour, force, true, t.produceAugs)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeRawJSON(w, b)
}

func (t *tftService) produceAugs() ([]byte, error) {
	get := func(u string, v any) error {
		b, err := t.p.download(u, nil)
		if err != nil {
			return err
		}
		return json.Unmarshal(b, v)
	}
	var tiers struct {
		Results map[string]struct {
			Augments []struct {
				ID   string `json:"id"`
				Tier string `json:"tier"`
			} `json:"augments"`
			Title string `json:"source_title"`
		} `json:"results"`
	}
	if err := get(mtCompAugs, &tiers); err != nil {
		return nil, err
	}
	var cd struct {
		Results struct {
			Data struct {
				Clusters map[string]struct {
					Units  string `json:"units_string"`
					Traits string `json:"traits_string"`
				} `json:"cluster_details"`
			} `json:"data"`
		} `json:"results"`
	}
	if err := get(mtCompsData, &cd); err != nil {
		return nil, err
	}
	clusters := map[string]any{}
	for id, c := range tiers.Results {
		info, ok := cd.Results.Data.Clusters[id]
		if !ok || len(c.Augments) == 0 {
			continue
		}
		var augs [][2]string
		for _, a := range c.Augments {
			augs = append(augs, [2]string{a.ID, a.Tier})
		}
		clusters[id] = map[string]any{"units": splitList(info.Units), "traits": splitList(info.Traits), "title": c.Title, "augs": augs}
	}
	// global tier list: augment -> [tier, position]
	global := map[string][2]any{}
	var gt struct {
		Content struct {
			Content struct {
				TierList []struct {
					Label   string `json:"label"`
					Content []struct {
						ID string `json:"id"`
					} `json:"content"`
				} `json:"tierList"`
			} `json:"content"`
		} `json:"content"`
	}
	if get(mtAugTiers, &gt) == nil {
		n := 0
		for _, tier := range gt.Content.Content.TierList {
			for _, a := range tier.Content {
				global[a.ID] = [2]any{tier.Label, n}
				n++
			}
		}
	}
	return json.Marshal(map[string]any{"clusters": clusters, "global": global, "fetchedAt": time.Now().Format(time.RFC3339)})
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
