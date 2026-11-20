@echo off
rem VINAC Link: check that everything works (changes nothing). Send the result as feedback.
cd /d "%~dp0"
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"
node connector\bin\vinac.mjs doctor
echo.
pause
