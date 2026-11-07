package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// tftService provides TFT meta comps (OP.GG) and the current set's static data
// (CommunityDragon, Spanish), both cached on disk.
type tftService struct{ p *proxy }

const (
	opggCompsURL = "https://op.gg/tft/meta-trends/comps"
	opggMCPURL   = "https://mcp-api.op.gg/mcp"
	cdragonTFT   = "https://raw.communitydragon.org/latest/cdragon/tft/" // + es_mx.json / en_us.json
	cdragonGame  = "https://raw.communitydragon.org/latest/game/"
)

var nextChunkRe = regexp.MustCompile(`self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)`)

func (t *tftService) handleComps(w http.ResponseWriter, r *http.Request) {
	force := r.URL.Query().Get("fresh") == "1"
	b, err := t.p.cached("tft:comps:v2", 2*time.Hour, force, true, t.produceComps)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeRawJSON(w, b)
}

func (t *tftService) produceComps() ([]byte, error) {
	decks, err := t.compsFromPage()
	source := "op.gg"
	if err != nil || len(decks) == 0 {
		decks2, err2 := t.compsFromMCP()
		if err2 != nil || len(decks2) == 0 {
			if err == nil {
				err = err2
			}
			if err == nil {
				err = fmt.Errorf("OP.GG no devolvió composiciones")
			}
			return nil, err
		}
		decks, source = decks2, "op.gg-mcp"
	} else if len(decks) > 0 && decks[0]["requirements"] != nil {
		// new page format: no early/mid boards, borrow them from the MCP list
		source = "op.gg-v2"
		if donors, err := t.compsFromMCP(); err == nil && len(donors) > 0 {
			mergeBoards(decks, donors)
		}
	}
	for _, d := range decks {
		slimDeck(d)
	}
	return json.Marshal(map[string]any{"decks": decks, "source": source, "fetchedAt": time.Now().Format(time.RFC3339)})
}

// compsFromPage reads the deck list OP.GG embeds in its comps page.
func (t *tftService) compsFromPage() ([]map[string]any, error) {
	html, err := t.p.download(opggCompsURL, map[string]string{"Accept": "text/html", "Accept-Language": "es-MX,es;q=0.9"})
	if err != nil {
		return nil, err
	}
	var stream strings.Builder
	for _, m := range nextChunkRe.FindAllSubmatch(html, -1) {
		var s string
		if json.Unmarshal(append(append([]byte{'"'}, m[1]...), '"'), &s) == nil {
			stream.WriteString(s)
		}
	}
	seen := map[string]bool{}
	var out []map[string]any
	for _, line := range strings.Split(stream.String(), "\n") {
		if !strings.Contains(line, `"opTier"`) {
			continue
		}
		if i := strings.IndexByte(line, ':'); i > 0 && i < 8 && isHex(line[:i]) {
			line = line[i+1:]
		}
		var v any
		if json.Unmarshal([]byte(line), &v) != nil {
			continue
		}
		collectDecks(v, seen, &out)
	}
	if len(out) > 0 {
		return out, nil
	}
	// format v2 (RSC references, localized strings)
	list, byID := compsV2(html)
	if len(list) == 0 {
		return nil, nil
	}
	setNames(byID, "es_MX", byID)
	// names come localized: take Spanish and English from each language's page
	for _, lp := range []struct{ lang, url, al string }{
		{"es_MX", "https://op.gg/es/tft/meta-trends/comps", "es-MX,es;q=0.9"},
		{"en_US", "https://op.gg/en/tft/meta-trends/comps", "en-US,en;q=0.9"},
	} {
		if b, err := t.p.download(lp.url, map[string]string{"Accept": "text/html", "Accept-Language": lp.al}); err == nil {
			if _, other := compsV2(b); len(other) > 0 {
				setNames(byID, lp.lang, other)
			}
		}
	}
	for _, d := range list {
		cleanupV2(d)
	}
	return list, nil
}

func isHex(s string) bool {
	for _, c := range s {
		if !strings.ContainsRune("0123456789abcdef", c) {
			return false
		}
	}
	return s != ""
}

func collectDecks(v any, seen map[string]bool, out *[]map[string]any) {
	switch x := v.(type) {
	case map[string]any:
		if x["units"] != nil && x["stat"] != nil && x["name"] != nil {
			id, _ := x["id"].(string)
			if id == "" || !seen[id] {
				seen[id] = true
				*out = append(*out, x)
			}
			return
		}
		for _, c := range x {
			collectDecks(c, seen, out)
		}
	case []any:
		for _, c := range x {
			collectDecks(c, seen, out)
		}
	}
}

// compsFromMCP is the fallback: OP.GG's public MCP server (JSON-RPC over HTTP).
func (t *tftService) compsFromMCP() ([]map[string]any, error) {
	if t.p.mock != "" {
		return nil, fmt.Errorf("mcp disabled in mock mode")
	}
	call := func(sid string, body any) (string, []byte, error) {
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest("POST", opggMCPURL, bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json, text/event-stream")
		if sid != "" {
			req.Header.Set("Mcp-Session-Id", sid)
		}
		resp, err := t.p.client.Do(req)
		if err != nil {
			return "", nil, err
		}
		defer resp.Body.Close()
		data, _ := io.ReadAll(resp.Body)
		if s := resp.Header.Get("Mcp-Session-Id"); s != "" {
			sid = s
		}
		if strings.Contains(resp.Header.Get("Content-Type"), "event-stream") {
			var buf strings.Builder
			for _, l := range strings.Split(string(data), "\n") {
				if strings.HasPrefix(l, "data:") {
					buf.WriteString(strings.TrimSpace(l[5:]))
				}
			}
			data = []byte(buf.String())
		}
		return sid, data, nil
	}
	sid, _, err := call("", map[string]any{"jsonrpc": "2.0", "id": 1, "method": "initialize",
		"params": map[string]any{"protocolVersion": "2025-06-18", "capabilities": map[string]any{}, "clientInfo": map[string]any{"name": "lolbuilds", "version": appVersion}}})
	if err != nil {
		return nil, err
	}
	_, _, _ = call(sid, map[string]any{"jsonrpc": "2.0", "method": "notifications/initialized"})
	_, data, err := call(sid, map[string]any{"jsonrpc": "2.0", "id": 2, "method": "tools/call",
		"params": map[string]any{"name": "tft_list_meta_decks", "arguments": map[string]any{}}})
	if err != nil {
		return nil, err
	}
	var rpc struct {
		Result struct {
			Content []struct {
				Text string `json:"text"`
			} `json:"content"`
		} `json:"result"`
	}
	if err := json.Unmarshal(data, &rpc); err != nil || len(rpc.Result.Content) == 0 {
		return nil, fmt.Errorf("respuesta MCP inválida")
	}
	var inner struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal([]byte(rpc.Result.Content[0].Text), &inner); err != nil {
		return nil, err
	}
	return inner.Data, nil
}

// slimDeck drops fields the UI does not use (dozens of translations, etc.).
func slimDeck(d map[string]any) {
	if n, ok := d["name"].(map[string]any); ok {
		keep := map[string]any{}
		for _, k := range []string{"es_MX", "es_ES", "en_US"} {
			if v, ok := n[k]; ok {
				keep[k] = v
			}
		}
		d["name"] = keep
	}
	if rb, ok := d["requirementBadges"].([]any); ok && d["requirements"] == nil && len(rb) > 0 {
		var reqs []any
		for _, bv := range rb {
			if b, ok := bv.(map[string]any); ok {
				name := b["name"]
				if s, ok := name.(string); ok {
					name = map[string]any{"es_MX": s}
				}
				reqs = append(reqs, map[string]any{"type": b["type"], "key": b["key"], "imageUrl": b["imageUrl"], "name": name, "description": b["description"]})
			}
		}
		d["requirements"] = reqs
	}
	delete(d, "requirementBadges")
	if st, ok := d["stat"].(map[string]any); ok {
		delete(st, "label")
	}
	if us, ok := d["units"].([]any); ok {
		for _, u := range us {
			if m, ok := u.(map[string]any); ok {
				delete(m, "itemMetas")
				if meta, ok := m["meta"].(map[string]any); ok {
					delete(meta, "unlock")
				}
			}
		}
	}
}

/* ---------------- static set data ---------------- */

func (t *tftService) handleStatic(w http.ResponseWriter, r *http.Request) {
	force := r.URL.Query().Get("fresh") == "1"
	lang := r.URL.Query().Get("lang")
	if lang != "en_us" {
		lang = "es_mx"
	}
	src := cdragonTFT + lang + ".json"
	b, err := t.p.cached("tft:static:v2:"+lang, 12*time.Hour, force, true, func() ([]byte, error) {
		raw, err := t.p.cached(src, 12*time.Hour, force, false, func() ([]byte, error) { return t.p.download(src, nil) })
		if err != nil {
			return nil, err
		}
		return compactTFT(raw)
	})
	if err != nil {
		writeErr(w, err)
		return
	}
	writeRawJSON(w, b)
}

func gameAsset(p string) string {
	if p == "" {
		return ""
	}
	p = strings.ToLower(p)
	for _, ext := range []string{".tex", ".dds"} {
		if strings.HasSuffix(p, ext) {
			p = strings.TrimSuffix(p, ext) + ".png"
		}
	}
	return cdragonGame + p
}

type cdItem struct {
	APIName     string         `json:"apiName"`
	Name        string         `json:"name"`
	Desc        string         `json:"desc"`
	Icon        string         `json:"icon"`
	Composition []string       `json:"composition"`
	Effects     map[string]any `json:"effects"`
	Tags        []string       `json:"tags"`
	IsAugment   bool           `json:"isAugment"`
	Traits      []string       `json:"associatedTraits"`
	Unique      bool           `json:"unique"`
}

func compactTFT(raw []byte) ([]byte, error) {
	var src struct {
		Items []cdItem `json:"items"`
		Sets  map[string]struct {
			Name      string `json:"name"`
			Champions []struct {
				APIName string `json:"apiName"`
				Name    string `json:"name"`
				Cost    int    `json:"cost"`
				Traits  []string
				Icon    string `json:"squareIcon"`
				Tile    string `json:"tileIcon"`
				Ability struct {
					Name      string `json:"name"`
					Desc      string `json:"desc"`
					Variables []struct {
						Name  string    `json:"name"`
						Value []float64 `json:"value"`
					} `json:"variables"`
				} `json:"ability"`
				Stats map[string]any `json:"stats"`
			} `json:"champions"`
			Traits []struct {
				APIName string `json:"apiName"`
				Name    string `json:"name"`
				Desc    string `json:"desc"`
				Icon    string `json:"icon"`
				Effects []struct {
					MinUnits  int            `json:"minUnits"`
					MaxUnits  int            `json:"maxUnits"`
					Style     int            `json:"style"`
					Variables map[string]any `json:"variables"`
				} `json:"effects"`
			} `json:"traits"`
		} `json:"sets"`
	}
	if err := json.Unmarshal(raw, &src); err != nil {
		return nil, err
	}
	setKey, setNum := "", -1
	for k := range src.Sets {
		if n, err := strconv.Atoi(k); err == nil && n > setNum {
			setNum, setKey = n, k
		}
	}
	set := src.Sets[setKey]

	type champOut struct {
		APIName string         `json:"apiName"`
		Name    string         `json:"name"`
		Cost    int            `json:"cost"`
		Traits  []string       `json:"traits"`
		Icon    string         `json:"icon"`
		Ability map[string]any `json:"ability"`
	}
	prefixCount := map[string]int{}
	var champs []champOut
	for _, c := range set.Champions {
		if c.Cost <= 0 || c.Cost > 7 || len(c.Traits) == 0 {
			continue // summons, dummies, etc.
		}
		vars := map[string]any{}
		for _, v := range c.Ability.Variables {
			if len(v.Value) > 3 {
				vars[v.Name] = v.Value[1:4] // values at 1★, 2★, 3★
			}
		}
		icon := c.Icon
		if icon == "" {
			icon = c.Tile
		}
		champs = append(champs, champOut{c.APIName, c.Name, c.Cost, c.Traits, gameAsset(icon),
			map[string]any{"name": c.Ability.Name, "desc": c.Ability.Desc, "vars": vars}})
		if i := strings.IndexByte(c.APIName, '_'); i > 0 {
			prefixCount[c.APIName[:i+1]]++
		}
	}
	sort.Slice(champs, func(i, j int) bool {
		if champs[i].Cost != champs[j].Cost {
			return champs[i].Cost < champs[j].Cost
		}
		return champs[i].Name < champs[j].Name
	})

	type traitOut struct {
		APIName string `json:"apiName"`
		Name    string `json:"name"`
		Desc    string `json:"desc"`
		Icon    string `json:"icon"`
		Effects any    `json:"effects"`
	}
	var traits []traitOut
	for _, tr := range set.Traits {
		traits = append(traits, traitOut{tr.APIName, tr.Name, tr.Desc, gameAsset(tr.Icon), tr.Effects})
	}

	// Items of the current set share the champions' apiName prefix (e.g. "DA_").
	prefix, best := "", 0
	for p, n := range prefixCount {
		if n > best {
			prefix, best = p, n
		}
	}
	type itemOut struct {
		APIName     string         `json:"apiName"`
		Name        string         `json:"name"`
		Desc        string         `json:"desc"`
		Icon        string         `json:"icon"`
		Composition []string       `json:"composition,omitempty"`
		Effects     map[string]any `json:"effects,omitempty"`
		Tags        []string       `json:"tags,omitempty"`
		Unique      bool           `json:"unique,omitempty"`
	}
	pick := func(match func(string) bool) []itemOut {
		var out []itemOut
		for _, it := range src.Items {
			if it.IsAugment || it.Name == "" || !match(it.APIName) {
				continue
			}
			out = append(out, itemOut{it.APIName, it.Name, it.Desc, gameAsset(it.Icon), it.Composition, it.Effects, it.Tags, it.Unique})
		}
		return out
	}
	items := pick(func(a string) bool { return prefix != "" && strings.HasPrefix(a, prefix) })
	if len(items) < 30 {
		items = pick(func(a string) bool { return strings.HasPrefix(a, "TFT_Item_") })
	}
	type augOut struct {
		APIName string         `json:"apiName"`
		Name    string         `json:"name"`
		Desc    string         `json:"desc"`
		Icon    string         `json:"icon"`
		Effects map[string]any `json:"effects,omitempty"`
		Traits  []string       `json:"traits,omitempty"`
	}
	var augs []augOut
	for _, it := range src.Items {
		if it.IsAugment && it.Name != "" && prefix != "" && strings.HasPrefix(it.APIName, prefix) {
			augs = append(augs, augOut{it.APIName, it.Name, it.Desc, gameAsset(it.Icon), it.Effects, it.Traits})
		}
	}
	return json.Marshal(map[string]any{
		"set": setNum, "setName": set.Name, "champions": champs, "traits": traits, "items": items, "augments": augs,
	})
}
