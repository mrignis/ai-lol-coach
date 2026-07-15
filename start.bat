@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AI LoL Coach
echo ============================================
echo    AI LoL Coach
echo    Open: http://localhost:3000
echo    Keep this window open while using the app.
echo    Press Ctrl+C or close the window to stop.
echo ============================================
echo.
start "" http://localhost:3000
npm start
echo.
echo Server stopped. Press any key to close.
pause >nul
