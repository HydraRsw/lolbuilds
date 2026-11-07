package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed web
var webFS embed.FS

// appVersion is the version of this executable (Go backend + embedded UI).
// Overridden at build time with -ldflags "-X main.appVersion=1.2.3".
var appVersion = "1.7.0"

// Updates are published on the "updates" branch of the GitHub repo:
//
//	update.json   manifest (versions + sha256)
//	web.zip       the UI (index.html, app.js, …) — lets UI changes ship without a new .exe
//	LoLBuilds.exe the full app; installed copies only replace themselves when "exe" is newer
var updateRepo = "HydraRsw/lolbuilds"

// updateBase can be pointed at a local mock for testing (LOLB_UPDATE_BASE).
var updateBase = "https://raw.githubusercontent.com/" + updateRepo + "/updates"

type manifest struct {
	Version   string `json:"version"`
	UI        string `json:"ui"`
	Exe       string `json:"exe"`
	MinExe    string `json:"minExe"` // oldest exe that can run this UI
	Notes     string `json:"notes"`
	UISHA256  string `json:"uiSha256"`
	ExeSHA256 string `json:"exeSha256"`
}

type uiPointer struct {
	Version string `json:"version"`
	MinExe  string `json:"minExe"`
}

type updater struct {
	mu        sync.Mutex
	client    *http.Client
	embedded  fs.FS
	embedUI   string
	uiDir     string // active downloaded UI; "" = embedded
	uiVersion string
	latest    string
	notes     string
	exeReady  bool
	checking  bool
	lastErr   string
	lastCheck time.Time
	checkNow  chan struct{}
}

func newUpdater() *updater {
	sub, _ := fs.Sub(webFS, "web")
	v := readUIVersion(sub)
	if b := os.Getenv("LOLB_UPDATE_BASE"); b != "" {
		updateBase = strings.TrimRight(b, "/")
	}
	return &updater{
		client:    &http.Client{Timeout: 5 * time.Minute},
		embedded:  sub,
		embedUI:   v.Version,
		uiVersion: v.Version,
		checkNow:  make(chan struct{}, 1),
	}
}

func readUIVersion(f fs.FS) uiPointer {
	var v uiPointer
	if b, err := fs.ReadFile(f, "version.json"); err == nil {
		_ = json.Unmarshal(b, &v)
	}
	if v.Version == "" {
		v.Version = appVersion
	}
	return v
}

func uiRoot() string { return filepath.Join(dataDir(), "ui") }

// cmpVer compares dotted versions ("1.10.0" > "1.9.3"); a leading "v" is ignored.
func cmpVer(a, b string) int {
	pa := strings.Split(strings.TrimPrefix(strings.TrimSpace(a), "v"), ".")
	pb := strings.Split(strings.TrimPrefix(strings.TrimSpace(b), "v"), ".")
	for i := 0; i < len(pa) || i < len(pb); i++ {
		var x, y int
		if i < len(pa) {
			x, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			y, _ = strconv.Atoi(pb[i])
		}
		if x != y {
			if x < y {
				return -1
			}
			return 1
		}
	}
	return 0
}

func (u *updater) uiHandler() http.Handler {
	embedded := http.FileServer(http.FS(u.embedded))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u.mu.Lock()
		dir := u.uiDir
		u.mu.Unlock()
		if dir != "" {
			http.FileServer(http.Dir(dir)).ServeHTTP(w, r)
			return
		}
		embedded.ServeHTTP(w, r)
	})
}

func (u *updater) start() {
	if exe, err := os.Executable(); err == nil {
		_ = os.Remove(exe + ".old") // left behind by the previous self-update
	}
	// Use a previously downloaded UI if it is newer than the embedded one.
	if b, err := os.ReadFile(filepath.Join(uiRoot(), "current.json")); err == nil {
		var p uiPointer
		if json.Unmarshal(b, &p) == nil && cmpVer(p.Version, u.embedUI) > 0 && cmpVer(appVersion, p.MinExe) >= 0 {
			dir := filepath.Join(uiRoot(), p.Version)
			if _, err := os.Stat(filepath.Join(dir, "index.html")); err == nil {
				u.uiDir, u.uiVersion = dir, p.Version
			}
		}
	}
	if os.Getenv("LOLB_NO_UPDATE") == "1" {
		return
	}
	go func() {
		time.Sleep(6 * time.Second)
		for {
			u.check()
			select {
			case <-time.After(3 * time.Hour):
			case <-u.checkNow:
			}
		}
	}()
}

func (u *updater) setErr(err error) {
	u.mu.Lock()
	if err != nil {
		u.lastErr = err.Error()
		log.Println("update:", err)
	} else {
		u.lastErr = ""
	}
	u.mu.Unlock()
}

func (u *updater) get(url string, max int64) ([]byte, error) {
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "LoLBuilds/"+appVersion)
	resp, err := u.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, &httpError{resp.StatusCode, url}
	}
	return io.ReadAll(io.LimitReader(resp.Body, max))
}

func (u *updater) check() {
	u.mu.Lock()
	if u.checking {
		u.mu.Unlock()
		return
	}
	u.checking = true
	u.mu.Unlock()
	defer func() {
		u.mu.Lock()
		u.checking, u.lastCheck = false, time.Now()
		u.mu.Unlock()
	}()

	// The query string skips the CDN cache so a new version is seen right away.
	mb, err := u.get(fmt.Sprintf("%s/update.json?t=%d", updateBase, time.Now().Unix()), 1<<20)
	if err != nil {
		if he, ok := err.(*httpError); ok && he.code == 404 {
			u.setErr(nil) // nothing published yet
			return
		}
		u.setErr(fmt.Errorf("no se pudo buscar actualizaciones: %w", err))
		return
	}
	assets := map[string]string{"web.zip": updateBase + "/web.zip", "LoLBuilds.exe": updateBase + "/LoLBuilds.exe"}
	var m manifest
	if err := json.Unmarshal(mb, &m); err != nil {
		u.setErr(err)
		return
	}
	u.mu.Lock()
	u.latest, u.notes = m.Version, m.Notes
	exeReady, curUI := u.exeReady, u.uiVersion
	u.mu.Unlock()

	// 1) New executable (only when the Go side changed).
	if cmpVer(m.Exe, appVersion) > 0 && !exeReady && m.ExeSHA256 != "" && runtime.GOOS == "windows" {
		if err := u.installExe(assets["LoLBuilds.exe"], m.ExeSHA256); err != nil {
			u.setErr(fmt.Errorf("no se pudo instalar la nueva versión: %w", err))
			return
		}
		u.mu.Lock()
		u.exeReady = true
		u.mu.Unlock()
		exeReady = true
	}

	// 2) New UI, applied live without restarting.
	if cmpVer(m.UI, curUI) > 0 && m.UISHA256 != "" {
		if cmpVer(m.MinExe, appVersion) > 0 {
			// This UI needs the newer exe; it is embedded in it, so a restart covers it.
			u.setErr(nil)
			return
		}
		if err := u.installUI(assets["web.zip"], m); err != nil {
			u.setErr(fmt.Errorf("no se pudo actualizar la interfaz: %w", err))
			return
		}
	}
	u.setErr(nil)
}

func verify(b []byte, want string) error {
	if want == "" {
		return nil
	}
	sum := sha256.Sum256(b)
	if !strings.EqualFold(hex.EncodeToString(sum[:]), want) {
		return fmt.Errorf("el archivo descargado está dañado (sha256 no coincide)")
	}
	return nil
}

func (u *updater) installUI(url string, m manifest) error {
	b, err := u.get(url, 50<<20)
	if err != nil {
		return err
	}
	if err := verify(b, m.UISHA256); err != nil {
		return err
	}
	zr, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		return err
	}
	dir := filepath.Join(uiRoot(), m.UI)
	tmp := dir + ".tmp"
	_ = os.RemoveAll(tmp)
	for _, f := range zr.File {
		name := filepath.Clean(f.Name)
		if strings.HasPrefix(name, "..") || filepath.IsAbs(name) {
			return fmt.Errorf("ruta inválida en web.zip: %s", f.Name)
		}
		dst := filepath.Join(tmp, name)
		if f.FileInfo().IsDir() {
			_ = os.MkdirAll(dst, 0o755)
			continue
		}
		_ = os.MkdirAll(filepath.Dir(dst), 0o755)
		rc, err := f.Open()
		if err != nil {
			return err
		}
		data, err := io.ReadAll(io.LimitReader(rc, 30<<20))
		rc.Close()
		if err != nil {
			return err
		}
		if err := os.WriteFile(dst, data, 0o644); err != nil {
			return err
		}
	}
	if _, err := os.Stat(filepath.Join(tmp, "index.html")); err != nil {
		return fmt.Errorf("web.zip no contiene index.html")
	}
	_ = os.RemoveAll(dir)
	if err := os.Rename(tmp, dir); err != nil {
		return err
	}
	ptr, _ := json.Marshal(uiPointer{Version: m.UI, MinExe: m.MinExe})
	if err := os.WriteFile(filepath.Join(uiRoot(), "current.json"), ptr, 0o644); err != nil {
		return err
	}
	u.mu.Lock()
	old := u.uiDir
	u.uiDir, u.uiVersion = dir, m.UI
	u.mu.Unlock()
	if old != "" && old != dir {
		_ = os.RemoveAll(old)
	}
	log.Println("update: UI updated to", m.UI)
	return nil
}

// installExe swaps the running executable: Windows allows renaming a running
// .exe, so the old one becomes LoLBuilds.exe.old and the new one takes its
// place; the next launch runs the new version.
func (u *updater) installExe(url, sum string) error {
	b, err := u.get(url, 200<<20)
	if err != nil {
		return err
	}
	if err := verify(b, sum); err != nil {
		return err
	}
	if len(b) < 2 || b[0] != 'M' || b[1] != 'Z' {
		return fmt.Errorf("el ejecutable descargado no es válido")
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	exe, _ = filepath.EvalSymlinks(exe)
	next := exe + ".new"
	if err := os.WriteFile(next, b, 0o755); err != nil {
		return err
	}
	_ = os.Remove(exe + ".old")
	if err := os.Rename(exe, exe+".old"); err != nil {
		_ = os.Remove(next)
		return err
	}
	if err := os.Rename(next, exe); err != nil {
		_ = os.Rename(exe+".old", exe)
		return err
	}
	log.Println("update: executable replaced")
	return nil
}

func (u *updater) handleStatus(w http.ResponseWriter, r *http.Request) {
	u.mu.Lock()
	defer u.mu.Unlock()
	last := ""
	if !u.lastCheck.IsZero() {
		last = u.lastCheck.Format(time.RFC3339)
	}
	writeJSON(w, 200, map[string]any{
		"app": appVersion, "ui": u.uiVersion, "latest": u.latest, "notes": u.notes,
		"exeReady": u.exeReady, "checking": u.checking, "error": u.lastErr, "lastCheck": last,
		"repo": updateRepo,
	})
}

func (u *updater) handleCheck(w http.ResponseWriter, r *http.Request) {
	select {
	case u.checkNow <- struct{}{}:
	default:
	}
	w.WriteHeader(204)
}

func (u *updater) handleRestart(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(204)
	go func() {
		time.Sleep(300 * time.Millisecond)
		restartSelf()
	}()
}
