@echo off
cd /d "%~dp0"
REM Bypass PowerShell's npm.ps1 execution-policy block by calling npm.cmd
call node scripts\build-keyhook.mjs --optional
call npm.cmd run electron:build
if errorlevel 1 exit /b 1
call npx.cmd concurrently -k "npm.cmd run dev" "npm.cmd run electron"
