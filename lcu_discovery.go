package main

import (
	"crypto/tls"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Finding the League/TFT client. Since November 2026 TFT has its own launcher
// and install, so instead of only looking for LeagueClientUx.exe in the League
// folder we gather every place Riot leaves the local API credentials:
//   1. command line of the running client processes (--app-port, --remoting-auth-token)
//   2. "lockfile" next to any running Riot client process (and its parent folder)
//   3. install folders the Riot Client records in ProgramData\Riot Games\Metadata
//   4. the folder chosen by the user in Settings, then the usual install paths
// Every candidate is tested against the API and the first that answers wins.

type procInfo struct {
	Name    string `json:"name"`
	Path    string `json:"path,omitempty"`
	cmdline string
}

type lcuCred struct {
	Port   string `json:"port"`
	Pass   string `json:"-"`
	Source string `json:"source"`
}

type clientProbe struct {
	Processes []procInfo `json:"processes"`
	Lockfiles []string   `json:"lockfiles"` // existing lockfiles found
	Creds     []lcuCred  `json:"candidates"`
	TFTGame   bool       `json:"tftGame"`  // TFT match window running
	LoLGame   bool       `json:"lolGame"`  // League match running
	Sessions  []string   `json:"sessions"` // products the Riot Client reports as running
	Chosen    string     `json:"chosen"`   // source of the credentials in use
	Notes     []string   `json:"notes,omitempty"`
}

var (
	portArgRe  = regexp.MustCompile(`--app-port=(\d+)`)
	tokenArgRe = regexp.MustCompile(`--remoting-auth-token=([\w-]+)`)
	yamlPathRe = regexp.MustCompile(`(?m)^\s*product_install_(?:full_)?path:\s*"?([^"\r\n]+)"?`)
)

// interesting reports whether a process belongs to Riot's clients (not the anticheat).
func interesting(name, path string) bool {
	n := strings.ToLower(name)
	if strings.HasPrefix(n, "vgc") || strings.HasPrefix(n, "vgtray") || strings.Contains(n, "crashhandler") || strings.Contains(n, "webhelper") || strings.Contains(n, "cefsharp") {
		return false
	}
	for _, k := range []string{"league", "tft", "teamfight", "riotclient", "riot client"} {
		if strings.Contains(n, k) {
			return true
		}
	}
	return strings.Contains(strings.ToLower(path), `\riot games\`)
}

// isGameProcess: the match itself. We never read anything from these, only their name.
func isGameProcess(name string) (tft, lol bool) {
	n := strings.ToLower(name)
	if strings.Contains(n, "shipping") && (strings.Contains(n, "tft") || strings.Contains(n, "teamfight")) {
		return true, false
	}
	return false, n == "league of legends.exe"
}

func credsFromCmdline(cmd, source string) *lcuCred {
	p, t := portArgRe.FindStringSubmatch(cmd), tokenArgRe.FindStringSubmatch(cmd)
	if p == nil || t == nil {
		return nil
	}
	return &lcuCred{Port: p[1], Pass: t[1], Source: source}
}

// metadataInstallDirs lists install folders recorded by the Riot Client.
func metadataInstallDirs() []string {
	root := os.Getenv("ProgramData")
	if root == "" {
		root = `C:\ProgramData`
	}
	files, _ := filepath.Glob(filepath.Join(root, "Riot Games", "Metadata", "*", "*.product_settings.yaml"))
	var out []string
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		for _, m := range yamlPathRe.FindAllStringSubmatch(string(b), -1) {
			out = append(out, filepath.Clean(strings.TrimSpace(m[1])))
		}
	}
	return out
}

func defaultInstallDirs() []string {
	var out []string
	for _, d := range []string{"C", "D", "E", "F", "G"} {
		for _, base := range []string{`:\Riot Games`, `:\Program Files\Riot Games`, `:\Juegos\Riot Games`, `:\Games\Riot Games`, `:\Program Files (x86)\Riot Games`} {
			dirs, _ := filepath.Glob(d + base + `\*`)
			out = append(out, dirs...)
		}
	}
	return out
}

func probeClientRaw(full bool) clientProbe {
	var pr clientProbe
	seenLock := map[string]bool{}
	var creds []lcuCred
	addLock := func(path, source string) {
		key := strings.ToLower(filepath.Clean(path))
		if seenLock[key] {
			return
		}
		seenLock[key] = true
		if port, pass, ok := parseLockfile(path); ok {
			pr.Lockfiles = append(pr.Lockfiles, path)
			creds = append(creds, lcuCred{Port: port, Pass: pass, Source: source + ": " + path})
		}
	}
	// 1-2. running processes
	procs := listRiotProcesses(full)
	sort.SliceStable(procs, func(i, j int) bool { return rankProc(procs[i].Name) < rankProc(procs[j].Name) })
	for _, p := range procs {
		tft, lol := isGameProcess(p.Name)
		pr.TFTGame = pr.TFTGame || tft
		pr.LoLGame = pr.LoLGame || lol
		pr.Processes = append(pr.Processes, procInfo{Name: p.Name, Path: p.Path})
		if p.cmdline != "" && !strings.Contains(strings.ToLower(p.Name), "riotclient") {
			if c := credsFromCmdline(p.cmdline, "proceso "+p.Name); c != nil {
				creds = append(creds, *c)
			}
		}
		if p.Path != "" && !tft && !lol {
			dir := filepath.Dir(p.Path)
			addLock(filepath.Join(dir, "lockfile"), p.Name)
			addLock(filepath.Join(filepath.Dir(dir), "lockfile"), p.Name)
		}
	}
	// manual folder from Settings
	if d := loadPrefs().ClientDir; d != "" {
		if strings.EqualFold(filepath.Base(d), "lockfile") {
			addLock(d, "carpeta elegida")
		} else {
			addLock(filepath.Join(d, "lockfile"), "carpeta elegida")
		}
	}
	// 3. Riot Client metadata, 4. usual folders
	for _, d := range metadataInstallDirs() {
		addLock(filepath.Join(d, "lockfile"), "metadata")
	}
	for _, d := range defaultInstallDirs() {
		if !strings.Contains(strings.ToLower(d), "riot client") {
			addLock(filepath.Join(d, "lockfile"), "carpeta")
		}
	}
	for _, p := range extraLockfiles() {
		addLock(p, "LOLB_LOCKFILE")
	}
	// Riot Client local API: which products are running (diagnostics; some
	// products pass the client credentials in their launch arguments).
	pr.Sessions, creds = riotClientSessions(creds)
	pr.Creds = dedupeCreds(creds)
	return pr
}

// League/TFT client UX processes first: their lockfile is the one we want.
func rankProc(name string) int {
	n := strings.ToLower(name)
	switch {
	case strings.Contains(n, "clientux"):
		return 0
	case strings.Contains(n, "tft") && !strings.Contains(n, "shipping"):
		return 1
	case strings.HasPrefix(n, "leagueclient"):
		return 2
	default:
		return 5
	}
}

func dedupeCreds(in []lcuCred) []lcuCred {
	seen := map[string]bool{}
	var out []lcuCred
	for _, c := range in {
		if c.Port == "" || seen[c.Port+c.Pass] {
			continue
		}
		seen[c.Port+c.Pass] = true
		out = append(out, c)
	}
	return out
}

func riotClientSessions(creds []lcuCred) ([]string, []lcuCred) {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		return nil, creds
	}
	port, pass, ok := parseLockfile(filepath.Join(base, "Riot Games", "Riot Client", "Config", "lockfile"))
	if !ok {
		return nil, creds
	}
	req, _ := http.NewRequest("GET", "https://127.0.0.1:"+port+"/product-session/v1/external-sessions", nil)
	req.SetBasicAuth("riot", pass)
	resp, err := quickClient.Do(req)
	if err != nil {
		return nil, creds
	}
	defer resp.Body.Close()
	var sess map[string]struct {
		ProductID string `json:"productId"`
		Patchline string `json:"patchlineFullName"`
		Phase     string `json:"phase"`
		Launch    struct {
			Arguments []string `json:"arguments"`
		} `json:"launchConfiguration"`
	}
	if json.NewDecoder(resp.Body).Decode(&sess) != nil {
		return nil, creds
	}
	var out []string
	for _, s := range sess {
		out = append(out, strings.TrimSpace(s.ProductID+" "+s.Patchline+" "+s.Phase))
		if c := credsFromCmdline(strings.Join(s.Launch.Arguments, " "), "Riot Client ("+s.ProductID+")"); c != nil {
			creds = append(creds, *c)
		}
	}
	sort.Strings(out)
	return out, creds
}

/* ---------- cached probe + test of candidates ---------- */

var quickClient = &http.Client{
	Timeout:   1500 * time.Millisecond,
	Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
}

var (
	probeMu   sync.Mutex
	probeLast clientProbe
	probeAt   time.Time
)

func probeClient(maxAge time.Duration) clientProbe {
	probeMu.Lock()
	defer probeMu.Unlock()
	if time.Since(probeAt) < maxAge {
		return probeLast
	}
	probeLast, probeAt = probeClientRaw(false), time.Now()
	return probeLast
}

// pickCred tests candidates: the first one whose gameflow answers wins; if none
// has gameflow (a client with a different API), the first that answers at all.
func (l *lcu) pickCred(cands []lcuCred) (lcuCred, bool) {
	var fallback *lcuCred
	for i, c := range cands {
		req, _ := http.NewRequest("GET", "https://127.0.0.1:"+c.Port+"/lol-gameflow/v1/gameflow-phase", nil)
		req.SetBasicAuth("riot", c.Pass)
		resp, err := quickClient.Do(req)
		if err != nil {
			continue
		}
		resp.Body.Close()
		if resp.StatusCode == 200 {
			return c, true
		}
		if resp.StatusCode != 401 && resp.StatusCode != 403 && fallback == nil {
			fallback = &cands[i]
		}
	}
	if fallback != nil {
		return *fallback, true
	}
	return lcuCred{}, false
}

func (l *lcu) handleDiag(w http.ResponseWriter, r *http.Request) {
	pr := probeClientRaw(true)
	if c, ok := l.pickCred(pr.Creds); ok {
		pr.Chosen = c.Source
		l.mu.Lock()
		l.port, l.password, l.source = c.Port, c.Pass, c.Source
		l.mu.Unlock()
	} else {
		l.reset()
	}
	if len(pr.Creds) == 0 {
		pr.Notes = append(pr.Notes, "no se encontraron credenciales del cliente")
	}
	writeJSON(w, 200, pr)
}
