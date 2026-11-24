@echo off
rem 8bitFX - run the browser test suite headlessly (no Node required).
rem Usage: double-click, or `test.cmd` from a terminal. Exit code 0 = pass.
setlocal enabledelayedexpansion

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "!CHROME!" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "!CHROME!" set "CHROME=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "!CHROME!" set "CHROME=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "!CHROME!" (
  echo No Chromium-based browser found - open tests.html manually.
  exit /b 1
)

set "HERE=%~dp0"
set "HERE=!HERE:\=/!"
set "OUT=%TEMP%\8bitfx-tests.html"
set "PROFILE=%TEMP%\8bitfx-test-profile"

"!CHROME!" --headless=new --disable-gpu --no-sandbox --no-first-run ^
  --user-data-dir="!PROFILE!" --virtual-time-budget=25000 ^
  --dump-dom "file:///!HERE!tests.html" > "!OUT!" 2>nul

findstr /C:"0 failed" "!OUT!" >nul
if errorlevel 1 (
  echo.
  echo 8bitFX tests FAILED - details:
  findstr /C:"BAD" /C:"FAILED" /C:"failed" "!OUT!"
  echo Full DOM: !OUT!
  exit /b 1
)

for /f "delims=" %%L in ('findstr /C:"passed," "!OUT!"') do echo %%L
echo All 8bitFX tests passed.

rem ---- in-app self check: chips, undo/redo, permalink, export guard ----
set "SELF=%TEMP%\8bitfx-selftest.html"
"!CHROME!" --headless=new --disable-gpu --no-sandbox --no-first-run ^
  --user-data-dir="!PROFILE!" --virtual-time-budget=25000 ^
  --dump-dom "file:///!HERE!index.html?selftest=1" > "!SELF!" 2>nul

findstr /C:"SELFTEST OK" "!SELF!" >nul
if errorlevel 1 (
  echo.
  echo 8bitFX app self-test FAILED - details:
  findstr /C:"SELFTEST FAILED" /C:"detail" "!SELF!"
  echo Full DOM: !SELF!
  exit /b 1
)
echo App self-test passed.
exit /b 0
