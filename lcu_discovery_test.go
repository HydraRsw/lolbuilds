package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCredsFromCmdline(t *testing.T) {
	c := credsFromCmdline(`"C:\Riot Games\TFT\TFTClient.exe" --riotclient-auth-token=abc --app-port=51234 --remoting-auth-token=Xy_z-9 --app-pid=1`, "x")
	if c == nil || c.Port != "51234" || c.Pass != "Xy_z-9" {
		t.Fatalf("got %+v", c)
	}
	if credsFromCmdline("--app-port=1", "x") != nil {
		t.Fatal("token missing must fail")
	}
}

func TestGameAndInteresting(t *testing.T) {
	if tft, _ := isGameProcess("TFTClient-Win64-Shipping.exe"); !tft {
		t.Fatal("tft game")
	}
	if _, lol := isGameProcess("League of Legends.exe"); !lol {
		t.Fatal("lol game")
	}
	for _, n := range []string{"LeagueClientUx.exe", "TFTClient.exe", "RiotClientServices.exe"} {
		if !interesting(n, "") {
			t.Fatal(n)
		}
	}
	if interesting("vgc.exe", `C:\Program Files\Riot Vanguard\vgc.exe`) || interesting("LeagueClientUxRender.exe", "") == false {
		t.Fatal("filter")
	}
	if !interesting("Launcher.exe", `D:\Riot Games\Teamfight Tactics\Launcher.exe`) {
		t.Fatal("riot folder")
	}
}

func TestMetadataYAML(t *testing.T) {
	dir := t.TempDir()
	md := filepath.Join(dir, "Riot Games", "Metadata", "tft.live")
	_ = os.MkdirAll(md, 0o755)
	_ = os.WriteFile(filepath.Join(md, "tft.live.product_settings.yaml"), []byte("product_install_full_path: \"D:/Riot Games/Teamfight Tactics\"\nproduct_install_root: \"D:/Riot Games\"\n"), 0o644)
	t.Setenv("ProgramData", dir)
	got := metadataInstallDirs()
	if len(got) != 1 || filepath.ToSlash(got[0]) != "D:/Riot Games/Teamfight Tactics" {
		t.Fatalf("got %v", got)
	}
}
