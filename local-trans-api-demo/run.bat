@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo [run] .venv not found. Run setup.bat first.
  exit /b 1
)

.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
endlocal
