package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// exportTFT writes the TFT data the mobile version needs as static JSON files
// (it has no local server). Run by GitHub Actions: LoLBuilds --export-tft DIR
// Each file is optional: a source that fails keeps the previous file.
func exportTFT(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	p := &proxy{client: newProxy().client, mock: os.Getenv("LOLB_MOCK")}
	t := &tftService{p: p}
	report := map[string]string{}
	write := func(name string, b []byte, err error) {
		if err == nil && len(b) < 50 {
			err = fmt.Errorf("respuesta vacía")
		}
		if err != nil {
			report[name] = "ERROR: " + err.Error()
			return
		}
		if werr := os.WriteFile(filepath.Join(dir, name), b, 0o644); werr != nil {
			report[name] = "ERROR: " + werr.Error()
			return
		}
		report[name] = fmt.Sprintf("ok %d bytes", len(b))
	}

	b, err := t.produceComps()
	write("tft-comps.json", b, err)
	b, err = t.produceAugs()
	write("tft-augs.json", b, err)

	for _, lang := range []string{"es_mx", "en_us"} {
		raw, err := p.download(cdragonTFT+lang+".json", nil)
		if err == nil {
			raw, err = compactTFT(raw)
		}
		write("tft-static-"+lang+".json", raw, err)
	}

	const mt = "https://api-hc.metatft.com/"
	const q = "queue=1100&patch=current&days=3&permit_filter_adjustment=true"
	for name, u := range map[string]string{
		"mt-units.json":  mt + "tft-stat-api/units?" + q,
		"mt-items.json":  mt + "tft-stat-api/items?" + q,
		"mt-traits.json": mt + "tft-stat-api/traits?" + q,
		"mt-uip.json":    mt + "tft-comps-api/unit_items_processed",
	} {
		b, err := p.download(u, nil)
		write(name, b, err)
	}

	meta, _ := json.MarshalIndent(map[string]any{"updated": time.Now().UTC().Format(time.RFC3339), "files": report}, "", " ")
	_ = os.WriteFile(filepath.Join(dir, "meta.json"), meta, 0o644)
	fmt.Println(string(meta))
	if report["tft-comps.json"] != "" && report["tft-comps.json"][:2] != "ok" {
		return fmt.Errorf("no se pudieron obtener las composiciones")
	}
	return nil
}
