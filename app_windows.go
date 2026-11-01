//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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

// lockfileCandidates finds the League client install folder from the running
// LeagueClientUx.exe / LeagueClient.exe process, plus the usual install paths.
func lockfileCandidates() []string {
	var out []string
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err == nil {
		defer windows.CloseHandle(snap)
		var pe windows.ProcessEntry32
		pe.Size = uint32(unsafe.Sizeof(pe))
		for err = windows.Process32First(snap, &pe); err == nil; err = windows.Process32Next(snap, &pe) {
			name := strings.ToLower(windows.UTF16ToString(pe.ExeFile[:]))
			if name != "leagueclientux.exe" && name != "leagueclient.exe" {
				continue
			}
			h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pe.ProcessID)
			if err != nil {
				continue
			}
			buf := make([]uint16, windows.MAX_LONG_PATH)
			n := uint32(len(buf))
			if windows.QueryFullProcessImageName(h, 0, &buf[0], &n) == nil {
				out = append(out, filepath.Join(filepath.Dir(windows.UTF16ToString(buf[:n])), "lockfile"))
			}
			windows.CloseHandle(h)
		}
	}
	for _, d := range []string{"C", "D", "E", "F"} {
		out = append(out,
			d+`:\Riot Games\League of Legends\lockfile`,
			d+`:\Program Files\Riot Games\League of Legends\lockfile`,
			d+`:\Juegos\Riot Games\League of Legends\lockfile`,
			d+`:\Games\Riot Games\League of Legends\lockfile`,
		)
	}
	return out
}

// restartSelf launches the (possibly just updated) executable and exits.
func restartSelf() {
	exe, err := os.Executable()
	if err == nil {
		_ = exec.Command(exe).Start()
	}
	os.Exit(0)
}
