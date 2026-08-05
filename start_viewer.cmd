@echo off
setlocal
cd /d "%~dp0frontend"
if not exist node_modules (
  echo 依存関係がありません。先に npm install を実行してください。
  pause
  exit /b 1
)
npm run dev
