@echo off
setlocal
cd /d "%~dp0"
if not exist "runtime\win-x64\node.exe" goto missing
"runtime\win-x64\node.exe" "scripts\start.mjs" --open
if errorlevel 1 pause
exit /b
:missing
echo Bundled Node.js is missing. Extract the whole ZIP, then try again.
pause
exit /b 1
