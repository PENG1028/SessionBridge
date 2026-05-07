@echo off
title SessionBridge
cd /d "%~dp0"

echo.
echo   ╔═══════════════════════════════════════╗
echo   ║     SessionBridge                     ║
echo   ╚═══════════════════════════════════════╝
echo.

:: Check if built
if not exist "dist\index.js" (
    echo   First time setup — building...
    call npx next build
    if errorlevel 1 (
        echo   Frontend build failed.
        pause
        exit /b 1
    )
    call npx tsc -p tsconfig.server.json
    if errorlevel 1 (
        echo   Server build failed.
        pause
        exit /b 1
    )
    echo   Build complete.
    echo.
)

:: Start with Node.js launcher (opens browser, manages port)
node scripts\serve.js

:: If launcher exits and user wants to keep it open
pause
