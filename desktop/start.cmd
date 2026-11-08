@echo off
setlocal
cd /d "%~dp0"
if not exist ".env" (
  echo Missing desktop\.env. Copy .env.example to .env and fill in private values.
  exit /b 1
)
for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
  if not "%%A"=="" set "%%A=%%B"
)
node bin\codex-pocket.mjs
