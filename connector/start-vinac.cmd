@echo off
rem Double-click on Windows to start VINAC Link and open its page.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b 1)
node bin\vinac.mjs daemon --open
pause
