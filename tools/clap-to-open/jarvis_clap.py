#!/usr/bin/env python3
"""JARVIS clap launcher.

A tiny background listener for your computer. It watches the microphone and,
when you CLAP TWICE in quick succession, opens the JARVIS web app in your
default browser — even if no browser window is currently open.

Why this exists: a website's code only runs while its tab is open, so a web
page can never launch itself. This small helper runs on your machine instead
and does the launching for you.

Setup (one time):
    pip install sounddevice numpy

Run:
    python jarvis_clap.py
    python jarvis_clap.py --url https://your-app.vercel.app
    JARVIS_URL=https://your-app.vercel.app python jarvis_clap.py

Tuning:
    --threshold 0.35   lower = more sensitive (more false triggers),
                       higher = you must clap louder. Default 0.35.

Stop with Ctrl+C.
"""
import argparse
import os
import sys
import time
import webbrowser

try:
    import numpy as np
    import sounddevice as sd
except ImportError:
    sys.exit(
        "Missing dependencies. Install them with:\n\n    pip install sounddevice numpy\n"
    )

DEFAULT_URL = "https://jarvis-ai-agent-llrn.vercel.app"
SAMPLE_RATE = 44100
BLOCK = 1024
MIN_GAP = 0.12   # seconds: ignore extra frames within one clap
MAX_GAP = 1.20   # seconds: the second clap must land within this window
COOLDOWN = 5.0   # seconds: after opening, ignore claps for a bit


def main() -> None:
    ap = argparse.ArgumentParser(description="Open JARVIS on a double clap.")
    ap.add_argument("--url", default=os.environ.get("JARVIS_URL", DEFAULT_URL),
                    help="JARVIS URL to open (default: %(default)s)")
    ap.add_argument("--threshold", type=float, default=0.35,
                    help="Clap loudness 0..1 (default: %(default)s)")
    args = ap.parse_args()

    state = {"count": 0, "last": 0.0, "opened": 0.0}

    def open_jarvis() -> None:
        print(f"\U0001F44F\U0001F44F  Double clap detected — opening JARVIS: {args.url}")
        webbrowser.open(args.url)

    def callback(indata, frames, time_info, status) -> None:  # noqa: ANN001
        now = time.monotonic()
        if now - state["opened"] < COOLDOWN:
            return
        peak = float(np.max(np.abs(indata)))
        if peak > args.threshold and now - state["last"] > MIN_GAP:
            state["count"] = state["count"] + 1 if (now - state["last"]) < MAX_GAP else 1
            state["last"] = now
            if state["count"] >= 2:
                state["count"] = 0
                state["opened"] = now
                open_jarvis()

    print("JARVIS clap launcher is running.")
    print(f"  URL      : {args.url}")
    print(f"  Threshold: {args.threshold}")
    print("  Clap twice to open JARVIS. Press Ctrl+C to stop.\n")

    try:
        with sd.InputStream(channels=1, samplerate=SAMPLE_RATE,
                            blocksize=BLOCK, callback=callback):
            while True:
                time.sleep(0.1)
    except KeyboardInterrupt:
        print("\nStopped.")
    except Exception as exc:  # noqa: BLE001
        print(f"Error: {exc}", file=sys.stderr)
        print("Tip: make sure a microphone is connected and allowed.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
