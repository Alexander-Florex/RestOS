# ──────────────────────────────────────────────
# actualizar.ps1 — Instala una versión nueva de RestOS en el servidor (tarea 6.1)
#
# Correr en PowerShell COMO ADMINISTRADOR, con el código nuevo ya copiado
# (o con -GitPull si la carpeta es un repositorio git):
#   powershell -ExecutionPolicy Bypass -File deploy\windows\actualizar.ps1 [-GitPull]
#
# Orden pensado para no perder datos:
#   1. respaldo completo AHORA (si falla, no se sigue)
#   2. instala dependencias y compila (con el servicio todavía andando)
#   3. detiene el servicio, aplica migraciones (prisma migrate deploy), lo arranca
#   4. verifica que responda
# Hacelo fuera del horario de servicio.
# ──────────────────────────────────────────────
param(
  [string]$Proyecto = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$Nssm = 'C:\RestOS\nssm\nssm.exe',
  [string]$Servicio = 'RestOS',
  [int]$Puerto = 3001,
  [switch]$GitPull,
  # Solo si el respaldo no puede hacerse y ya hay uno reciente que sabés que sirve
  [switch]$SinRespaldo
)
$ErrorActionPreference = 'Stop'
function Falla($msg) { Write-Host "❌ $msg" -ForegroundColor Red; exit 1 }
function Ok($msg) { Write-Host "✅ $msg" -ForegroundColor Green }
function Paso($msg) { Write-Host "▶ $msg" -ForegroundColor Cyan }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Falla 'Abrí PowerShell como administrador.' }
if (-not (Test-Path $Nssm)) { $Nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source; if (-not $Nssm) { Falla 'No encuentro NSSM.' } }
$backend = Join-Path $Proyecto 'apps\backend'
Set-Location $Proyecto

# 1. Respaldo
if (-not $SinRespaldo) {
  Paso 'Respaldo antes de actualizar'
  Push-Location $backend
  if (Test-Path 'dist\scripts\backup.js') { node dist\scripts\backup.js --ahora } else { Write-Host 'Primera versión con respaldo: se omite.' }
  $codigo = $LASTEXITCODE
  Pop-Location
  if ($codigo -ne 0) { Falla 'El respaldo falló: no se actualiza. Revisalo (o usá -SinRespaldo si tenés uno reciente que sirve).' }
  Ok 'Respaldo hecho'
}

# 2. Código nuevo, dependencias y compilación (el servicio sigue atendiendo)
if ($GitPull) { Paso 'Bajando el código nuevo'; git pull --ff-only; if ($LASTEXITCODE -ne 0) { Falla 'git pull falló.' } }
Paso 'Instalando dependencias'
npm ci; if ($LASTEXITCODE -ne 0) { Falla 'npm ci falló.' }
Paso 'Compilando'
npm run build; if ($LASTEXITCODE -ne 0) { Falla 'La compilación falló: el servicio sigue con la versión anterior.' }

# 3. Migraciones con el servicio detenido
Paso 'Deteniendo el servicio'
& $Nssm stop $Servicio | Out-Null
Push-Location $backend
Paso 'Aplicando migraciones de la base'
npx prisma migrate deploy
$codigo = $LASTEXITCODE
Pop-Location
if ($codigo -ne 0) {
  & $Nssm start $Servicio | Out-Null
  Falla 'Las migraciones fallaron. Se volvió a arrancar el servicio; revisá el error y docs/restauracion.md antes de reintentar.'
}

# 4. Arranque y verificación
Paso 'Arrancando el servicio'
& $Nssm start $Servicio | Out-Null
$listo = $false
for ($i = 0; $i -lt 30 -and -not $listo; $i++) {
  Start-Sleep -Seconds 2
  try { $listo = ((Invoke-RestMethod "http://localhost:$Puerto/api/health" -TimeoutSec 5).status -eq 'ok') } catch { }
}
if (-not $listo) { Falla "No responde después de actualizar. Mirá apps\backend\logs\servicio.log." }
Ok 'Actualización terminada. En los celulares alcanza con recargar la página.'
