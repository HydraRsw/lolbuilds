package main

import (
	"errors"
	"net/http"
	"os"
	"os/exec"
	"sync"
)

// The TFT overlay is two always-on-top windows, each a separate process of this
// same .exe ("LoLBuilds.exe --overlay <url> <kind>"): the comps panel and the
// horizontal recipe bar. They load their pages from this server (sharing data,
// cache and UI updates) and poll /api/overlay/state, which the global hotkeys
// registered here change.
var overlayKinds = map[string]string{"comps": "overlay.html", "recipes": "overlay-recipes.html"}

type overlayState struct {
	V         int  `json:"v"`
	Visible   bool `json:"visible"`
	ClickThru bool   `json:"clickThru"`
	Pin       string `json:"pin"` // comp pinned in the comps window (highlighted in the recipe bar)
	// recipe bar closed with its ✕ or Ctrl+Shift+C (the comps window stays)
	RecipesHidden bool `json:"recipesHidden"`
}

type overlayMgr struct {
	mu       sync.Mutex
	base     string
	cmds     map[string]*exec.Cmd
	state    overlayState
	stopKeys func()
}

func (o *overlayMgr) runningLocked() bool { return len(o.cmds) > 0 }

func (o *overlayMgr) running() bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.runningLocked()
}

func (o *overlayMgr) open() error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if !overlaySupported {
		return errOverlayUnsupported
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if o.cmds == nil {
		o.cmds = map[string]*exec.Cmd{}
	}
	if !o.runningLocked() {
		o.state = overlayState{V: o.state.V + 1, Visible: true, Pin: o.state.Pin}
	}
	for kind, page := range overlayKinds {
		if o.cmds[kind] != nil {
			continue
		}
		cmd := exec.Command(exe, "--overlay", o.base+page, kind)
		if err := cmd.Start(); err != nil {
			return err
		}
		o.cmds[kind] = cmd
		go func(kind string, cmd *exec.Cmd) {
			_ = cmd.Wait()
			o.mu.Lock()
			if o.cmds[kind] == cmd {
				delete(o.cmds, kind)
			}
			if !o.runningLocked() && o.stopKeys != nil {
				o.stopKeys()
				o.stopKeys = nil
			}
			o.mu.Unlock()
		}(kind, cmd)
	}
	if o.stopKeys == nil {
		o.stopKeys = startHotkeys(o.hotkey)
	}
	return nil
}

func (o *overlayMgr) hotkey(id int) {
	o.mu.Lock()
	defer o.mu.Unlock()
	switch id {
	case 1: // Ctrl+Shift+X: hide/show both (showing also brings back the recipe bar)
		o.state.Visible = !o.state.Visible
		if o.state.Visible {
			o.state.RecipesHidden = false
		}
	case 3: // Ctrl+Shift+C: hide/show only the recipe bar
		if !o.state.Visible {
			o.state.Visible, o.state.RecipesHidden = true, false
		} else {
			o.state.RecipesHidden = !o.state.RecipesHidden
		}
	case 2:
		o.state.ClickThru = !o.state.ClickThru
		o.state.Visible = true
	}
	o.state.V++
}

func (o *overlayMgr) close() {
	o.mu.Lock()
	defer o.mu.Unlock()
	for k, cmd := range o.cmds {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		delete(o.cmds, k)
	}
	if o.stopKeys != nil {
		o.stopKeys()
		o.stopKeys = nil
	}
}

func (o *overlayMgr) handle(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Query().Get("do") {
	case "open":
		if err := o.open(); err != nil {
			writeErr(w, err)
			return
		}
	case "close":
		o.close()
	case "toggle":
		if o.running() {
			o.close()
		} else if err := o.open(); err != nil {
			writeErr(w, err)
			return
		}
	}
	writeJSON(w, 200, map[string]any{"running": o.running(), "supported": overlaySupported})
}

func (o *overlayMgr) handleState(w http.ResponseWriter, r *http.Request) {
	o.mu.Lock()
	if r.Method == http.MethodPost {
		q := r.URL.Query()
		if q.Has("pin") {
			o.state.Pin = q.Get("pin")
		}
		if q.Get("recipes") == "hide" { // ✕ on the recipe bar
			o.state.RecipesHidden = true
			o.state.V++
		}
	}
	s := o.state
	o.mu.Unlock()
	writeJSON(w, 200, s)
}

var overlays = &overlayMgr{}

var errOverlayUnsupported = errors.New("el overlay solo funciona en Windows")
