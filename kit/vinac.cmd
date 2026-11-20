@echo off
rem Run VINAC Link commands from this folder, e.g.:  vinac send-file report.pdf --to "Office PC"
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"
node "%~dp0connector\bin\vinac.mjs" %*
