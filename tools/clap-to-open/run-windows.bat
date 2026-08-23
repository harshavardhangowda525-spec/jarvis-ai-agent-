@echo off
REM Double-click to start the JARVIS clap launcher on Windows.
REM Requires Python 3 and: pip install sounddevice numpy
python "%~dp0jarvis_clap.py" %*
pause
