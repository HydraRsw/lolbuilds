//go:build windows

package main

import (
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
	pGetWindowLongPtr       = user32.NewProc("GetWindowLongPtrW")
	pSetWindowLongPtr       = user32.NewProc("SetWindowLongPtrW")
	pSetWindowPos           = user32.NewProc("SetWindowPos")
	pSetLayeredWindowAttrib = user32.NewProc("SetLayeredWindowAttributes")
	pRegisterHotKey         = user32.NewProc("RegisterHotKey")
	pGetMessage             = user32.NewProc("GetMessageW")
	pShowWindow             = user32.NewProc("ShowWindow")
	pIsWindowVisible        = user32.NewProc("IsWindowVisible")
	pGetSystemMetrics       = user32.NewProc("GetSystemMetrics")
	pGetDpiForSystem        = user32.NewProc("GetDpiForSystem")
	pGetWindowRect          = user32.NewProc("GetWindowRect")
)

const (
	wsMaximizeBox    = 0x00010000
	wsMinimizeBox    = 0x00020000
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
	modAlt           = 0x1
	modControl       = 0x2
	modShift         = 0x4
	modNoRepeat      = 0x4000
	wmHotkey         = 0x0312
	swHide           = 0
	swShowNoActivate = 4
	alphaNormal      = 240
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
	pSetWindowPos.Call(h, hwndTopmost, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoActivate|swpFrameChanged)
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

// runOverlay is the entry point of the overlay process.
func runOverlay(url string) {
	runtime.LockOSThread()
	dpi := uintptr(96)
	if pGetDpiForSystem.Find() == nil {
		if d, _, _ := pGetDpiForSystem.Call(); d > 0 {
			dpi = d
		}
	}
	scale := func(v int) uint { return uint(v * int(dpi) / 96) }

	cfg, _ := os.UserConfigDir()
	dataPath := filepath.Join(cfg, appName, "WebView2-overlay")
	_ = os.MkdirAll(dataPath, 0o755)
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:    os.Getenv("LOLB_DEBUG") == "1",
		DataPath: dataPath,
		WindowOptions: webview2.WindowOptions{
			Title: "LoLBuilds · TFT  (Ctrl+Shift+X ocultar · Ctrl+Shift+Z atravesar clics)",
			Width: scale(400), Height: scale(780), IconId: iconResourceID,
		},
	})
	if w == nil {
		msgBox("El overlay necesita Microsoft Edge WebView2.")
		return
	}
	h := uintptr(w.Window())

	// Tool window (no taskbar button), no maximize/minimize, translucent, always on top.
	setWinLong(h, gwlStyle, winLong(h, gwlStyle)&^(wsMaximizeBox|wsMinimizeBox))
	ex := (winLong(h, gwlExStyle) | wsExToolWindow | wsExLayered | wsExTopmost) &^ wsExAppWindow
	setWinLong(h, gwlExStyle, ex)
	pSetLayeredWindowAttrib.Call(h, 0, alphaNormal, lwaAlpha)
	var rc struct{ L, T, R, B int32 }
	pGetWindowRect.Call(h, uintptr(unsafe.Pointer(&rc)))
	sw, _, _ := pGetSystemMetrics.Call(0) // SM_CXSCREEN
	x := int(sw) - int(rc.R-rc.L) - int(scale(16))
	pSetWindowPos.Call(h, hwndTopmost, uintptr(x), uintptr(scale(70)), 0, 0, swpNoSize|swpNoActivate|swpFrameChanged|swpShowWindow)

	clickThru := false
	go func() { // global hotkeys live on their own thread with their own message loop
		runtime.LockOSThread()
		pRegisterHotKey.Call(0, 1, modControl|modShift|modNoRepeat, 'X')
		pRegisterHotKey.Call(0, 2, modControl|modShift|modNoRepeat, 'Z')
		var m winMsg
		for {
			r, _, _ := pGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
			if int32(r) <= 0 {
				return
			}
			if m.Message != wmHotkey {
				continue
			}
			switch m.WParam {
			case 1:
				if v, _, _ := pIsWindowVisible.Call(h); v != 0 {
					pShowWindow.Call(h, swHide)
				} else {
					pShowWindow.Call(h, swShowNoActivate)
					keepOnTop(h)
				}
			case 2:
				clickThru = !clickThru
				e := winLong(h, gwlExStyle)
				alpha := uintptr(alphaNormal)
				if clickThru {
					e |= wsExTransparent
					alpha = alphaClickThru
				} else {
					e &^= wsExTransparent
				}
				setWinLong(h, gwlExStyle, e)
				pSetLayeredWindowAttrib.Call(h, 0, alpha, lwaAlpha)
				keepOnTop(h)
				ct := clickThru
				w.Dispatch(func() {
					if ct {
						w.Eval("window.onClickThrough && onClickThrough(true)")
					} else {
						w.Eval("window.onClickThrough && onClickThrough(false)")
					}
				})
			}
		}
	}()

	// Close together with the main app.
	go func() {
		ping := url[:len(url)-len("overlay.html")] + "api/ping"
		c := &http.Client{Timeout: 2 * time.Second}
		fails := 0
		for range time.Tick(3 * time.Second) {
			resp, err := c.Get(ping)
			if err == nil {
				resp.Body.Close()
				fails = 0
				if v, _, _ := pIsWindowVisible.Call(h); v != 0 {
					keepOnTop(h) // some games grab topmost; take it back
				}
				continue
			}
			if fails++; fails >= 3 {
				os.Exit(0)
			}
		}
	}()

	w.Navigate(url)
	w.Run()
}
