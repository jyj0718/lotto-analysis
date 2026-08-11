@echo off
title Lotto Update Server (close this window to stop)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update-server.ps1"
