@echo off
echo Starting Agent Hub development...
echo.

:: 设置 MinGW 路径 - 添加到系统 PATH
set PATH=C:\Users\Administrator\.mingw64\mingw64\bin;%PATH%

:: 验证 windres
where windres
if errorlevel 1 (
    echo ERROR: windres not found!
    pause
    exit /b 1
)

:: 启动 Tauri 开发模式
cd /d C:\code\agent-hub
call npx tauri dev
