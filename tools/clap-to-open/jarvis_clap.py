#!/usr/bin/env python3
"""JARVIS clap launcher.

A tiny always-on background listener for your computer. It watches the
microphone and, when you CLAP TWICE in quick succession, opens the JARVIS
web app in your default browser — even if no browser window is open.

Why this exists: a website's code only runs while its tab is open, so a web
page can never launch itself when the browser is closed. This small helper
runs on your machine instead and does the launching for you.

Setup (one time):
    pip install sounddevice numpy

Run:
    python jarvis_clap.py
    python jarvis_clap.py --url https://your-app.vercel.app
    JARVIS_URL=https://your-app.vercel.app python jarvis_clap.py

Detection: a clap is a short, sharp *transient* (a loud spike that dies away
almost instantly). We only fire when we see TWO such spikes separated by a
brief silence — so ongoing sounds like talking, music, or a running fan don't
trigger it. Tune with --threshold if needed.

Stop with Ctrl+C.
"""
import argparse
import os
import sys
import time
import webbrowser
from collections import deque

try:
    import numpy as np
    import sounddevice as sd
except ImportError:
    sys.exit(
        "Missing dependencies. Install them with:\n\n    pip install sounddevice numpy\n"
    )

# Point this at YOUR deployment. Override any time with --url or JARVIS_URL.
DEFAULT_URL = "https://jarvis-ai-agent-llrn.vercel.app"

SAMPLE_RATE = 44100
BLOCK = 512               # ~11.6 ms per block — fine-grained enough for transients
MIN_GAP = 0.10            # s: two impulses closer than this are one clap
MAX_GAP = 0.90           # s: the second clap must land within this window
COOLDOWN = 6.0           # s: after opening, ignore claps for a bit
QUIET_RATIO = 0.35       # the level must fall below threshold*this between claps
RISE_FACTOR = 3.0        # a clap must be this many x louder than recent background


def main() -> None:
    ap = argparse.ArgumentParser(description="Open JARVIS on a double clap.")
    ap.add_argument("--url", default=os.environ.get("JARVIS_URL", DEFAULT_URL),
                    help="JARVIS URL to open (default: %(default)s)")
    ap.add_argument("--threshold", type=float, default=0.30,
                    help="Clap loudness 0..1 (default: %(default)s). "
                         "Lower = more sensitive.")
    ap.add_argument("--device", default=None,
                    help="Input device name or index (default: system default)")
    args = ap.parse_args()

    # Rolling estimate of background loudness, so a clap is judged relative to
    # the room, not an absolute number. Reject sustained loud sounds (music).
    background = deque(maxlen=40)  # ~0.5 s of block peaks

    state = {
        "count": 0,          # claps seen so far in the current pattern
        "last_clap": 0.0,    # when the last valid clap impulse landed
        "opened": 0.0,       # when we last opened JARVIS
        "armed": True,       # must see quiet before accepting the next clap
    }

    def open_jarvis() -> None:
        print(f"\U0001F44F\U0001F44F  Double clap detected — opening JARVIS: {args.url}",
              flush=True)
        try:
            webbrowser.open(args.url, new=2)  # new=2: new browser tab/window
        except Exception as exc:  # noqa: BLE001
            print(f"Could not open browser: {exc}", file=sys.stderr, flush=True)

    def callback(indata, frames, time_info, status) -> None:  # noqa: ANN001
        now = time.monotonic()
        peak = float(np.max(np.abs(indata)))
        bg = (sum(background) / len(background)) if background else 0.0

        # Reset the pattern if the second clap never arrived in time.
        if state["count"] and now - state["last_clap"] > MAX_GAP:
            state["count"] = 0

        if now - state["opened"] < COOLDOWN:
            background.append(peak)
            return

        loud = peak > args.threshold and peak > bg * RISE_FACTOR
        quiet = peak < args.threshold * QUIET_RATIO

        # Re-arm only after the level falls back to quiet — this forces TWO
        # distinct impulses instead of one sustained loud noise.
        if quiet:
            state["armed"] = True

        if loud and state["armed"] and now - state["last_clap"] > MIN_GAP:
            state["armed"] = False
            in_window = (now - state["last_clap"]) < MAX_GAP
            state["count"] = state["count"] + 1 if in_window else 1
            state["last_clap"] = now
            if state["count"] >= 2:
                state["count"] = 0
                state["opened"] = now
                open_jarvis()

        # Only feed non-clap blocks into the background estimate.
        if not loud:
            background.append(peak)

    print("JARVIS clap launcher is running.", flush=True)
    print(f"  URL      : {args.url}", flush=True)
    print(f"  Threshold: {args.threshold}", flush=True)
    print("  Clap twice to open JARVIS. Press Ctrl+C to stop.\n", flush=True)

    device = args.device
    if device is not None:
        try:
            device = int(device)
        except (TypeError, ValueError):
            pass

    try:
        with sd.InputStream(channels=1, samplerate=SAMPLE_RATE, blocksize=BLOCK,
                            device=device, callback=callback):
            while True:
                time.sleep(0.1)
    except KeyboardInterrupt:
        print("\nStopped.")
    except Exception as exc:  # noqa: BLE001
        print(f"Error: {exc}", file=sys.stderr)
        print("Tip: make sure a microphone is connected and allowed.",
              file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
