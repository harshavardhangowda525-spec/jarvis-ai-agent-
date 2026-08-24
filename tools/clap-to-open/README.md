# JARVIS clap launcher 👏👏

Open the JARVIS web app by **clapping twice** — even when no browser window is
open. The listener runs in the background and pops your browser open to JARVIS.

## Why this is a separate app

A website's JavaScript only runs while its tab is open, so a web page can never
launch *itself* when the browser is closed. To open JARVIS from a clap while
nothing is running, something has to be listening on your computer in the
background. That's what this tiny helper does: it listens to your microphone
and opens the JARVIS URL when it hears a double clap.

(Inside the JARVIS tab, once it's open, two claps or saying **"Jarvis wake up"**
already activate the voice assistant — that part is built into the web app.)

## Easiest setup — always ready, starts by itself

Run the installer **once**. It installs the dependencies and makes the listener
start automatically (and invisibly) every time you log in, so JARVIS is always
one double-clap away — no terminal to keep open.

- **Windows:** double-click **`install-windows.bat`**.
- **macOS:** run **`bash install-macos.sh`** in Terminal.
- **Linux:** `pip install sounddevice numpy`, then add
  `python3 /full/path/to/jarvis_clap.py &` to your desktop's autostart.

That's it. Clap twice anywhere → JARVIS opens. The first run asks for
microphone permission — allow it.

> Set your URL: edit `DEFAULT_URL` near the top of `jarvis_clap.py` to your
> deployment (e.g. `https://jarvis-ai-agent-llrn.vercel.app`) **before** running
> the installer, or pass `--url https://your-app.vercel.app` when running by hand.

## Run manually instead (no auto-start)

```
pip install sounddevice numpy          # one time
python jarvis_clap.py                   # Windows
python3 jarvis_clap.py                  # macOS / Linux
python jarvis_clap.py --url https://your-app.vercel.app
```

Clap twice → JARVIS opens in your default browser. Press `Ctrl+C` to stop.

## How the clap detection works (why it won't trigger on talking)

A clap is a short, sharp **transient** — a loud spike that dies away almost
instantly. The listener only fires when it sees **two** such spikes separated
by a brief silence, and it judges loudness *relative to your room*, not an
absolute number. Sustained sounds (talking, music, a fan) don't match that
pattern, so they don't open JARVIS.

## Tuning

Too sensitive (opens on any noise) or not sensitive enough?
```
python jarvis_clap.py --threshold 0.45   # louder claps required
python jarvis_clap.py --threshold 0.20   # more sensitive
```
Pick a specific mic with `--device "Microphone name"` (or a device index).

## Stop auto-start later

- **Windows:** press `Win+R`, type `shell:startup`, delete `jarvis-clap.vbs`.
- **macOS:** `launchctl unload ~/Library/LaunchAgents/com.jarvis.clap.plist && rm ~/Library/LaunchAgents/com.jarvis.clap.plist`

## Notes

- This listens **locally only**. It doesn't record or send audio anywhere; it
  just watches the loudness pattern for the double clap and opens a URL.
- It needs to be running to hear you — that's why the installer sets it to start
  at login. A truly powered-off computer can't listen for a clap.
