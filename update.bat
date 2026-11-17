@echo off
rem 扩展自更新的入口。真正的活在 update.ps1 里，因为 cmd 执行批处理时会占住自己的文件句柄，
rem 覆盖自己一定失败。这里只负责把 ps1 弄到 %TEMP% 再调起来。
setlocal
chcp 65001 >nul
title AI 比价扩展 - 自更新

set "TARGET=%~dp0"
if "%TARGET:~-1%"=="\" set "TARGET=%TARGET:~0,-1%"
set "REPO=napstablook666/ai-price-analyzer"
set "TMPPS=%TEMP%\apa-update-%RANDOM%.ps1"

echo.
echo   正在准备更新器...
echo.

rem 先试着从发布页拉最新版更新器（这样更新器自身的 bug 也能修），拉不到就用目录里自带的那份。
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri 'https://github.com/%REPO%/releases/latest/download/update.ps1' -UseBasicParsing -TimeoutSec 60 -OutFile '%TMPPS%' -ErrorAction Stop } catch { exit 1 }" >nul 2>&1
if not exist "%TMPPS%" if exist "%~dp0update.ps1" copy /y "%~dp0update.ps1" "%TMPPS%" >nul
if not exist "%TMPPS%" goto :nops1

powershell -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -LiteralPath '%TMPPS%' -ErrorAction SilentlyContinue" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%TMPPS%" -TargetDir "%TARGET%" -Repo %REPO%
set "CODE=%ERRORLEVEL%"
del /q "%TMPPS%" >nul 2>&1

echo.
pause
exit /b %CODE%

:nops1
echo.
echo   找不到更新器脚本：既没有下载到 update.ps1，扩展目录里也没有这个文件。
echo   请到 GitHub Releases 重新下载完整压缩包，覆盖安装一次。
echo.
pause
exit /b 1
