# ──────────────────────────────────────────────
# iniciar-restos.ps1 — Mantiene RestOS andando (lo lanza la tarea programada "RestOS")
#
# Alternativa a NSSM para PCs donde no está instalado (servidor con XAMPP):
# espera a que arranque la base, corre "node dist\index.js" y, si se cae,
# lo vuelve a arrancar a los 5 segundos. Lo registra actualizar-desde-xampp.ps1.
# El PID de node queda en logs\restos.pid (para poder detenerlo al actualizar).
# ──────────────────────────────────────────────
param(
  [Parameter(Mandatory = $true)][string]$Backend,
  [string]$ServicioMySql = 'mysql'
)
$ErrorActionPreference = 'Continue'
Set-Location $Backend
$logs = Join-Path $Backend 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$registro = Join-Path $logs 'servicio.log'
$env:NODE_ENV = 'production'
$env:TZ = 'America/Argentina/Buenos_Aires'

function Anotar($msg) { Add-Content -Path $registro -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" -Encoding utf8 }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }

while ($true) {
  # Esperar a la base (hasta 5 minutos) para no arrancar antes que MariaDB
  for ($i = 0; $i -lt 60; $i++) {
    $s = Get-Service $ServicioMySql -ErrorAction SilentlyContinue
    if (-not $s -or $s.Status -eq 'Running') { break }
    Start-Sleep -Seconds 5
  }
  if ((Test-Path $registro) -and (Get-Item $registro).Length -gt 10MB) { Move-Item $registro "$registro.anterior" -Force }

  Anotar 'Arrancando RestOS'
  $p = Start-Process -FilePath $node -ArgumentList 'dist\index.js' -WorkingDirectory $Backend -NoNewWindow -PassThru `
    -RedirectStandardOutput (Join-Path $logs 'salida.log') -RedirectStandardError (Join-Path $logs 'salida-error.log')
  $null = $p.Handle   # sin esto, ExitCode queda vacío
  Set-Content -Path (Join-Path $logs 'restos.pid') -Value $p.Id
  $p.WaitForExit()
  Anotar "RestOS se detuvo (código $($p.ExitCode)). Se reinicia en 5 segundos. Detalle en salida-error.log y app-*.log"
  Start-Sleep -Seconds 5
}
