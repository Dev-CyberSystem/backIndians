# Registra (o vuelve a registrar) la tarea programada "Indians - Backup diario DB".
#
#   powershell -ExecutionPolicy Bypass -File scripts\release\install-daily-backup-task.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\release\install-daily-backup-task.ps1 -At 03:00
#   powershell -ExecutionPolicy Bypass -File scripts\release\install-daily-backup-task.ps1 -Uninstall
#
# La tarea corre `daily-backup.cmd` una vez al día. Con -StartWhenAvailable, si
# la PC estaba apagada a la hora prevista, el backup se dispara en cuanto vuelve
# a estar disponible. Corre en la sesion del usuario actual (sólo con sesion
# iniciada); para que corra siempre, ver la nota al final.

[CmdletBinding()]
param(
  [string]$At = "13:00",
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$TaskName = "Indians - Backup diario DB"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Cmd = Join-Path $ScriptDir "daily-backup.cmd"

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Tarea '$TaskName' eliminada."
  } else {
    Write-Host "No existe la tarea '$TaskName'."
  }
  return
}

if (-not (Test-Path $Cmd)) { throw "No encuentro $Cmd" }

$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) { throw "node no esta en el PATH de este usuario. La tarea no podria ejecutarlo." }
Write-Host "node: $($node.Source)"
Write-Host "runner: $Cmd"
Write-Host "horario: todos los dias $At (se recupera si la PC estuvo apagada)"

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$Cmd`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
  -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal `
  -Description "Backup verificado de la base de produccion (Railway) a backIndians\.releases\db\. Reusa npm run db:backup." | Out-Null

Write-Host ""
Write-Host "Listo. Probar ahora:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Ver resultado:        Get-ScheduledTaskInfo -TaskName '$TaskName'"
Write-Host "Log:                  backIndians\.releases\db\_daily-backup.log"
Write-Host ""
Write-Host "Para que corra tambien con la sesion cerrada: Task Scheduler > la tarea >"
Write-Host "Propiedades > 'Ejecutar tanto si el usuario inicio sesion como si no'"
Write-Host "(pide la contrasena de Windows del usuario)."
