@echo off
pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0ai-store-context.ps1" %*
if errorlevel 1 echo {}
