//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// Non-Windows build: used for development and testing. Serves the UI on a
// fixed port and prints the URL.
func main() {
	if len(os.Args) > 2 && os.Args[1] == "--export-tft" {
		if err := exportTFT(os.Args[2]); err != nil {
			fmt.Println("export:", err)
			os.Exit(1)
		}
		return
	}
	addr := os.Getenv("LOLB_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8777"
	}
	base, _, err := startServer(addr)
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
	fmt.Println("LoL Builds en", base)
	select {}
}

func openBrowser(u string) { _ = exec.Command("xdg-open", u).Start() }

// LOLB_LOCKFILE: lockfile path for development. LOLB_FAKE_PROCS simulates
// running processes: "name|path|cmdline;name|path|cmdline".
func extraLockfiles() []string {
	if p := os.Getenv("LOLB_LOCKFILE"); p != "" {
		return []string{p}
	}
	return nil
}

func listRiotProcesses(full bool) []procInfo {
	var out []procInfo
	for _, e := range strings.Split(os.Getenv("LOLB_FAKE_PROCS"), ";") {
		f := strings.SplitN(e, "|", 3)
		if f[0] == "" {
			continue
		}
		p := procInfo{Name: f[0]}
		if len(f) > 1 {
			p.Path = f[1]
		}
		if len(f) > 2 {
			p.cmdline = f[2]
		}
		out = append(out, p)
	}
	return out
}

func restartSelf() { fmt.Println("restart requested (no-op outside Windows)") }
