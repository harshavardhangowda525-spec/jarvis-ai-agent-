#!/data/data/com.termux/files/usr/bin/bash
# JARVIS phone: run this on the spare Android phone (in Termux). That phone
# becomes JARVIS's phone and its SIM number becomes JARVIS's number. It checks
# in with JARVIS on your PC every few seconds. When a task completes, fails or
# needs your approval, it texts you the details and rings your number.
#
# First run:  bash jarvis-phone.sh http://<PC-IP>:3000 <pairing-token>
# Afterwards: bash jarvis-phone.sh        (it remembers both)
#
# Needs: pkg install -y curl jq termux-api, plus the Termux:API app (F-Droid).

CONF="$HOME/.jarvis-phone"
if [ -n "$1" ] && [ -n "$2" ]; then
  printf 'JARVIS_URL=%q\nJARVIS_TOKEN=%q\n' "${1%/}" "$2" > "$CONF"
  chmod 600 "$CONF"
fi
if [ ! -f "$CONF" ]; then
  echo "Usage: bash jarvis-phone.sh http://<PC-IP>:3000 <pairing-token>"
  echo "(Both are shown in JARVIS > Settings > Phone calls > Pair phone.)"
  exit 1
fi
. "$CONF"

for c in curl jq termux-telephony-call termux-sms-send; do
  if ! command -v "$c" >/dev/null 2>&1; then
    echo "Missing $c. Run:  pkg install -y curl jq termux-api"
    echo "and install the Termux:API app (from F-Droid, same source as Termux)."
    exit 1
  fi
done

termux-wake-lock >/dev/null 2>&1
DEVICE=$(getprop ro.product.model 2>/dev/null | tr -c 'A-Za-z0-9\n' '+' | head -c 60)
now() { date +%H:%M:%S; }
echo "JARVIS phone is running. It checks $JARVIS_URL every few seconds."
echo "Leave Termux running. Press Ctrl+C to stop."

while true; do
  R=$(curl -sS -m 20 -H "Authorization: Bearer $JARVIS_TOKEN" "$JARVIS_URL/api/phone/device/next?device=$DEVICE" 2>&1)
  if ! printf '%s' "$R" | jq -e . >/dev/null 2>&1; then
    echo "$(now) can't reach JARVIS (is the PC on, npm run local running, same Wi-Fi?): ${R:0:120}"
    sleep 30; continue
  fi
  if [ "$(printf '%s' "$R" | jq -r .ok)" != "true" ]; then
    echo "$(now) $(printf '%s' "$R" | jq -r '.error // "JARVIS refused"')"
    sleep 60; continue
  fi
  POLL=$(printf '%s' "$R" | jq -r '.data.pollSeconds // 15')
  ID=$(printf '%s' "$R" | jq -r '.data.call.id // empty')
  if [ -n "$ID" ]; then
    TO=$(printf '%s' "$R" | jq -r .data.call.to)
    SMS=$(printf '%s' "$R" | jq -r .data.call.sms)
    NOTE=""
    # the text first, so the details are waiting when you pick up
    timeout 40 termux-sms-send -n "$TO" "$SMS" >/dev/null 2>&1 || NOTE="the text message didn't send"
    sleep 2
    if timeout 40 termux-telephony-call "$TO" >/dev/null 2>&1; then OK=true; else OK=false; NOTE="${NOTE:+$NOTE; }the call couldn't be placed (allow Phone permission for Termux:API)"; fi
    BODY=$(jq -n --arg id "$ID" --argjson ok "$OK" --arg e "$NOTE" '{id:$id, ok:$ok, error:(if $e == "" then null else $e end)}')
    curl -sS -m 20 -X POST -H "Authorization: Bearer $JARVIS_TOKEN" -H "Content-Type: application/json" -d "$BODY" "$JARVIS_URL/api/phone/device/ack" >/dev/null 2>&1
    echo "$(now) rang $TO${NOTE:+ ($NOTE)}"
  fi
  sleep "$POLL"
done
