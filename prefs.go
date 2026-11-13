package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// prefs holds settings that every window of the app must share (the main
// window and the two overlay processes have separate browser storage).
type prefs struct {
	Lang      string `json:"lang,omitempty"`      // "es" | "en"; empty = follow Windows
	ClientDir string `json:"clientDir,omitempty"` // League/TFT folder chosen by the user (lockfile lookup)
}

var (
	prefsMu sync.Mutex
	prefsV  prefs
	prefsOK bool
)

func prefsPath() string { return filepath.Join(dataDir(), "prefs.json") }

func loadPrefs() prefs {
	prefsMu.Lock()
	defer prefsMu.Unlock()
	if !prefsOK {
		if b, err := os.ReadFile(prefsPath()); err == nil {
			_ = json.Unmarshal(b, &prefsV)
		}
		prefsOK = true
	}
	return prefsV
}

func handlePrefs(w http.ResponseWriter, r *http.Request) {
	p := loadPrefs()
	if r.Method == http.MethodPost {
		q := r.URL.Query()
		changed := false
		if l := q.Get("lang"); l == "es" || l == "en" {
			p.Lang, changed = l, true
		}
		if q.Has("clientDir") {
			p.ClientDir, changed = strings.TrimSpace(q.Get("clientDir")), true
		}
		if changed {
			prefsMu.Lock()
			prefsV = p
			_ = os.MkdirAll(dataDir(), 0o755)
			b, _ := json.Marshal(p)
			_ = os.WriteFile(prefsPath(), b, 0o644)
			prefsMu.Unlock()
		}
	}
	writeJSON(w, 200, p)
}
