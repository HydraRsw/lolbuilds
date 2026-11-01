//go:build windows

package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

const overlaySupported = true

var (
	user32                  = windows.NewLazySystemDLL("user32.dll")
	kernel32                = windows.NewLazySystemDLL("kernel32.dll")
	pGetWindowLongPtr       = user32.NewProc("GetWindowLongPtrW")
	pSetWindowLongPtr       = user32.NewProc("SetWindowLongPtrW")
	pSetWindowPos           = user32.NewProc("SetWindowPos")
	pSetLayeredWindowAttrib = user32.NewProc("SetLayeredWindowAttributes")
	pRegisterHotKey         = user32.NewProc("RegisterHotKey")
	pUnregisterHotKey       = user32.NewProc("UnregisterHotKey")
	pGetMessage             = user32.NewProc("GetMessageW")
	pPostThreadMessage      = user32.NewProc("PostThreadMessageW")
	pPostMessage            = user32.NewProc("PostMessageW")
	pReleaseCapture         = user32.NewProc("ReleaseCapture")
	pShowWindow             = user32.NewProc("ShowWindow")
	pIsWindowVisible        = user32.NewProc("IsWindowVisible")
	pGetSystemMetrics       = user32.NewProc("GetSystemMetrics")
	pGetDpiForSystem        = user32.NewProc("GetDpiForSystem")
	pGetWindowRect          = user32.NewProc("GetWindowRect")
	pGetCurrentThreadID     = kernel32.NewProc("GetCurrentThreadId")
)

const (
	wsPopup          = 0x80000000
	wsVisible        = 0x10000000
	wsCaption        = 0x00C00000
	wsThickFrame     = 0x00040000
	wsSysMenu        = 0x00080000
	wsMaximizeBox    = 0x00010000
	wsMinimizeBox    = 0x00020000
	wsBorder         = 0x00800000
	wsExTopmost      = 0x00000008
	wsExTransparent  = 0x00000020
	wsExToolWindow   = 0x00000080
	wsExAppWindow    = 0x00040000
	wsExLayered      = 0x00080000
	swpNoSize        = 0x0001
	swpNoMove        = 0x0002
	swpNoActivate    = 0x0010
	swpFrameChanged  = 0x0020
	swpShowWindow    = 0x0040
	lwaAlpha         = 0x2
	modControl       = 0x2
	modShift         = 0x4
	modNoRepeat      = 0x4000
	wmQuit           = 0x0012
	wmHotkey         = 0x0312
	wmNCLButtonDown  = 0x00A1
	htCaption        = 2
	swHide           = 0
	swShowNoActivate = 4
	alphaNormal      = 242
	alphaClickThru   = 185
)

var gwlStyle, gwlExStyle = -16, -20
var hwndTopmost = ^uintptr(0) // (HWND)-1

func winLong(h uintptr, idx int) uintptr {
	r, _, _ := pGetWindowLongPtr.Call(h, uintptr(idx))
	return r
}
func setWinLong(h uintptr, idx int, v uintptr) { pSetWindowLongPtr.Call(h, uintptr(idx), v) }
func keepOnTop(h uintptr) {
	pSetWindowPos.Call(h, hwndTopmost, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoActivate)
}

type winMsg struct {
	Hwnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      struct{ X, Y int32 }
	Private uint32
}

type rect struct{ L, T, R, B int32 }

// startHotkeys registers the global overlay hotkeys in the main process
// (Ctrl+Shift+X = 1, Ctrl+Shift+Z = 2) and returns a function that removes them.
func startHotkeys(cb func(id int)) func() {
	tid := make(chan uintptr, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		t, _, _ := pGetCurrentThreadID.Call()
		tid <- t
		pRegisterHotKey.Call(0, 1, modControl|modShift|modNoRepeat, 'X')
		pRegisterHotKey.Call(0, 2, modControl|modShift|modNoRepeat, 'Z')
		defer pUnregisterHotKey.Call(0, 1)
		defer pUnregisterHotKey.Call(0, 2)
		var m winMsg
		for {
			r, _, _ := pGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
			if int32(r) <= 0 {
				return
			}
			if m.Message == wmHotkey {
				cb(int(m.WParam))
			}
		}
	}()
	t := <-tid
	return func() { pPostThreadMessage.Call(t, wmQuit, 0, 0) }
}

type savedPos struct{ X, Y, W, H int32 }

func posFile(kind string) string { return filepath.Join(dataDir(), "overlay-"+kind+".json") }

// runOverlay is the entry point of an overlay process (one per window).
func runOverlay(url, kind string) {
	runtime.LockOSThread()
	dpi := 96
	if pGetDpiForSystem.Find() == nil {
		if d, _, _ := pGetDpiForSystem.Call(); d > 0 {
			dpi = int(d)
		}
	}
	scale := func(v float64) int32 { return int32(v * float64(dpi) / 96) }
	sw, _, _ := pGetSystemMetrics.Call(0) // SM_CXSCREEN
	sh, _, _ := pGetSystemMetrics.Call(1) // SM_CYSCREEN

	// default geometry; the user's last position wins
	var x, y, w, h int32
	if kind == "recipes" {
		w, h = scale(560), scale(62)
		x, y = scale(16), scale(110)
	} else {
		w, h = scale(400), scale(780)
		if max := int32(sh) - scale(140); h > max {
			h = max
		}
		x, y = int32(sw)-w-scale(16), scale(70)
	}
	var saved savedPos
	if b, err := os.ReadFile(posFile(kind)); err == nil && json.Unmarshal(b, &saved) == nil &&
		saved.X > -saved.W+40 && saved.Y >= 0 && saved.X < int32(sw)-40 && saved.Y < int32(sh)-40 {
		x, y = saved.X, saved.Y
	}

	cfg, _ := os.UserConfigDir()
	dataPath := filepath.Join(cfg, appName, "WebView2-overlay-"+kind)
	_ = os.MkdirAll(dataPath, 0o755)
	wv := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:    os.Getenv("LOLB_DEBUG") == "1",
		DataPath: dataPath,
		WindowOptions: webview2.WindowOptions{
			Title: "LoLBuilds · TFT", Width: uint(w), Height: uint(h), IconId: iconResourceID,
		},
	})
	if wv == nil {
		msgBox("El overlay necesita Microsoft Edge WebView2.")
		return
	}
	hw := uintptr(wv.Window())

	// Frameless popup, no taskbar button, translucent, always on top.
	st := winLong(hw, gwlStyle)
	st = (st &^ (wsCaption | wsThickFrame | wsSysMenu | wsMaximizeBox | wsMinimizeBox | wsBorder)) | wsPopup
	setWinLong(hw, gwlStyle, st)
	ex := (winLong(hw, gwlExStyle) | wsExToolWindow | wsExLayered | wsExTopmost) &^ wsExAppWindow
	setWinLong(hw, gwlExStyle, ex)
	pSetLayeredWindowAttrib.Call(hw, 0, alphaNormal, lwaAlpha)
	pSetWindowPos.Call(hw, hwndTopmost, uintptr(x), uintptr(y), uintptr(w), uintptr(h), swpNoActivate|swpFrameChanged|swpShowWindow)

	// JS → Go: drag the frameless window, and let the page size the recipe bar.
	_ = wv.Bind("ovDrag", func() {
		pReleaseCapture.Call()
		pPostMessage.Call(hw, wmNCLButtonDown, htCaption, 0)
	})
	_ = wv.Bind("ovSize", func(cw, ch float64) {
		if kind != "recipes" || cw < 50 || ch < 20 {
			return
		}
		pSetWindowPos.Call(hw, 0, 0, 0, uintptr(scale(cw)), uintptr(scale(ch)), swpNoMove|swpNoActivate)
	})

	// Follow the shared state of the main app (hotkeys live there), keep the
	// window on top, remember its position, and exit when the app closes.
	base := url[:lastSlash(url)+1]
	go func() {
		c := &http.Client{Timeout: 2 * time.Second}
		lastV, fails, tick := -1, 0, 0
		var lastRect rect
		for range time.Tick(150 * time.Millisecond) {
			resp, err := c.Get(base + "api/overlay/state")
			if err != nil {
				if fails++; fails > 20 {
					os.Exit(0)
				}
				continue
			}
			fails = 0
			var s overlayState
			_ = json.NewDecoder(resp.Body).Decode(&s)
			resp.Body.Close()
			if s.V != lastV {
				lastV = s.V
				if s.Visible {
					pShowWindow.Call(hw, swShowNoActivate)
					keepOnTop(hw)
				} else {
					pShowWindow.Call(hw, swHide)
				}
				e := winLong(hw, gwlExStyle)
				alpha := uintptr(alphaNormal)
				if s.ClickThru {
					e |= wsExTransparent
					alpha = alphaClickThru
				} else {
					e &^= wsExTransparent
				}
				setWinLong(hw, gwlExStyle, e)
				pSetLayeredWindowAttrib.Call(hw, 0, alpha, lwaAlpha)
				ct := s.ClickThru
				wv.Dispatch(func() {
					if ct {
						wv.Eval("window.onClickThrough && onClickThrough(true)")
					} else {
						wv.Eval("window.onClickThrough && onClickThrough(false)")
					}
				})
			}
			if tick++; tick%13 == 0 { // ~2 s
				if v, _, _ := pIsWindowVisible.Call(hw); v != 0 {
					keepOnTop(hw) // some games grab topmost; take it back
				}
				var r rect
				pGetWindowRect.Call(hw, uintptr(unsafe.Pointer(&r)))
				if r != lastRect && r.R > r.L {
					if lastRect.R > lastRect.L {
						b, _ := json.Marshal(savedPos{r.L, r.T, r.R - r.L, r.B - r.T})
						_ = os.WriteFile(posFile(kind), b, 0o644)
					}
					lastRect = r
				}
			}
		}
	}()

	wv.Navigate(url)
	wv.Run()
}

func indexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}

func lastSlash(s string) int {
	if q := indexByte(s, '?'); q >= 0 {
		s = s[:q]
	}
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == '/' {
			return i
		}
	}
	return -1
}
