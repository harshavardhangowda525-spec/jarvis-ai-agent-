# JARVIS clap launcher 👏👏

Open the JARVIS web app by **clapping twice** — even when no browser window is
open.

## Why this is a separate app

A website's JavaScript only runs while its tab is open, so a web page can never
launch *itself* when the browser is closed. To open JARVIS from a clap while
nothing is running, something has to be listening on your computer in the
background. That's what this tiny helper does: it listens to your microphone
and opens the JARVIS URL when it hears a double clap.

(Inside the JARVIS tab, once it's open, two claps or saying **"Jarvis wake up"**
already activate the voice assistant — that part is built into the web app.)

## Setup (one time)

1. Install [Python 3](https://www.python.org/downloads/) if you don't have it.
2. Install the two dependencies:
   ```
   pip install sounddevice numpy
   ```

## Run

- **Windows:** double-click `run-windows.bat` (or run `python jarvis_clap.py`).
- **macOS / Linux:**
  ```
  python3 jarvis_clap.py
  ```

Point it at your own deployment if the URL differs:
```
python jarvis_clap.py --url https://your-app.vercel.app
```

Clap twice → JARVIS opens in your default browser. Press `Ctrl+C` to stop.

## Tuning

Too sensitive (opens on any noise) or not sensitive enough?
```
python jarvis_clap.py --threshold 0.5   # louder claps required
python jarvis_clap.py --threshold 0.25  # more sensitive
```

## Start it automatically at login (optional)

So it's always ready:

- **Windows:** press `Win+R`, type `shell:startup`, and drop a shortcut to
  `run-windows.bat` into the folder that opens.
- **macOS:** System Settings → General → Login Items → add a small script/app
  that runs `python3 jarvis_clap.py`.
- **Linux:** add `python3 /path/to/jarvis_clap.py &` to your desktop autostart.

## Notes

- The first run may ask for microphone permission — allow it.
- This listens **locally only**. It doesn't record or send audio anywhere; it
  just watches the loudness level for the clap pattern and opens a URL.
