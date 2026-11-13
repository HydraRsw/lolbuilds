//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

func main() {
	if len(os.Args) > 2 && os.Args[1] == "--overlay" {
		kind := "comps"
		if len(os.Args) > 3 {
			kind = os.Args[3]
		}
		runOverlay(os.Args[2], kind)
		return
	}
	base, _, err := startServer("127.0.0.1:0")
	if err != nil {
		msgBox("No se pudo iniciar el servidor local: " + err.Error())
		return
	}
	cfg, _ := os.UserConfigDir()
	dataPath := filepath.Join(cfg, appName, "WebView2")
	_ = os.MkdirAll(dataPath, 0o755)

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     os.Getenv("LOLB_DEBUG") == "1",
		AutoFocus: true,
		DataPath:  dataPath,
		WindowOptions: webview2.WindowOptions{
			Title:  "LoL Builds",
			Width:  1380,
			Height: 900,
			IconId: iconResourceID,
			Center: true,
		},
	})
	if w == nil {
		// WebView2 runtime missing (very rare on Windows 10/11): fall back to the browser.
		msgBox("No se encontró Microsoft Edge WebView2. Se abrirá la app en tu navegador.\n\n" +
			"Puedes instalar WebView2 desde https://go.microsoft.com/fwlink/p/?LinkId=2124703")
		openBrowser(base)
		select {}
	}
	defer w.Destroy()
	w.SetSize(1100, 700, webview2.HintMin)
	w.Navigate(base)
	w.Run()
	overlays.close()
}

func msgBox(text string) {
	t, _ := windows.UTF16PtrFromString(text)
	c, _ := windows.UTF16PtrFromString("LoL Builds")
	windows.MessageBox(0, t, c, windows.MB_OK|windows.MB_ICONINFORMATION)
}

func openBrowser(u string) {
	verb, _ := windows.UTF16PtrFromString("open")
	target, _ := windows.UTF16PtrFromString(u)
	_ = windows.ShellExecute(0, verb, target, nil, nil, windows.SW_SHOWNORMAL)
}

// listRiotProcesses lists Riot client processes with their exe path and, for
// the launcher/lobby processes (never the match itself), their command line.
func listRiotProcesses(full bool) []procInfo {
	var out []procInfo
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil
	}
	defer windows.CloseHandle(snap)
	var pe windows.ProcessEntry32
	pe.Size = uint32(unsafe.Sizeof(pe))
	for err = windows.Process32First(snap, &pe); err == nil; err = windows.Process32Next(snap, &pe) {
		name := windows.UTF16ToString(pe.ExeFile[:])
		tft, lol := isGameProcess(name)
		// full scan (diagnostics): also processes with generic names living in a Riot folder
		if !tft && !lol && !interesting(name, "") && !full {
			continue
		}
		p := procInfo{Name: name}
		if tft || lol {
			out = append(out, p) // the match: name only, we don't touch the process
			continue
		}
		h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pe.ProcessID)
		if err != nil {
			if interesting(name, "") {
				out = append(out, p)
			}
			continue
		}
		buf := make([]uint16, windows.MAX_LONG_PATH)
		n := uint32(len(buf))
		if windows.QueryFullProcessImageName(h, 0, &buf[0], &n) == nil {
			p.Path = windows.UTF16ToString(buf[:n])
		}
		if interesting(name, p.Path) {
			p.cmdline = processCmdline(h)
			out = append(out, p)
		}
		windows.CloseHandle(h)
	}
	return out
}

// processCmdline reads a process command line (Windows 8.1+), which only needs
// PROCESS_QUERY_LIMITED_INFORMATION — the same access Task Manager uses.
func processCmdline(h windows.Handle) string {
	var need uint32
	buf := make([]byte, 8192)
	for i := 0; i < 2; i++ {
		err := windows.NtQueryInformationProcess(h, windows.ProcessCommandLineInformation, unsafe.Pointer(&buf[0]), uint32(len(buf)), &need)
		if err == nil {
			us := (*windows.NTUnicodeString)(unsafe.Pointer(&buf[0]))
			if us.Buffer == nil || us.Length == 0 {
				return ""
			}
			return windows.UTF16ToString(unsafe.Slice(us.Buffer, us.Length/2))
		}
		if need <= uint32(len(buf)) || need > 1<<20 {
			return ""
		}
		buf = make([]byte, need)
	}
	return ""
}

func extraLockfiles() []string { return nil }

// restartSelf launches the (possibly just updated) executable and exits.
func restartSelf() {
	exe, err := os.Executable()
	if err == nil {
		_ = exec.Command(exe).Start()
	}
	os.Exit(0)
}
