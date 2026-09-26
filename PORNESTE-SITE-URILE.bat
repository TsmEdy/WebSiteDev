@echo off
rem Dublu-click pe acest fisier: porneste serverul local si deschide site-urile in browser.
cd /d "%~dp0"
echo.
echo  Pornesc serverul local pe http://localhost:5180 ...
echo  (lasa deschisa fereastra albastra a serverului cat timp te uiti la site-uri)
echo.
start "Server site-uri - NU inchide" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port 5180
timeout /t 2 /nobreak >nul
start "" http://localhost:5180/
