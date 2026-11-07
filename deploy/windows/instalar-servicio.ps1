# ──────────────────────────────────────────────
# instalar-servicio.ps1 — Instala RestOS como servicio de Windows (tarea 6.1)
#
# Correr en PowerShell COMO ADMINISTRADOR, desde la carpeta del proyecto:
#   powershell -ExecutionPolicy Bypass -File deploy\windows\instalar-servicio.ps1
#
# Hace: registra el servicio "RestOS" con NSSM (arranca solo con Windows, después
# de MySQL, y se reinicia si se cae), abre el puerto en el firewall para la red
# del local y verifica que responda. Ver docs/instalacion-local.md.
# ──────────────────────────────────────────────
param(
  [string]$Proyecto = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$Nssm = 'C:\RestOS\nssm\nssm.exe',
  [string]$Servicio = 'RestOS',
  [string]$ServicioMySql = 'MySQL80',
  [int]$Puerto = 3001,
  [switch]$SinFirewall
)
$ErrorActionPreference = 'Stop'

function Falla($msg) { Write-Host "❌ $msg" -ForegroundColor Red; exit 1 }
function Ok($msg) { Write-Host "✅ $msg" -ForegroundColor Green }

# ── Controles previos ──
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Falla 'Abrí PowerShell como administrador (clic derecho → Ejecutar como administrador).' }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Falla 'No está Node.js. Instalá la versión LTS desde nodejs.org.' }
if (-not (Test-Path $Nssm)) {
  $enPath = (Get-Command nssm -ErrorAction SilentlyContinue).Source
  if ($enPath) { $Nssm = $enPath } else { Falla "No encuentro NSSM en $Nssm (ver docs/instalacion-local.md, paso 4)." }
}
$backend = Join-Path $Proyecto 'apps\backend'
if (-not (Test-Path (Join-Path $backend 'dist\index.js'))) { Falla 'Falta compilar: corré "npm run build" en la carpeta del proyecto.' }
if (-not (Test-Path (Join-Path $Proyecto 'apps\frontend\dist\index.html'))) { Falla 'Falta el build de las pantallas: corré "npm run build".' }
if (-not (Test-Path (Join-Path $backend '.env'))) { Falla "Falta $backend\.env (copiá deploy\windows\env.produccion.example y completalo)." }
$envTexto = Get-Content (Join-Path $backend '.env') -Raw
if ($envTexto -notmatch '(?m)^\s*NODE_ENV\s*=\s*"?production') { Falla 'En el .env tiene que decir NODE_ENV=production.' }
if (-not (Get-Service $ServicioMySql -ErrorAction SilentlyContinue)) { Falla "No existe el servicio de MySQL '$ServicioMySql' (indicá el nombre con -ServicioMySql)." }

# ── Servicio ──
if (Get-Service $Servicio -ErrorAction SilentlyContinue) {
  Write-Host "El servicio $Servicio ya existe: se reconfigura."
  & $Nssm stop $Servicio | Out-Null
} else {
  & $Nssm install $Servicio $node 'dist\index.js' | Out-Null
}
$logs = Join-Path $backend 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
& $Nssm set $Servicio Application $node | Out-Null
& $Nssm set $Servicio AppParameters 'dist\index.js' | Out-Null
& $Nssm set $Servicio AppDirectory $backend | Out-Null
& $Nssm set $Servicio DisplayName 'RestOS (sistema del restaurante)' | Out-Null
& $Nssm set $Servicio Description 'Servidor de RestOS: pedidos, cobros, stock. Si se detiene, los celulares no pueden tomar pedidos.' | Out-Null
& $Nssm set $Servicio Start SERVICE_AUTO_START | Out-Null
& $Nssm set $Servicio DependOnService $ServicioMySql | Out-Null
& $Nssm set $Servicio AppEnvironmentExtra 'NODE_ENV=production' 'TZ=America/Argentina/Buenos_Aires' | Out-Null
# Si se cae, se reinicia a los 5 segundos (siempre)
& $Nssm set $Servicio AppExit Default Restart | Out-Null
& $Nssm set $Servicio AppRestartDelay 5000 | Out-Null
# Lo que el proceso escriba en pantalla (errores de arranque) va a un archivo que rota a los 10 MB
& $Nssm set $Servicio AppStdout (Join-Path $logs 'servicio.log') | Out-Null
& $Nssm set $Servicio AppStderr (Join-Path $logs 'servicio.log') | Out-Null
& $Nssm set $Servicio AppRotateFiles 1 | Out-Null
& $Nssm set $Servicio AppRotateOnline 1 | Out-Null
& $Nssm set $Servicio AppRotateBytes 10485760 | Out-Null
# Además, Windows lo reinicia si NSSM mismo falla
sc.exe failure $Servicio reset= 86400 actions= restart/5000/restart/5000/restart/30000 | Out-Null
Ok "Servicio $Servicio configurado"

# ── Firewall: solo redes privadas (la del local), nunca públicas ──
if (-not $SinFirewall) {
  Get-NetFirewallRule -DisplayName 'RestOS' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName 'RestOS' -Direction Inbound -Protocol TCP -LocalPort $Puerto -Profile Private -Action Allow | Out-Null
  Ok "Puerto $Puerto abierto en el firewall (solo red privada)"
  $perfil = (Get-NetConnectionProfile | Select-Object -First 1).NetworkCategory
  if ($perfil -ne 'Private') {
    Write-Host "⚠️  La red de esta PC figura como '$perfil'. Cambiala a 'Privada' (Configuración → Red → propiedades) o los celulares no van a poder entrar." -ForegroundColor Yellow
  }
}

# ── Arranque y verificación ──
& $Nssm start $Servicio | Out-Null
$url = "http://localhost:$Puerto/api/health"
$listo = $false
for ($i = 0; $i -lt 30 -and -not $listo; $i++) {
  Start-Sleep -Seconds 2
  try { $r = Invoke-RestMethod $url -TimeoutSec 5; $listo = ($r.status -eq 'ok') } catch { }
}
if (-not $listo) { Falla "El servicio no responde en $url. Mirá $logs\servicio.log y $logs\app-*.log." }
Ok 'RestOS está funcionando'

$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress
Write-Host ''
Write-Host 'Desde los celulares y PC del local entrá a:' -ForegroundColor Cyan
foreach ($ip in $ips) { Write-Host "   http://${ip}:$Puerto" -ForegroundColor Cyan }
Write-Host 'Fijá esa IP en el router (reserva DHCP) para que no cambie. Ver docs/instalacion-local.md.'
