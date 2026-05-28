@echo off
title Iniciar API Consulta Estoque
set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

echo ====================================================
echo       Iniciando Sistema de Consulta de Estoque
echo ====================================================
echo.

:: Obter porta do arquivo .env ou usar 3001 como padrao
set PORT=3001
if exist .env (
    for /f "tokens=2 delims==" %%i in ('findstr /i "^PORT=" .env') do set PORT=%%i
)
:: Remover espacos em branco da porta
set PORT=%PORT: =%

:: Verificar se tem algum processo ouvindo na porta configurada
set PID=
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%PORT% ^| findstr LISTENING') do set PID=%%a

if "%PID%"=="" goto START_SYS

:CHOICE_LOOP
cls
echo ====================================================
echo       Gerenciador de Inicializacao - Consulta Estoque
echo ====================================================
echo.
echo [*] O sistema ja esta em execucao na porta %PORT% (PID: %PID%).
echo.
echo [1] Reiniciar o sistema (encerra o processo antigo e inicia um novo)
echo [2] Apenas manter rodando (nao faz nada e sai)
echo [3] Parar o sistema (encerra o processo atual)
echo.
set /p OPT="Escolha uma opcao (1, 2 ou 3): "
if "%OPT%"=="1" goto RESTART
if "%OPT%"=="2" goto KEEP_RUNNING
if "%OPT%"=="3" goto STOP
echo.
echo [!] Opcao invalida! Tente novamente.
ping 127.0.0.1 -n 3 >nul
goto CHOICE_LOOP

:KEEP_RUNNING
echo.
echo [✓] Abrindo a interface no navegador...
start http://localhost:%PORT%
ping 127.0.0.1 -n 3 >nul
goto EXIT

:RESTART
echo.
echo Encerrando processo antigo (PID: %PID%)...
taskkill /F /PID %PID% >nul 2>&1
ping 127.0.0.1 -n 3 >nul
goto START_SYS

:STOP
echo.
echo Encerrando o sistema (PID: %PID%)...
taskkill /F /PID %PID% >nul 2>&1
echo [✓] Sistema parado com sucesso.
ping 127.0.0.1 -n 4 >nul
goto EXIT

:START_SYS
echo.
echo [1/1] Iniciando o Servidor de Consulta de Estoque na porta %PORT%...
start "API Consulta Estoque" cmd /k "npm start"
echo.
echo Aguardando inicializacao do servidor...
ping 127.0.0.1 -n 4 >nul
echo [✓] Abrindo a interface no navegador...
start http://localhost:%PORT%
ping 127.0.0.1 -n 3 >nul
goto EXIT

:EXIT
exit
