@echo off
setlocal
cd /d "%~dp0"

echo [setup-real] setting up base environment via setup.bat...
call setup.bat
if errorlevel 1 (
  echo [setup-real] base setup.bat failed
  exit /b 1
)

echo [setup-real] installing AI dependencies (faster-whisper, ctranslate2, huggingface-hub, nvidia-ml-py)...
.venv\Scripts\python -m pip install -r requirements-ai.txt
if errorlevel 1 (
  echo [setup-real] AI dependency installation failed
  exit /b 1
)

echo.
echo [setup-real] environment is ready.
echo [setup-real] next steps:
echo   1. (If models not downloaded) python scripts\download_models.py --model whisper-ja-1.5b
echo   2. Start TransHub real engine: run-real.bat
endlocal
