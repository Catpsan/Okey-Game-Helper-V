@echo off
rem Okey Helper V2: installs dependencies the first time, then opens the app in your browser.
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org or run:
  echo   winget install OpenJS.NodeJS.LTS
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies, this only happens once...
  call npm install || (pause & exit /b 1)
)
call npm run dev -- --open
