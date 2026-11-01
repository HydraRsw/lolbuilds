#!/usr/bin/env bash
# Publishes a new LoLBuilds version as a GitHub release that installed apps pick up automatically.
#
#   ./release.sh 1.2.1 "Notas de la versión"            -> UI-only update (no new .exe for users)
#   ./release.sh 1.3.0 "Notas" --exe                    -> also ships a new LoLBuilds.exe
#
# Apps check the latest release every 3 hours (and from Ajustes → Buscar actualizaciones):
#   - UI changes (web/) are applied live, without restarting or downloading a new .exe.
#   - When --exe is given, the app replaces its own .exe and asks to restart.
set -euo pipefail
VER="$1"; NOTES="${2:-}"; WITH_EXE="${3:-}"
REPO="${REPO:-HydraRsw/lolbuilds}"
cd "$(dirname "$0")"
OUT="dist/release-$VER"; rm -rf "$OUT"; mkdir -p "$OUT"

# Oldest exe able to run this UI. Bump it only when the UI starts using a new backend endpoint.
MIN_EXE="$(python3 -c 'import json;print(json.load(open("web/version.json")).get("minExe","1.0.0"))')"
python3 - "$VER" "$MIN_EXE" <<'EOF'
import json, sys
json.dump({"version": sys.argv[1], "minExe": sys.argv[2]}, open("web/version.json", "w"))
EOF
(cd web && zip -qr "../$OUT/web.zip" .)

EXE_VER="$(python3 -c 'import re;print(re.search(r"appVersion = \"([^\"]+)\"", open("update.go").read()).group(1))')"
if [[ "$WITH_EXE" == "--exe" ]]; then
  EXE_VER="$VER"
  sed -i -E "s/^var appVersion = \"[^\"]+\"/var appVersion = \"$VER\"/" update.go
fi
# The exe is always attached (with the latest UI embedded) so new users can download it.
# Installed apps only replace their exe when "exe" in update.json is newer than theirs.
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-H windowsgui -s -w" -o "$OUT/LoLBuilds.exe" .

python3 - "$OUT" "$VER" "$EXE_VER" "$MIN_EXE" "$NOTES" <<'EOF'
import hashlib, json, os, sys
out, ver, exe, min_exe, notes = sys.argv[1:]
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
m = {"version": ver, "ui": ver, "exe": exe, "minExe": min_exe, "notes": notes, "uiSha256": sha(f"{out}/web.zip")}
if os.path.exists(f"{out}/LoLBuilds.exe"):
    m["exeSha256"] = sha(f"{out}/LoLBuilds.exe")
json.dump(m, open(f"{out}/update.json", "w"), indent=1)
print(json.dumps(m, indent=1))
EOF

gh release create "v$VER" "$OUT"/* --repo "$REPO" --title "LoLBuilds $VER" --notes "${NOTES:-Actualización}"
echo "Publicado v$VER en $REPO"
