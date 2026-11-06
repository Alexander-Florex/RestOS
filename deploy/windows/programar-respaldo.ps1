# ──────────────────────────────────────────────
# programar-respaldo.ps1 — Tarea programada del respaldo nocturno (tarea 6.3)
#
# Correr en PowerShell COMO ADMINISTRADOR:
#   powershell -ExecutionPolicy Bypass -File deploy\windows\programar-respaldo.ps1 [-LlaveSsh C:\RestOS\secretos\hostinger]
#
# Crea la tarea "RestOS - Respaldo": corre cada hora y al prender la PC, como SYSTEM
# (no hace falta que haya nadie logueado). El propio respaldo decide: a partir de
# BACKUP_HOUR (3 a. m.) hace el del día; si falló la subida, la reintenta la hora
# siguiente; si ya está hecho, no hace nada. Ver docs/restauracion.md.
# ──────────────────────────────────────────────
param(
  [string]$Proyecto = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$Tarea = 'RestOS - Respaldo',
  # Llave privada SSH para subir a Hostinger: se le dejan permisos solo para SYSTEM y administradores
  [string]$LlaveSsh
)
$ErrorActionPreference = 'Stop'
function Falla($msg) { Write-Host "❌ $msg" -ForegroundColor Red; exit 1 }
function Ok($msg) { Write-Host "✅ $msg" -ForegroundColor Green }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Falla 'Abrí PowerShell como administrador.' }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Falla 'No está Node.js.' }
$backend = Join-Path $Proyecto 'apps\backend'
if (-not (Test-Path (Join-Path $backend 'dist\scripts\backup.js'))) { Falla 'Falta compilar: corré "npm run build".' }
$envTexto = Get-Content (Join-Path $backend '.env') -Raw
if ($envTexto -notmatch '(?m)^\s*BACKUP_PASSPHRASE\s*=') { Falla 'Falta BACKUP_PASSPHRASE en apps\backend\.env (ver docs/instalacion-local.md, paso 7).' }

# OpenSSH exige que la llave privada no la pueda leer cualquiera (si no, se niega a usarla)
if ($LlaveSsh) {
  if (-not (Test-Path $LlaveSsh)) { Falla "No existe la llave $LlaveSsh" }
  icacls $LlaveSsh /inheritance:r /grant:r '*S-1-5-18:R' '*S-1-5-32-544:F' | Out-Null   # SYSTEM: leer · Administradores: todo
  Ok "Permisos de la llave ajustados: $LlaveSsh"
}

$accion = New-ScheduledTaskAction -Execute $node -Argument 'dist\scripts\backup.js' -WorkingDirectory $backend
$cadaHora = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Hours 1)
$alPrender = New-ScheduledTaskTrigger -AtStartup
$alPrender.Delay = 'PT5M'   # 5 minutos después de prender, cuando ya arrancó MySQL
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew -WakeToRun
$usuario = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $Tarea -Action $accion -Trigger @($cadaHora, $alPrender) -Settings $config -Principal $usuario `
  -Description 'Respaldo nocturno de RestOS (base y comprobantes, cifrado). Corre cada hora; respalda una vez por día y reintenta si falla.' -Force | Out-Null
Ok "Tarea '$Tarea' programada (cada hora y al prender la PC)"

Write-Host ''
Write-Host 'Probalo ahora (hace un respaldo completo y lo copia a los destinos):' -ForegroundColor Cyan
Write-Host "   cd `"$backend`"; npm run respaldo -- --ahora" -ForegroundColor Cyan
Write-Host 'Y verificá que llegue el aviso de prueba (si configuraste BACKUP_ALERT_URL):' -ForegroundColor Cyan
Write-Host '   npm run respaldo -- --probar-aviso' -ForegroundColor Cyan
