package main

import (
	"os"
	"sync/atomic"
	"testing"
	"time"
)

func TestCachedServesStaleThenRefreshes(t *testing.T) {
	p := &proxy{cacheDir: t.TempDir()}
	var calls atomic.Int32
	slow := func() ([]byte, error) { calls.Add(1); time.Sleep(300 * time.Millisecond); return []byte("new"), nil }
	_ = os.WriteFile(p.keyPath("k"), []byte("old"), 0o644)
	past := time.Now().Add(-time.Hour)
	_ = os.Chtimes(p.keyPath("k"), past, past)
	start := time.Now()
	b, err := p.cached("k", time.Minute, false, false, slow)
	if err != nil || string(b) != "old" || time.Since(start) > 100*time.Millisecond {
		t.Fatalf("expected immediate stale copy, got %q %v in %v", b, err, time.Since(start))
	}
	time.Sleep(500 * time.Millisecond)
	if b, _ := os.ReadFile(p.keyPath("k")); string(b) != "new" || calls.Load() != 1 {
		t.Fatalf("background refresh did not run: %q calls=%d", b, calls.Load())
	}
	// no cache at all: waits for produce
	b, _ = p.cached("other", time.Minute, false, false, func() ([]byte, error) { return []byte("x"), nil })
	if string(b) != "x" {
		t.Fatal("produce")
	}
}
