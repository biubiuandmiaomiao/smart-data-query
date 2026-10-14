@echo off
setlocal
cd /d "%~dp0"
"runtime\win-x64\node.exe" "scripts\doctor.mjs"
pause
