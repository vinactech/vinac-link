@echo off
rem VINAC Link: stop the background service (Windows).
cd /d "%~dp0"
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"
node connector\bin\vinac.mjs stop
pause
