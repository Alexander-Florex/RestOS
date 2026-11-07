# ──────────────────────────────────────────────
# actualizar-desde-xampp.ps1 — Actualiza RestOS en una PC que ya lo tiene andando
# con XAMPP (MariaDB) y deja el arranque automático y el respaldo nocturno.
#
# Correr en PowerShell COMO ADMINISTRADOR, fuera del horario del local:
#   irm https://raw.githubusercontent.com/Alexander-Florex/RestOS/main/deploy/windows/actualizar-desde-xampp.ps1 -OutFile $env:TEMP\actualizar-restos.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\actualizar-restos.ps1
#
# Orden:
#   1. Controles (no toca nada)
#   2. Detiene la versión anterior y desactiva su tarea (RestOS-Watcher)
#   3. Respaldo completo de la base (mysqldump de XAMPP) y del .env
#   4. Baja el código nuevo (git), instala dependencias y compila
#   5. Completa el .env (TZ, respaldo, MYSQL_BIN_DIR)
#   6. Aplica las migraciones de la base
#   7. Registra la tarea "RestOS" (arranca con Windows y se reinicia si se cae) y verifica
#   8. Red privada + firewall, redirección de Apache, respaldo nocturno
# Si algo falla en 4, 6 o 7, VUELVE ATRÁS solo: restaura la base, el código y
# el .env, y arranca la versión anterior.
# Se puede volver a correr para las próximas actualizaciones.
# ──────────────────────────────────────────────
param(
  [string]$Proyecto,
  [string]$Rama = 'main',
  [string]$MysqlBin = 'C:\xampp\mysql\bin',
  [string]$ServicioMySql = 'mysql',
  [string]$TareaVieja = 'RestOS-Watcher',
  [string]$Tarea = 'RestOS',
  [string]$Carpeta = 'C:\RestOS',
  [switch]$SinRedireccionApache
)
$ErrorActionPreference = 'Continue'
$fecha = Get-Date -Format 'yyyy-MM-dd_HHmm'

function Titulo($msg) { Write-Host ''; Write-Host "▶ $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "  ✅ $msg" -ForegroundColor Green }
function Aviso($msg) { Write-Host "  ⚠️  $msg" -ForegroundColor Yellow }
function Falla($msg) { Write-Host ''; Write-Host "❌ $msg" -ForegroundColor Red; try { Stop-Transcript | Out-Null } catch { }; exit 1 }
# Corre un programa mostrando su salida con sangría; devuelve el código de salida
function Correr([string]$exe, [string[]]$argumentos) {
  & $exe @argumentos 2>&1 | ForEach-Object { Write-Host "     $_" }
  return $LASTEXITCODE
}
function Repo([string[]]$argumentos) { return (Correr 'git.exe' (@('-c', 'safe.directory=*', '-C', $Proyecto) + $argumentos)) }
function RepoTexto([string[]]$argumentos) { return (& git.exe -c safe.directory=* -C $Proyecto @argumentos 2>$null) }

# ── Lectura y escritura del .env ──
function LeerEnv([string]$clave) {
  $l = Get-Content $envFile -Encoding utf8 | Where-Object { $_ -match "^\s*$clave\s*=" } | Select-Object -First 1
  if (-not $l) { return $null }
  $v = ($l -replace "^\s*$clave\s*=\s*", '').Trim()
  if ($v.Length -ge 2 -and (($v[0] -eq '"' -and $v[-1] -eq '"') -or ($v[0] -eq "'" -and $v[-1] -eq "'"))) { $v = $v.Substring(1, $v.Length - 2) }
  return $v
}
function PonerEnv([string]$clave, [string]$linea) {
  $lineas = @(Get-Content $envFile -Encoding utf8)
  $i = -1
  for ($k = 0; $k -lt $lineas.Count; $k++) { if ($lineas[$k] -match "^\s*$clave\s*=") { $i = $k; break } }
  if ($i -ge 0) { $lineas[$i] = $linea } else { $lineas += $linea }
  [IO.File]::WriteAllLines($envFile, [string[]]$lineas, (New-Object Text.UTF8Encoding $false))
}

# ── Conexión a la base sin dejar la contraseña en la línea de comandos ──
function ArchivoMysql {
  $f = Join-Path $env:TEMP "restos-my-$PID.cnf"
  $clave = $db.Clave.Replace('\', '\\').Replace('"', '\"')
  $txt = "[client]`r`nuser=`"$($db.Usuario)`"`r`npassword=`"$clave`"`r`nhost=$($db.Host)`r`nport=$($db.Puerto)`r`n"
  [IO.File]::WriteAllText($f, $txt, (New-Object Text.UTF8Encoding $false))
  return $f
}
function Sql([string]$consulta) {
  $cnf = ArchivoMysql
  try { return (& (Join-Path $MysqlBin 'mysql.exe') "--defaults-extra-file=$cnf" -N -B -e $consulta $db.Base 2>&1) }
  finally { Remove-Item $cnf -Force -ErrorAction SilentlyContinue }
}

# ── Detener RestOS (versión anterior o nueva) ──
function DetenerRestos {
  foreach ($t in @($TareaVieja, $Tarea)) {
    if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue }
  }
  $pidFile = Join-Path $backend 'logs\restos.pid'
  if (Test-Path $pidFile) {
    $p = Get-Process -Id ([int](Get-Content $pidFile)) -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  }
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'dist[\\/]index\.js' -or $_.CommandLine -match 'npm-cli\.js"?\s+(start|run start)' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 3
}
function PuertoOcupado { return [bool](Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue) }
function Responde {
  for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 2
    try { if ((Invoke-RestMethod "http://localhost:$puerto/api/health" -TimeoutSec 5).status -eq 'ok') { return $true } } catch { }
  }
  return $false
}

# ── Volver atrás ──
$etapa = 'nada'   # nada → detenido → codigo → base
function VolverAtras([string]$motivo) {
  Write-Host ''
  Write-Host "❌ $motivo" -ForegroundColor Red
  Write-Host '↩  Volviendo a la versión anterior...' -ForegroundColor Yellow
  DetenerRestos
  if (Get-ScheduledTask -TaskName $Tarea -ErrorAction SilentlyContinue) { Disable-ScheduledTask -TaskName $Tarea | Out-Null }
  if ($etapa -eq 'base') {
    Write-Host '   Restaurando la base desde el respaldo...'
    $tablas = @(Sql "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()") | Where-Object { $_ -and $_ -notmatch '^ERROR' }
    if ($tablas.Count -gt 0) {
      $lista = ($tablas | ForEach-Object { "``$_``" }) -join ','
      Sql "SET FOREIGN_KEY_CHECKS=0; DROP TABLE IF EXISTS $lista; SET FOREIGN_KEY_CHECKS=1;" | Out-Null
    }
    $r = Sql "SET FOREIGN_KEY_CHECKS=0; source $($volcado.Replace('\', '/')); SET FOREIGN_KEY_CHECKS=1;"
    if ($r -match 'ERROR') { Write-Host "   ⚠️  La restauración de la base dio errores: $r" -ForegroundColor Yellow } else { Write-Host '   Base restaurada.' }
  }
  if ($etapa -in @('codigo', 'base')) {
    Write-Host "   Volviendo el código a $($antes.Substring(0, 7)) y recompilando (unos minutos)..."
    Repo @('checkout', '--force', $antes) | Out-Null
    Push-Location $Proyecto; Correr 'npm.cmd' @('ci') | Out-Null; Pop-Location
    Push-Location $backend; Correr 'npx.cmd' @('prisma', 'generate') | Out-Null; Pop-Location
    Push-Location $Proyecto; Correr 'npm.cmd' @('run', 'build') | Out-Null; Pop-Location
    Copy-Item $envCopia $envFile -Force
    if ($frontEnvCopia) { Copy-Item $frontEnvCopia $frontEnv -Force }
  }
  if (Get-ScheduledTask -TaskName $TareaVieja -ErrorAction SilentlyContinue) {
    Enable-ScheduledTask -TaskName $TareaVieja | Out-Null
    Start-ScheduledTask -TaskName $TareaVieja
    Write-Host "   Se reactivó la tarea $TareaVieja."
  }
  Write-Host ''
  Write-Host 'Quedó la versión anterior. Si en 1 minuto no anda, reiniciá la PC.' -ForegroundColor Yellow
  Write-Host "Mandale al desarrollador el registro: $transcript" -ForegroundColor Yellow
  try { Stop-Transcript | Out-Null } catch { }
  exit 1
}

# ══════════════════════════════════════════════
# 1. Controles
# ══════════════════════════════════════════════
New-Item -ItemType Directory -Force $Carpeta | Out-Null
$respaldos = Join-Path $Carpeta 'respaldos'
New-Item -ItemType Directory -Force $respaldos | Out-Null
$transcript = Join-Path $Carpeta "actualizacion-$fecha.log"
Start-Transcript -Path $transcript | Out-Null

Titulo 'Controles'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Falla 'Abrí PowerShell como administrador (clic derecho → Ejecutar como administrador) y volvé a correrlo.' }
foreach ($c in 'node', 'npm.cmd', 'git.exe') { if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { Falla "No encuentro $c." } }
foreach ($c in 'mysql.exe', 'mysqldump.exe') { if (-not (Test-Path (Join-Path $MysqlBin $c))) { Falla "No encuentro $c en $MysqlBin (indicá la carpeta con -MysqlBin)." } }
$svc = Get-Service $ServicioMySql -ErrorAction SilentlyContinue
if (-not $svc) { Falla "No existe el servicio de base '$ServicioMySql' (en el panel de XAMPP, tildá 'Svc' de MySQL, o indicá el nombre con -ServicioMySql)." }
if ($svc.Status -ne 'Running') { Start-Service $ServicioMySql; Start-Sleep -Seconds 5 }
if ($svc.StartType -ne 'Automatic') { Set-Service $ServicioMySql -StartupType Automatic; Aviso "El servicio $ServicioMySql ahora arranca solo con Windows." }

if (-not $Proyecto) {
  if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot '..\..\apps\backend\prisma\schema.prisma'))) {
    $Proyecto = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  } else {
    $hallados = @(Get-ChildItem 'C:\Users' -Filter schema.prisma -Recurse -Depth 8 -ErrorAction SilentlyContinue) + @(Get-ChildItem $Carpeta -Filter schema.prisma -Recurse -Depth 5 -ErrorAction SilentlyContinue)
    $hallados = @($hallados | Where-Object { $_.FullName -match '\\apps\\backend\\prisma\\schema\.prisma$' -and $_.FullName -notmatch 'node_modules|\\Temp\\' } |
      ForEach-Object { $_.Directory.Parent.Parent.Parent.FullName } | Where-Object { Test-Path (Join-Path $_ '.git') } | Sort-Object -Unique)
    if ($hallados.Count -ne 1) { Falla "No pude elegir la carpeta del sistema (encontré $($hallados.Count)): $($hallados -join ', '). Indicala con -Proyecto 'C:\...\RestOS'." }
    $Proyecto = $hallados[0]
  }
}
$backend = Join-Path $Proyecto 'apps\backend'
$envFile = Join-Path $backend '.env'
if (-not (Test-Path $envFile)) { Falla "Falta $envFile." }
Ok "Sistema en: $Proyecto"

$origen = RepoTexto @('remote', 'get-url', 'origin')
if ($origen -notmatch 'RestOS') { Falla "La carpeta no es el repositorio de RestOS (origin: $origen)." }
$antes = (RepoTexto @('rev-parse', 'HEAD')).Trim()
Ok "Versión actual: $(RepoTexto @('log', '-1', '--format=%h %cd %s', '--date=short'))"

$url = LeerEnv 'DATABASE_URL'
if ($url -notmatch '^mysql://([^:@]+)(?::([^@]*))?@([^:/]+)(?::(\d+))?/([^?]+)') { Falla 'No entiendo el DATABASE_URL del .env.' }
$db = @{ Usuario = [uri]::UnescapeDataString($Matches[1]); Clave = [uri]::UnescapeDataString("$($Matches[2])"); Host = $Matches[3]; Puerto = $(if ($Matches[4]) { $Matches[4] } else { '3306' }); Base = $Matches[5] }
$prueba = Sql 'SELECT 1'
if ("$prueba" -ne '1') { Falla "No me puedo conectar a la base '$($db.Base)': $prueba" }
$ventas = Sql 'SELECT COUNT(*) FROM sales'
Ok "Base '$($db.Base)' en $($db.Host): conecta ($ventas ventas)"

$puerto = LeerEnv 'PORT'
if (-not $puerto) { $puerto = '3000'; PonerEnv 'PORT' 'PORT=3000' }
Ok "Puerto del sistema: $puerto"

# ══════════════════════════════════════════════
# 2. Detener la versión anterior
# ══════════════════════════════════════════════
Titulo 'Deteniendo la versión anterior'
DetenerRestos
if (Get-ScheduledTask -TaskName $TareaVieja -ErrorAction SilentlyContinue) {
  Disable-ScheduledTask -TaskName $TareaVieja | Out-Null
  Ok "Tarea $TareaVieja desactivada (no se borra: se puede volver a activar)"
}
if (PuertoOcupado) { DetenerRestos }
if (PuertoOcupado) {
  $dueno = (Get-NetTCPConnection -LocalPort $puerto -State Listen | Select-Object -First 1).OwningProcess
  Falla "El puerto $puerto sigue ocupado por el proceso $dueno ($((Get-Process -Id $dueno).ProcessName)). Cerralo y volvé a correr el script."
}
$etapa = 'detenido'
Ok 'Versión anterior detenida'

# ══════════════════════════════════════════════
# 3. Respaldo
# ══════════════════════════════════════════════
Titulo 'Respaldo de la base y del .env'
$volcado = Join-Path $respaldos "antes-de-actualizar-$fecha.sql"
$cnf = ArchivoMysql
& (Join-Path $MysqlBin 'mysqldump.exe') "--defaults-extra-file=$cnf" --single-transaction --routines --triggers --hex-blob --default-character-set=utf8mb4 "--result-file=$volcado" $db.Base 2>&1 | ForEach-Object { Write-Host "     $_" }
$codigoDump = $LASTEXITCODE
Remove-Item $cnf -Force -ErrorAction SilentlyContinue
$cola = if (Test-Path $volcado) { Get-Content $volcado -Tail 3 } else { '' }
if ($codigoDump -ne 0 -or -not ($cola -match 'Dump completed')) {
  VolverAtras 'El respaldo de la base falló: no se tocó nada.'
}
$envCopia = Join-Path $respaldos "env-antes-de-actualizar-$fecha"
Copy-Item $envFile $envCopia
Ok "Base: $volcado ($([math]::Round((Get-Item $volcado).Length / 1KB)) KB)"
Ok "Configuración: $envCopia"

# ══════════════════════════════════════════════
# 4. Código nuevo, dependencias y compilación
# ══════════════════════════════════════════════
Titulo "Bajando el código nuevo (rama $Rama)"
$cambios = RepoTexto @('status', '--porcelain', '--untracked-files=no')
if ($cambios) {
  Repo @('stash', 'push', '-m', "cambios-locales-antes-de-actualizar-$fecha") | Out-Null
  Aviso "Había archivos modificados en esta PC: quedaron guardados (git stash, 'cambios-locales-antes-de-actualizar-$fecha')."
}
$etapa = 'codigo'
if ((Repo @('fetch', 'origin')) -ne 0) { VolverAtras 'No se pudo bajar el código (¿hay internet?).' }
if ((Repo @('checkout', '--force', $Rama)) -ne 0) { VolverAtras "No se pudo pasar a la rama $Rama." }
if ((Repo @('reset', '--hard', "origin/$Rama")) -ne 0) { VolverAtras 'No se pudo actualizar el código.' }
Ok "Código nuevo: $(RepoTexto @('log', '-1', '--format=%h %cd %s', '--date=short'))"

# Las pantallas nuevas hablan con el mismo servidor que las sirve: una dirección fija
# del backend en el build (VITE_API_URL) rompería el acceso desde los celulares.
$frontEnvCopia = $null
$frontEnv = Join-Path $Proyecto 'apps\frontend\.env'
if ((Test-Path $frontEnv) -and (Select-String -Path $frontEnv -Pattern '^\s*VITE_API_URL\s*=' -Quiet)) {
  $frontEnvCopia = Join-Path $respaldos "frontend-env-antes-de-actualizar-$fecha"
  Copy-Item $frontEnv $frontEnvCopia
  (Get-Content $frontEnv -Encoding utf8) -replace '^(\s*VITE_API_URL\s*=)', '# (desactivado al actualizar: mismo servidor) $1' |
    Set-Content $frontEnv -Encoding utf8
  Aviso 'VITE_API_URL desactivado en apps\frontend\.env (ahora las pantallas y el servidor van juntos).'
}

Titulo 'Instalando dependencias (puede tardar varios minutos)'
Push-Location $Proyecto
$r = Correr 'npm.cmd' @('ci', '--no-audit', '--no-fund')
Pop-Location
if ($r -ne 0) { VolverAtras 'npm ci falló.' }
Push-Location $backend
$r = Correr 'npx.cmd' @('prisma', 'generate')
Pop-Location
if ($r -ne 0) { VolverAtras 'prisma generate falló.' }
Ok 'Dependencias instaladas'

Titulo 'Compilando'
Push-Location $Proyecto
$r = Correr 'npm.cmd' @('run', 'build')
Pop-Location
if ($r -ne 0) { VolverAtras 'La compilación falló.' }
Ok 'Compilado'

# ══════════════════════════════════════════════
# 5. Configuración (.env)
# ══════════════════════════════════════════════
Titulo 'Completando la configuración'
if ((LeerEnv 'NODE_ENV') -ne 'production') { PonerEnv 'NODE_ENV' 'NODE_ENV=production' }
if (-not (LeerEnv 'TZ')) { PonerEnv 'TZ' 'TZ="America/Argentina/Buenos_Aires"' }
$jwt = LeerEnv 'JWT_SECRET'
if (-not $jwt -or $jwt.Length -lt 32) {
  $nuevo = (& node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64'))")
  PonerEnv 'JWT_SECRET' "JWT_SECRET=`"$nuevo`""
  Aviso 'JWT_SECRET era corto: se generó uno nuevo (todos tienen que volver a iniciar sesión).'
}
if (-not (LeerEnv 'MYSQL_BIN_DIR')) { PonerEnv 'MYSQL_BIN_DIR' "MYSQL_BIN_DIR='$MysqlBin'" }
if (-not (LeerEnv 'BACKUP_DIR')) { PonerEnv 'BACKUP_DIR' "BACKUP_DIR='$respaldos'" }
if (-not (LeerEnv 'BACKUP_LABEL')) { PonerEnv 'BACKUP_LABEL' "BACKUP_LABEL=`"RestOS $env:COMPUTERNAME`"" }
$claveNueva = $null
if (-not (LeerEnv 'BACKUP_PASSPHRASE')) {
  $claveNueva = (& node -e "process.stdout.write(require('crypto').randomBytes(24).toString('base64'))")
  PonerEnv 'BACKUP_PASSPHRASE' "BACKUP_PASSPHRASE=`"$claveNueva`""
}
if (-not (LeerEnv 'BACKUP_COPY_DIR') -and $env:OneDrive -and (Test-Path $env:OneDrive)) {
  $copia = Join-Path $env:OneDrive 'Respaldos RestOS'
  $resp = Read-Host "  ¿Guardar también una copia de cada respaldo en OneDrive ($copia)? [S/n]"
  if ($resp -notmatch '^[nN]') {
    New-Item -ItemType Directory -Force $copia | Out-Null
    PonerEnv 'BACKUP_COPY_DIR' "BACKUP_COPY_DIR='$copia'"
    Ok "Copia de los respaldos en $copia"
  }
}
Ok 'Configuración lista'

# ══════════════════════════════════════════════
# 6. Migraciones
# ══════════════════════════════════════════════
Titulo 'Actualizando la base (migraciones)'
$etapa = 'base'
Push-Location $backend
$r = Correr 'npx.cmd' @('prisma', 'migrate', 'deploy')
Pop-Location
if ($r -ne 0) { VolverAtras 'Las migraciones fallaron.' }
Ok 'Base actualizada'

# ══════════════════════════════════════════════
# 7. Arranque automático y verificación
# ══════════════════════════════════════════════
Titulo "Registrando el arranque automático (tarea '$Tarea')"
$supervisor = Join-Path $Proyecto 'deploy\windows\iniciar-restos.ps1'
$accion = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $backend `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$supervisor`" -Backend `"$backend`" -ServicioMySql `"$ServicioMySql`""
$alPrender = New-ScheduledTaskTrigger -AtStartup
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$usuario = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
try {
  Register-ScheduledTask -TaskName $Tarea -Action $accion -Trigger $alPrender -Settings $config -Principal $usuario `
    -Description 'Servidor de RestOS: pedidos, cobros, stock. Arranca con Windows (sin iniciar sesión) y se reinicia si se cae.' -Force -ErrorAction Stop | Out-Null
} catch { VolverAtras "No se pudo registrar la tarea: $_" }
Start-ScheduledTask -TaskName $Tarea
Write-Host '  Esperando a que responda...'
if (-not (Responde)) {
  Get-Content (Join-Path $backend 'logs\salida-error.log') -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "     $_" }
  VolverAtras "El sistema nuevo no responde en http://localhost:$puerto/api/health."
}
$etapa = 'listo'
Ok "RestOS nuevo funcionando en el puerto $puerto"

# ══════════════════════════════════════════════
# 8. Red, Apache y respaldo nocturno (si algo falla acá, el sistema ya anda)
# ══════════════════════════════════════════════
Titulo 'Red y firewall'
try {
  Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | ForEach-Object {
    $perfil = Get-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue
    if ($perfil -and $perfil.NetworkCategory -ne 'Private') {
      Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private -ErrorAction Stop
      Ok "Red '$($_.InterfaceAlias)' pasada a Privada"
    }
  }
} catch { Aviso "No se pudo pasar la red a Privada: $_. Hacelo a mano (Configuración → Red → propiedades)." }
Get-NetFirewallRule -DisplayName 'RestOS*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'RestOS' -Direction Inbound -Protocol TCP -LocalPort $puerto -Profile Private -Action Allow | Out-Null
$zt = @(Get-NetAdapter -Name 'ZeroTier*' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
if ($zt.Count -gt 0) {
  New-NetFirewallRule -DisplayName 'RestOS (ZeroTier)' -Direction Inbound -Protocol TCP -LocalPort $puerto -InterfaceAlias $zt -Action Allow | Out-Null
}
Ok "Puerto $puerto abierto para la red del local$(if ($zt.Count) { ' y ZeroTier' })"

if (-not $SinRedireccionApache -and (Test-Path 'C:\xampp\htdocs')) {
  Titulo 'Pantallas viejas en Apache'
  $viejos = @(Get-ChildItem 'C:\xampp\htdocs' -Filter index.html -Recurse -Depth 2 -ErrorAction SilentlyContinue |
    Where-Object { (Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue) -match 'RestOS' -and (Get-Content $_.FullName -Raw) -notmatch 'restos-redireccion' })
  foreach ($f in $viejos) {
    Copy-Item $f.FullName "$($f.FullName).antes-$fecha"
    $html = "<!doctype html><html lang=`"es`"><head><meta charset=`"utf-8`"><meta name=`"restos-redireccion`" content=`"1`"><title>RestOS</title>" +
      "<script>location.replace(location.protocol + '//' + location.hostname + ':$puerto/');</script></head>" +
      "<body style=`"font-family:sans-serif;padding:2rem`">RestOS se mudó: <a id=`"ir`" href=`"#`">entrá acá</a>." +
      "<script>document.getElementById('ir').href = location.protocol + '//' + location.hostname + ':$puerto/';</script></body></html>"
    [IO.File]::WriteAllText($f.FullName, $html, (New-Object Text.UTF8Encoding $false))
    Ok "$($f.FullName) ahora redirige al sistema nuevo (copia del anterior al lado)"
  }
  if ($viejos.Count -eq 0) { Write-Host '  No hay pantallas de RestOS en Apache: nada que cambiar.' }
}

Titulo 'Respaldo nocturno'
if ($claveNueva) {
  Write-Host ''
  Write-Host '  ╔════════════════════════════════════════════════════════════╗' -ForegroundColor Yellow
  Write-Host '  ║  CONTRASEÑA DE LOS RESPALDOS — ANOTALA EN PAPEL AHORA      ║' -ForegroundColor Yellow
  Write-Host '  ╚════════════════════════════════════════════════════════════╝' -ForegroundColor Yellow
  Write-Host ''
  Write-Host "      $claveNueva" -ForegroundColor White
  Write-Host ''
  Write-Host '  Sin ella NO se puede restaurar ningún respaldo. Guardala fuera de esta PC' -ForegroundColor Yellow
  Write-Host '  (papel en un sobre que guarde el dueño, y un gestor de contraseñas).' -ForegroundColor Yellow
  Read-Host '  Presioná Enter cuando la hayas anotado' | Out-Null
}
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Proyecto 'deploy\windows\programar-respaldo.ps1') -Proyecto $Proyecto
Write-Host '  Probando un respaldo ahora...'
Push-Location $backend
$r = Correr 'node' @('dist\scripts\backup.js', '--ahora')
Pop-Location
if ($r -eq 0) { Ok 'Respaldo de prueba hecho' } else { Aviso "El respaldo de prueba falló (el sistema anda igual). Mandale al desarrollador: $transcript" }

# ══════════════════════════════════════════════
Write-Host ''
Write-Host '════════════════════════════════════════════════' -ForegroundColor Green
Write-Host ' ✅ RestOS actualizado' -ForegroundColor Green
Write-Host '════════════════════════════════════════════════' -ForegroundColor Green
Write-Host 'Desde los celulares y la caja entrá a:' -ForegroundColor Cyan
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  ForEach-Object { Write-Host "   http://$($_.IPAddress):$puerto   ($($_.InterfaceAlias))" -ForegroundColor Cyan }
Write-Host ''
Write-Host "Respaldo de antes de actualizar: $volcado"
Write-Host "Registro de esta actualización: $transcript"
Write-Host 'Para la próxima actualización, corré la misma línea.'
try { Stop-Transcript | Out-Null } catch { }
