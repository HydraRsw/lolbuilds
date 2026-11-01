//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
)

// Non-Windows build: used for development and testing. Serves the UI on a
// fixed port and prints the URL.
func main() {
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

func lockfileCandidates() []string {
	if p := os.Getenv("LOLB_LOCKFILE"); p != "" {
		return []string{p}
	}
	return nil
}

func restartSelf() { fmt.Println("restart requested (no-op outside Windows)") }
