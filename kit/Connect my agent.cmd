@echo off
rem VINAC Link: connect an AI agent app (Windows). Connects Claude Code if you say yes (no `claude`
rem command needed; its settings are backed up first); for other apps it prints what to paste.
cd /d "%~dp0"
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"
node connector\bin\vinac.mjs setup
echo.
if not exist "%USERPROFILE%\.claude" if not exist "%USERPROFILE%\.claude.json" goto noclaude
choice /m "Connect Claude Code to VINAC Link now"
if errorlevel 2 goto end
node connector\bin\vinac.mjs connect claude
echo.
echo Start a new Claude Code session and ask: "is VINAC Link working?"
goto end

:noclaude
echo (Claude Code was not found on this computer, so nothing was added. Use the steps above for your app.)

:end
pause
