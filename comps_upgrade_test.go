package main

import (
	"os"
	"strings"
	"testing"
	"time"
)

func TestOldCompsListIsRebuilt(t *testing.T) {
	p := &proxy{cacheDir: t.TempDir()}
	_ = os.WriteFile(p.keyPath("tft:comps:v3"), []byte(`{"decks":[],"source":"op.gg-v2"}`), 0o644)
	ts := &tftService{p: p}
	calls := 0
	b, _ := p.cached("tft:comps:v3", time.Hour, false, true, func() ([]byte, error) { calls++; return nil, nil })
	if strings.Contains(string(b), compsSchema) || calls != 0 {
		t.Fatal("setup")
	}
	// handler logic: stale schema triggers a background rebuild
	if !strings.Contains(string(b), compsSchema) && ts.upgrading.CompareAndSwap(false, true) {
		go func() {
			defer ts.upgrading.Store(false)
			_, _ = p.refresh("tft:comps:v3", true, func() ([]byte, error) { return []byte(`{"schema":3,"decks":[]}`), nil })
		}()
	}
	time.Sleep(100 * time.Millisecond)
	nb, _ := p.cached("tft:comps:v3", time.Hour, false, true, func() ([]byte, error) { return nil, nil })
	if !strings.Contains(string(nb), compsSchema) {
		t.Fatalf("not rebuilt: %s", nb)
	}
}
