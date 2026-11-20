@echo off
rem VINAC Link: connect an AI agent app (Windows). Adds the Claude Code plugin if you say yes;
rem for other apps it prints what to paste.
cd /d "%~dp0"
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"
node connector\bin\vinac.mjs setup
echo.
where claude >nul 2>nul
if errorlevel 1 goto noclaude
choice /m "Add VINAC Link to Claude Code now"
if errorlevel 2 goto end
claude plugin marketplace add "%~dp0."
claude plugin install vinac-link@vinac
echo.
echo Done. Start a new Claude Code session and ask: "is VINAC Link working?"
goto end

:noclaude
echo (Claude Code was not found on this computer, so nothing was added. Use the steps above for your app.)

:end
pause
