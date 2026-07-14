@echo off
chcp 65001 >nul
echo Building Agent Hub for production...
echo.

:: 设置 MinGW 路径
set PATH=C:\Users\Administrator\.mingw64\mingw64\bin;%PATH%

:: 构建生产版本
cd /d C:\code\agent-hub
npx tauri build

echo.
echo Build complete! Check src-tauri\target\release\bundle\ for the installer.
pause
