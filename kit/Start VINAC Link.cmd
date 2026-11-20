@echo off
rem VINAC Link: start the service and open its page (Windows).
title VINAC Link
cd /d "%~dp0"
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"
where node >nul 2>nul
if errorlevel 1 goto nonode
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 goto oldnode
node connector\bin\vinac.mjs start
if errorlevel 1 goto failed
echo.
echo If Windows asks whether Node.js may use the network, choose "Private networks" and Allow.
echo Next: pair with your other computer on the page that just opened (see START-HERE.html).
echo You can close this window; VINAC Link keeps running in the background.
pause
exit /b 0

:nonode
echo Node.js is not installed. Install the LTS version from https://nodejs.org
echo (or run: winget install OpenJS.NodeJS.LTS), then double-click this file again.
pause
exit /b 1

:oldnode
echo Your Node.js is too old. VINAC Link needs Node.js 22 or newer: https://nodejs.org
pause
exit /b 1

:failed
echo VINAC Link could not start. Run "Check VINAC Link.cmd" and send the result to whoever gave you this.
pause
exit /b 1
