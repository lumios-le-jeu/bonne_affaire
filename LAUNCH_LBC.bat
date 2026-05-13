@echo off
setlocal
cd /d "%~dp0\lba-app"
echo --- LANCEMENT DU TRACKER LEBONCOIN v1.0 ---
echo.
echo 1. Ouverture du Dashboard dans le navigateur...
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"
echo.
echo 2. Demarrage du serveur Next.js...
npm run dev
pause
