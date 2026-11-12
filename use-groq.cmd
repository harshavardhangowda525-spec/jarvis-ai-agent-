@echo off
rem Make Groq JARVIS's main brain (fast), Gemini as backup; Claude off.
cd /d "%~dp0"
node scripts\set-brain.mjs groq
pause
