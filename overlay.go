package main

import (
	"errors"
	"net/http"
	"os"
	"os/exec"
	"sync"
)

// overlayMgr runs the TFT overlay as a second process of this same .exe
// ("LoLBuilds.exe --overlay <url>"), an always-on-top window that loads
// overlay.html from this server, so it shares data, cache and UI updates.
type overlayMgr struct {
	mu   sync.Mutex
	base string
	cmd  *exec.Cmd
}

func (o *overlayMgr) running() bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.cmd != nil
}

func (o *overlayMgr) open() error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.cmd != nil {
		return nil
	}
	if !overlaySupported {
		return errOverlayUnsupported
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, "--overlay", o.base+"overlay.html")
	if err := cmd.Start(); err != nil {
		return err
	}
	o.cmd = cmd
	go func() {
		_ = cmd.Wait()
		o.mu.Lock()
		if o.cmd == cmd {
			o.cmd = nil
		}
		o.mu.Unlock()
	}()
	return nil
}

func (o *overlayMgr) close() {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.cmd != nil && o.cmd.Process != nil {
		_ = o.cmd.Process.Kill()
	}
	o.cmd = nil
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

var overlays = &overlayMgr{}

var errOverlayUnsupported = errors.New("el overlay solo funciona en Windows")
