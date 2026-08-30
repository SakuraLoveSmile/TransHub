@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if not errorlevel 1 (
  set "BOOTSTRAP=py -3.12"
  set "FALLBACK=py"
) else (
  set "BOOTSTRAP=python"
  set "FALLBACK=python3"
)

if exist ".venv\Scripts\python.exe" goto venv_ready

echo [setup] creating .venv
%BOOTSTRAP% -m venv .venv
if not exist ".venv\Scripts\python.exe" %FALLBACK% -m venv .venv
if not exist ".venv\Scripts\python.exe" (
  echo [setup] failed to create .venv. Install Python 3.12 and run setup.bat again.
  exit /b 1
)

:venv_ready
for /f "tokens=2 delims= " %%V in ('.venv\Scripts\python --version') do set "PYVER=%%V"
echo [setup] venv python %PYVER%

.venv\Scripts\python -c "import tomllib" >nul 2>nul
if errorlevel 1 (
  echo [setup] Python 3.11+ is required. Delete .venv and run setup.bat again.
  exit /b 1
)

.venv\Scripts\python -m pip install --upgrade pip
.venv\Scripts\python -m pip install -r requirements.txt
if errorlevel 1 (
  echo [setup] dependency install failed
  exit /b 1
)

echo [setup] done. Start the demo with run.bat
endlocal
