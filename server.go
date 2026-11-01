package main

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const appName = "LoLBuilds"

// Hosts the UI is allowed to fetch through the caching proxy, and how long
// responses stay fresh. Stale copies are still served if the network fails.
var allowedHosts = map[string]time.Duration{
	"ddragon.leagueoflegends.com": 24 * time.Hour,
	"raw.communitydragon.org":     12 * time.Hour,
	"lol-api-champion.op.gg":      90 * time.Minute,
	"api-hc.metatft.com":          2 * time.Hour,
}

// ttlFor lets patch-sensitive files refresh faster than the host default, so a
// new patch shows up within the hour.
func ttlFor(u *url.URL) time.Duration {
	if strings.HasSuffix(u.Path, "/versions.json") {
		return time.Hour
	}
	return allowedHosts[u.Host]
}

type proxy struct {
	client   *http.Client
	cacheDir string
	mock     string // optional upstream override for offline testing
	inflight sync.Map
	mem      sync.Map // key -> memEntry
}

type memEntry struct {
	body []byte
	at   time.Time
}

func dataDir() string {
	dir, err := os.UserCacheDir()
	if err != nil {
		dir = os.TempDir()
	}
	return filepath.Join(dir, appName)
}

func newProxy() *proxy {
	dir := filepath.Join(dataDir(), "http")
	_ = os.MkdirAll(dir, 0o755)
	return &proxy{
		client:   &http.Client{Timeout: 40 * time.Second},
		cacheDir: dir,
		mock:     os.Getenv("LOLB_MOCK"),
	}
}

func (p *proxy) keyPath(key string) string {
	h := sha1.Sum([]byte(key))
	return filepath.Join(p.cacheDir, hex.EncodeToString(h[:])+".bin")
}

// cached returns the value for key from memory or disk while fresh, otherwise
// calls produce. If produce fails, a stale copy is served when one exists.
// Concurrent calls for the same key share one produce call.
func (p *proxy) cached(key string, ttl time.Duration, force, keepInMem bool, produce func() ([]byte, error)) ([]byte, error) {
	if !force {
		if v, ok := p.mem.Load(key); ok {
			if e := v.(memEntry); time.Since(e.at) < ttl {
				return e.body, nil
			}
		}
		if st, err := os.Stat(p.keyPath(key)); err == nil && time.Since(st.ModTime()) < ttl {
			if b, err := os.ReadFile(p.keyPath(key)); err == nil {
				if keepInMem {
					p.mem.Store(key, memEntry{b, st.ModTime()})
				}
				return b, nil
			}
		}
	}

	type result struct {
		b   []byte
		err error
	}
	ch := make(chan result, 1)
	if v, loaded := p.inflight.LoadOrStore(key, ch); loaded {
		r := <-v.(chan result)
		v.(chan result) <- r
		return r.b, r.err
	}
	defer p.inflight.Delete(key)

	b, err := produce()
	if err == nil {
		if keepInMem {
			p.mem.Store(key, memEntry{b, time.Now()})
		}
		_ = os.WriteFile(p.keyPath(key), b, 0o644)
	} else if old, rerr := os.ReadFile(p.keyPath(key)); rerr == nil {
		log.Printf("network failed for %s, serving stale cache: %v", key, err)
		b, err = old, nil
	}
	ch <- result{b, err}
	return b, err
}

func (p *proxy) fetch(raw string, ttl time.Duration, force bool) ([]byte, error) {
	return p.cached(raw, ttl, force, true, func() ([]byte, error) { return p.download(raw, nil) })
}

func (p *proxy) download(raw string, hdr map[string]string) ([]byte, error) {
	target := raw
	if p.mock != "" {
		u, _ := url.Parse(raw)
		target = strings.TrimRight(p.mock, "/") + "/" + u.Host + u.Path
		if u.RawQuery != "" {
			target += "?" + u.RawQuery
		}
	}
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		req, _ := http.NewRequest("GET", target, nil)
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
		req.Header.Set("Accept", "application/json, text/plain, */*")
		if strings.Contains(raw, "op.gg") {
			req.Header.Set("Origin", "https://op.gg")
			req.Header.Set("Referer", "https://op.gg/")
		}
		for k, v := range hdr {
			req.Header.Set(k, v)
		}
		resp, err := p.client.Do(req)
		if err != nil {
			lastErr = err
			time.Sleep(400 * time.Millisecond)
			continue
		}
		b, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = err
			continue
		}
		if resp.StatusCode != 200 {
			return nil, &httpError{resp.StatusCode, string(trunc(b, 300))}
		}
		return b, nil
	}
	return nil, lastErr
}

type httpError struct {
	code int
	body string
}

func (e *httpError) Error() string { return http.StatusText(e.code) + ": " + e.body }

func trunc(b []byte, n int) []byte {
	if len(b) > n {
		return b[:n]
	}
	return b
}

func (p *proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("u")
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" {
		http.Error(w, "bad url", 400)
		return
	}
	if _, ok := allowedHosts[u.Host]; !ok {
		http.Error(w, "host not allowed", 403)
		return
	}
	b, err := p.fetch(raw, ttlFor(u), r.URL.Query().Get("fresh") == "1")
	if err != nil {
		writeErr(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(b)
}

func writeErr(w http.ResponseWriter, err error) {
	code := 502
	var he *httpError
	if errors.As(err, &he) {
		code = he.code
	}
	writeJSON(w, code, map[string]string{"error": err.Error()})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeRawJSON(w http.ResponseWriter, b []byte) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(b)
}

// startServer serves the UI, the caching proxy, TFT data, the updater and the
// League client bridge on a loopback port and returns its base URL.
func startServer(addr string) (string, *updater, error) {
	p := newProxy()
	up := newUpdater()
	mux := http.NewServeMux()
	mux.Handle("/", noCache(up.uiHandler()))
	mux.Handle("/p", p)

	t := &tftService{p: p}
	mux.HandleFunc("/api/tft/comps", t.handleComps)
	mux.HandleFunc("/api/tft/static", t.handleStatic)

	lcu := newLCU()
	mux.HandleFunc("/api/lcu/state", lcu.handleState)
	mux.HandleFunc("/api/lcu/runes", lcu.handleRunes)
	mux.HandleFunc("/api/lcu/spells", lcu.handleSpells)
	mux.HandleFunc("/api/lcu/itemset", lcu.handleItemSet)

	mux.HandleFunc("/api/update/status", up.handleStatus)
	mux.HandleFunc("/api/update/check", up.handleCheck)
	mux.HandleFunc("/api/update/restart", up.handleRestart)
	mux.HandleFunc("/api/open", handleOpen)

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return "", nil, err
	}
	go func() { _ = http.Serve(ln, mux) }()
	up.start()
	return "http://" + ln.Addr().String() + "/", up, nil
}

func noCache(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		h.ServeHTTP(w, r)
	})
}

func handleOpen(w http.ResponseWriter, r *http.Request) {
	u := r.URL.Query().Get("u")
	if !strings.HasPrefix(u, "https://") {
		http.Error(w, "bad url", 400)
		return
	}
	openBrowser(u)
	w.WriteHeader(204)
}
