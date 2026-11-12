@echo off
rem Checks JARVIS's AI keys (Groq, Gemini, OpenRouter) - never shows the keys.
cd /d "%~dp0"
node scripts\check-ai.mjs
pause
