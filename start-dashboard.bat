@echo off
cd /d "%~dp0"
set PORT=3001
echo Starting Alutrend website + dashboard on port %PORT%...
start "" http://127.0.0.1:%PORT%/admin/
node server.js
pause
