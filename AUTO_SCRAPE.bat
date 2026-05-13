@echo off
setlocal
cd /d "%~dp0\lba-app"
echo --- MISE A JOUR AUTOMATIQUE (CRON) LEBONCOIN ---
echo.
npx tsx cron.ts
echo.
echo Termine.
timeout /t 5 >nul
