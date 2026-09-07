@echo off
REM Runner del backup diario para el Programador de tareas de Windows.
REM Se ubica solo (%~dp0 = ...\backIndians\scripts\release\) y manda TODA la
REM salida al log, para que un fallo desatendido quede registrado.
setlocal
set "BACK_DIR=%~dp0..\.."
cd /d "%BACK_DIR%" || exit /b 1
if not exist ".releases\db" mkdir ".releases\db"
node "scripts\release\db-backup-daily.mjs" >> ".releases\db\_daily-backup.log" 2>&1
exit /b %ERRORLEVEL%
