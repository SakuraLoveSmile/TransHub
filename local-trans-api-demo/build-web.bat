@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [build-web] Node.js not found. Please install Node 24 LTS first.
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [build-web] npm not found. Please install Node 24 LTS first.
  exit /b 1
)

cd frontend
echo [build-web] installing dependencies (npm ci)...
call npm ci
if errorlevel 1 (
  echo [build-web] npm ci failed.
  exit /b 1
)

echo [build-web] running tests...
call npm run test -- --run
if errorlevel 1 (
  echo [build-web] frontend tests failed.
  exit /b 1
)

echo [build-web] running typecheck...
call npm run typecheck
if errorlevel 1 (
  echo [build-web] frontend typecheck failed.
  exit /b 1
)

echo [build-web] building...
call npm run build
if errorlevel 1 (
  echo [build-web] frontend build failed.
  exit /b 1
)

echo [build-web] done. Production bundle is in frontend\dist (served by FastAPI).
endlocal
