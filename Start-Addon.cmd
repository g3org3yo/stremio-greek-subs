@echo off
chcp 65001 >nul
title Ελληνικοί Υπότιτλοι — Stremio
cd /d "%~dp0"

rem --- Βρες το Node.js: πρώτα το φορητό που ταξιδεύει μαζί, μετά το PATH, μετά γνωστή θέση ---
set "NODE="
if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"
if not defined NODE where node >nul 2>nul && set "NODE=node"
if not defined NODE if exist "D:\Hermes Agent\Tools\node\node.exe" set "NODE=D:\Hermes Agent\Tools\node\node.exe"
if not defined NODE (
  echo.
  echo  Δεν βρήκα το Node.js.
  echo  Κατέβασέ το δωρεάν από το https://nodejs.org ^(έκδοση LTS^) και ξαναδοκίμασε.
  echo.
  pause
  exit /b 1
)

rem --- Πρώτη φορά: φτιάξε το .env από το πρότυπο και άνοιξέ το να βάλεις τα κλειδιά σου ---
if not exist ".env" (
  if not exist ".env.example" (
    echo  Λείπει το .env και δεν υπάρχει .env.example για να το φτιάξω.
    pause
    exit /b 1
  )
  copy /y ".env.example" ".env" >nul
  echo.
  echo  Καλώς ήρθες! Πρώτη φορά, άνοιξα το αρχείο .env για σένα.
  echo.
  echo   1. Βάλε το κλειδί σου μετά το  SUBDL_API_KEY=
  echo      Δωρεάν: https://subdl.com  ^(Panel, μετά API^)
  echo   2. Βάλε το κλειδί σου μετά το  GEMINI_API_KEY=
  echo      Δωρεάν: https://aistudio.google.com/apikey
  echo   3. Αποθήκευσε με Ctrl+S και ΚΛΕΙΣΕ το Σημειωματάριο.
  echo   4. Τρέξε ξανά το Start-Addon.cmd
  echo.
  notepad ".env"
  pause
  exit /b 0
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
