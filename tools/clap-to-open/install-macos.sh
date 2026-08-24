#!/usr/bin/env bash
# ============================================================================
#  JARVIS clap launcher - one-click installer for macOS.
#
#  Installs dependencies and registers a LaunchAgent so the clap listener
#  starts automatically (in the background) every time you log in.
#
#  Run once:   bash install-macos.sh
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/jarvis_clap.py"
PY="$(command -v python3 || true)"

if [ -z "$PY" ]; then
  echo "[!] python3 not found. Install it from https://www.python.org/downloads/ and re-run."
  exit 1
fi

echo "Installing dependencies (sounddevice, numpy)..."
"$PY" -m pip install --quiet --upgrade sounddevice numpy

PLIST="$HOME/Library/LaunchAgents/com.jarvis.clap.plist"
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.jarvis.clap</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PY</string>
    <string>$SCRIPT</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo
echo "Done. The clap listener now starts automatically at login and is running now."
echo "macOS will ask for microphone permission the first time - allow it."
echo
echo "To stop auto-start:  launchctl unload \"$PLIST\" && rm \"$PLIST\""
