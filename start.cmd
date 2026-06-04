@echo off
setlocal
cd /d "%~dp0"
echo Starting SocialX local server on http://127.0.0.1:3001
set "NODE_EXE=node"
where node >nul 2>nul || set "NODE_EXE=C:\Users\Marketing\AppData\Local\OpenAI\Codex\bin\node.exe"
if not exist "%NODE_EXE%" (
  echo Node.js was not found. Install Node or update start.cmd with the correct path.
  pause
  exit /b 1
)
"%NODE_EXE%" server.mjs
