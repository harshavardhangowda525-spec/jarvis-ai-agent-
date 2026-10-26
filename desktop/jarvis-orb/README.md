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
