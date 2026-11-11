# JARVIS 2.0 — the floating desktop orb

A small holographic orb in the bottom-right corner of your screen that you talk
to (or type to) and that controls apps on your computer. It's a real desktop
app (Electron), not a web page.

```
npm run local      # JARVIS itself (the brain, voice and your account)
npm run orb        # the orb (installs Electron the first time, ~100 MB)
npm run orb -- --quit
```

Click the orb to open the chat. Drag it to move it; it remembers where you put
it. Right-click its tray icon for: hide/show, pause all automation, desktop
control on/off, keep above other windows, start at login, the activity log, and
Quit.

| Shortcut | What it does |
|---|---|
| Ctrl+Alt+J | open / close the chat |
| Ctrl+Alt+Space | push to talk |
| Ctrl+Alt+Backspace | emergency stop (ends the running command) |
| Ctrl+Alt+P | pause / resume all automation |

## What you can say

- "JARVIS, open apps" → "Which application would you like to open?" → "Chrome and VS Code"
- "Open Chrome, open my business website, and then open VS Code"
- "Switch to VS Code", "minimise Spotify", "maximise Chrome", "restore Word"
- "Put Chrome and VS Code side by side", "show the desktop", "what apps are open?", "what app am I in?"
- "Show my apps" (a searchable launcher), "open a new Chrome window", "scroll down in Chrome"
- "Open my Downloads folder", "find my JARVIS project", "search for my latest website project", "open it"
- "Switch to my Infinity Web & Apps project" (opens it in VS Code; add the folder in settings so it's instant)
- "Create a new project folder called Acme Gym"
- "Type hello in Notepad", "press control s in Word", "close Spotify" (these always ask you first)
- "Take a screenshot" (saved in Pictures/JARVIS Screenshots, never uploaded)
- "Stop", "pause automation", "resume automation"

Anything else ("what's on my calendar?", "ask Darwin to find gyms") goes to
JARVIS's brain, with the same conversation, tools and agents as the main JARVIS.

## Prospect calls through Phone Link (Windows)

JARVIS phones the leads **you approved** in the CRM from **your own number**:
Phone Link places the call through your Android phone, JARVIS speaks into it and
listens, follows the call flow in your operating manual (Part 6), and updates
the CRM after every call (outcome, 3-line summary, transcript, next action).

**One-time setup on the laptop**
1. **Phone Link** (Microsoft Store) with your Android phone paired and **Calls**
   set up (Bluetooth). Make one call from Phone Link by hand to be sure it works.
2. **VB-Audio Virtual Cable** (free, vb-audio.com/Cable). Restart afterwards.
3. Windows **Settings → System → Sound → Volume mixer → Phone Link**: set its
   **input (microphone) to "CABLE Output"**. Leave its output on your speakers or
   headphones (that's how JARVIS hears the other person, and how you can listen in).
4. JARVIS's voice must be configured (ElevenLabs key in JARVIS) — the phone
   voice uses it.
5. Orb tray icon → **Prospect calls…** → **Run check** (all green), choose
   **CABLE Input** as where JARVIS's voice goes, then **Start calling**.

**How a call goes.** JARVIS dials (`tel:` → Phone Link, presses Call), waits for
the person to say hello, then opens: *"…This is Jarvis, an AI assistant calling
from Infinity Web & Apps, on behalf of Harshavardhan…"*. It always says it's an
AI and never claims to be human. "Don't call me again" ends the call at once and
marks the lead **Do not contact** forever. Voicemail / operator messages
("switched off", "not reachable") hang up and count as Not reachable. Calls last
at most 4 minutes. It never asks for payment details and only quotes prices you
filled in the catalogue.

**Rules it follows** (CRM → Calls → Settings): calling hours (default 10:00–19:00
Mon–Sat), calls per day (default 25), one try per lead per day, 3 tries total,
the "this call may be recorded" notice. Nothing is dialled until you press
**Approve** on the batch — JARVIS can plan calls but can't approve them.

**While it calls** the screen shows the glowing frame and "JARVIS is working —
On a call with …". **Stop** (or Ctrl+Alt+Backspace) hangs up at once.

**Honest limits.** Phone Link has no official API: JARVIS drives its window
with Windows UI Automation (the English button names "Call" / "End call"), so a
Phone Link update or another language can break dialling — the setup check and
the call log will say so. JARVIS hears the call through your speakers' sound,
so mute other audio (music, videos, notifications) while it calls. There's a
1–3 second pause before each reply (speech-to-text → JARVIS → voice).

## Permissions you grant

- **Desktop control**: the orb asks once ("Let JARVIS control apps on this computer?"). Change it any time in the tray menu.
- **Microphone**: Windows → Settings → Privacy & security → Microphone → allow desktop apps. macOS asks the first time.
- **macOS only**: Accessibility (System Settings → Privacy & Security → Accessibility) for switching apps, and Screen Recording for screenshots.
- **Sign in**: the first time you ask JARVIS something, press "Sign in" in the chat. A sign-in window opens and closes itself when you're done.

## Safety rules (built in)

- Apps come only from your computer's installed-app list; windows only from those open now. There is no shell and no arbitrary command: every OS call is a fixed program with its arguments passed as data, and nothing the AI writes is run as a command.
- Closing an app, typing, and keys that could send something (Enter, Ctrl+S…) only happen after you click **Yes** in a native dialog. A web page, the AI or a spoken "yes" can't answer it.
- Nothing is deleted or overwritten. A new folder is never created over an existing one.
- Pause stops every action until you resume. Stop ends a multi-step command between steps (an app that has already started keeps running).
- A launch is reported as done only when its window really appears. Otherwise the orb says it started but no window has appeared yet.
- Everything it does is written to the activity log on this computer (tray → Open the activity log). Screenshots and recordings never leave your computer; voice is only sent to your own JARVIS for transcription.

## What works where

| | Windows | macOS | Linux |
|---|---|---|---|
| Open installed apps, folders, websites, projects; find files | ✓ | ✓ | ✓ |
| Switch to an app | ✓ | ✓ | ✓ with `wmctrl` |
| Minimise / maximise / restore / close, side by side, what's open | ✓ | — | ✓ with `wmctrl` |
| Type and press keys | ✓ | — | type only, with `xdotool` |
| Transparent window | ✓ | ✓ | needs a compositor |

Mouse-pointer control (moving and clicking at screen positions) is deliberately
not included: blind clicks break as soon as a window moves. The orb works through
the OS's own window and keyboard interfaces instead.
