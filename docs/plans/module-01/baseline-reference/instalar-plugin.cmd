@echo off
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 ou superior nao foi encontrado.
  echo Instale pelo site https://nodejs.org e execute este arquivo novamente.
  pause
  exit /b 1
)
node "%~dp0instalar-plugin.mjs"
if errorlevel 1 (
  echo.
  echo A instalacao falhou. Copie a mensagem acima e envie ao ChatGPT.
  pause
  exit /b 1
)
echo.
echo Instalacao local concluida.
pause
