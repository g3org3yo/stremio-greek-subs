@echo off
chcp 65001 >nul
title Συντόμευση — Ελληνικοί Υπότιτλοι
cd /d "%~dp0"

rem --- Προαιρετικό: φτιάχνει συντόμευση στην Επιφάνεια Εργασίας ---
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\make-shortcuts.ps1" %*
echo.
pause
