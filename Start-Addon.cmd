@echo off
chcp 65001 >nul
title Ελληνικοί Υπότιτλοι — Stremio
cd /d "%~dp0"

rem --- Βρες το Node.js: πρώτα από το PATH, αλλιώς από τη γνωστή θέση ---
set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE if exist "D:\Hermes Agent\Tools\node\node.exe" set "NODE=D:\Hermes Agent\Tools\node\node.exe"
if not defined NODE (
  echo  Δεν βρήκα το Node.js. Κατέβασέ το από το nodejs.org και ξαναδοκίμασε.
  pause
  exit /b 1
)

if not exist ".env" (
  echo  Λείπει το .env με τα κλειδιά ^(SUBDL_API_KEY, GEMINI_API_KEY^).
  pause
  exit /b 1
)

rem --- 'quiet' = μόνο ο server (για την αυτόματη εκκίνηση), χωρίς άνοιγμα browser ---
if /i "%~1"=="quiet" (
  "%NODE%" bin\start.js
) else (
  "%NODE%" bin\launch.js
)

echo.
echo Ο server σταμάτησε.
pause
