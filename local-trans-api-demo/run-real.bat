@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo [run-real] .venv not found. Please run setup-real.bat first.
  exit /b 1
)

if not exist "config.real.toml" (
  echo [run-real] config.real.toml not found, copying from config.real.example.toml...
  copy config.real.example.toml config.real.toml >nul
  if errorlevel 1 (
    echo [run-real] failed to create config.real.toml from example template.
    exit /b 1
  )
)

set "TRANS_HUB_CONFIG=%CD%\config.real.toml"

echo [run-real] running GPU Preflight check...
.venv\Scripts\python scripts\preflight.py
if errorlevel 1 (
  echo.
  echo [run-real] GPU Preflight check failed! TransHub real engine requires NVIDIA GPU with CUDA 12 and cuDNN 9.
  echo [run-real] Please address the problems listed above before starting the server.
  exit /b 1
)

echo.
echo [run-real] Preflight passed. Starting TransHub with real engine (127.0.0.1:8765)...
.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
endlocal
