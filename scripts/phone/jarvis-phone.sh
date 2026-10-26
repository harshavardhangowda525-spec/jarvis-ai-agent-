#!/data/data/com.termux/files/usr/bin/bash
# JARVIS phone: run this on the spare Android phone (in Termux). It works over
# Wi-Fi only, with no SIM plan. The phone checks in with JARVIS on your PC every
# few seconds. When a task completes, fails or needs your approval, it sends
# you the details on WhatsApp and then WhatsApp-calls you.
#
# Starting a WhatsApp call needs Android's own control (the same access a USB
# cable gives), so this script uses Wireless debugging on the phone itself.
# No root. Pair once (see JARVIS > Settings > Phone calls), then:
#
# First run:  bash jarvis-phone.sh http://<PC-IP>:3000 <pairing-token>
# Afterwards: bash jarvis-phone.sh        (it remembers both)
#
# Needs: pkg install -y curl jq android-tools

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

for c in curl jq adb; do
  if ! command -v "$c" >/dev/null 2>&1; then
    echo "Missing $c. Run:  pkg install -y curl jq android-tools"
    exit 1
  fi
done

export ADB_MDNS_OPENSCREEN=1
termux-wake-lock >/dev/null 2>&1
MODEL=$(getprop ro.product.model 2>/dev/null)
now() { date +%H:%M:%S; }

# ---- Android control over Wireless debugging --------------------------------
ADB_TARGET="${ADB_TARGET:-}"
ash() { timeout 25 adb -s "$ADB_TARGET" shell "$@" 2>/dev/null; }
adb_ok() { [ -n "$ADB_TARGET" ] && [ "$(ash echo ok | tr -d '\r')" = "ok" ]; }
connect_adb() {
  adb_ok && return 0
  local t
  for t in $(timeout 10 adb mdns services 2>/dev/null | awk '/_adb-tls-connect/ {print $NF}') $(timeout 5 adb devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1}'); do
    timeout 10 adb connect "$t" >/dev/null 2>&1
    ADB_TARGET="$t"
    if adb_ok; then echo "$(now) Android control connected ($t)"; return 0; fi
  done
  ADB_TARGET=""
  return 1
}

# tap the first on-screen element whose XML matches a pattern
tap() {
  local pat="$1" b
  ash uiautomator dump /sdcard/jarvis-ui.xml >/dev/null
  b=$(ash cat /sdcard/jarvis-ui.xml | tr '>' '\n' | grep -E "$pat" | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1 | grep -o '[0-9][0-9]*' | tr '\n' ' ')
  set -- $b
  [ $# -eq 4 ] || return 1
  ash input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
}

wake() { ash input keyevent KEYCODE_WAKEUP; ash wm dismiss-keyguard; sleep 1; }

# WhatsApp message with the details (best effort: the call is what matters)
wa_message() {
  local digits="$1" text enc
  text="$2"
  enc=$(printf '%s' "$text" | jq -sRr @uri)
  ash am start -a android.intent.action.VIEW -d "'https://api.whatsapp.com/send?phone=$digits&text=$enc'" -p com.whatsapp >/dev/null
  sleep 5
  tap 'resource-id="com.whatsapp:id/send"' || return 1
  sleep 2
  ash input keyevent KEYCODE_HOME
}

# WhatsApp voice call through the contact entry WhatsApp creates for that number
wa_call() {
  local digits="$1" tail id
  tail="${digits: -10}"
  id=$(ash content query --uri content://com.android.contacts/data --projection _id:data1 \
        --where "\"mimetype='vnd.android.cursor.item/vnd.com.whatsapp.voip.call'\"" \
        | grep "$tail" | head -1 | sed -n 's/.*_id=\([0-9]*\).*/\1/p')
  if [ -z "$id" ]; then
    echo "your number isn't a WhatsApp contact on the spare phone yet (save it in Contacts, then open WhatsApp > New chat > Refresh)"
    return 1
  fi
  ash am start -a android.intent.action.VIEW -d "content://com.android.contacts/data/$id" \
      -t vnd.android.cursor.item/vnd.com.whatsapp.voip.call -p com.whatsapp >/dev/null
  sleep 4
  # some WhatsApp versions ask "Call X?" first
  tap 'text="(Call|CALL|Voice call)"' >/dev/null 2>&1 && sleep 2
  if ash dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' | grep -qi 'voip'; then return 0; fi
  echo "WhatsApp didn't open the call screen (keep the spare phone's screen lock set to None)"
  return 1
}

echo "JARVIS phone is running. It checks $JARVIS_URL every few seconds."
echo "Leave Termux running. Press Ctrl+C to stop."
connect_adb || echo "$(now) Android control isn't connected yet: turn on Wireless debugging (it pairs once; see JARVIS > Settings > Phone calls)."

while true; do
  STATE="WhatsApp ready"; adb_ok || connect_adb || STATE="Wireless debugging not connected"
  DEVICE=$(printf '%s - %s' "$MODEL" "$STATE" | jq -sRr @uri)
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
    MSG=$(printf '%s' "$R" | jq -r .data.call.message)
    DIGITS="${TO//[^0-9]/}"
    NOTE=""; OK=false
    if ! adb_ok && ! connect_adb; then
      NOTE="Wireless debugging isn't connected on the spare phone"
    else
      wake
      wa_message "$DIGITS" "$MSG" || NOTE="the WhatsApp message didn't send"
      if OUT=$(wa_call "$DIGITS"); then OK=true; else NOTE="${NOTE:+$NOTE; }${OUT:-the WhatsApp call could not be started}"; fi
    fi
    BODY=$(jq -n --arg id "$ID" --argjson ok "$OK" --arg e "$NOTE" '{id:$id, ok:$ok, error:(if $e == "" then null else $e end)}')
    curl -sS -m 20 -X POST -H "Authorization: Bearer $JARVIS_TOKEN" -H "Content-Type: application/json" -d "$BODY" "$JARVIS_URL/api/phone/device/ack" >/dev/null 2>&1
    echo "$(now) WhatsApp-called $TO: $([ "$OK" = true ] && echo ok || echo failed)${NOTE:+ ($NOTE)}"
  fi
  sleep "$POLL"
done
