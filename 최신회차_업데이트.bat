@echo off
echo Updating lotto data to the latest round...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update-all.ps1"
echo.
echo Done. Refresh index.html (F5) to see the update.
pause
