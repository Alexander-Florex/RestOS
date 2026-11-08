# diagnostico.ps1 - Junta datos de una PC donde ya corre RestOS (version anterior, XAMPP)
# para planificar la actualizacion. Solo lee: no cambia nada y oculta las contrasenas.
# Uso (PowerShell, no hace falta administrador):
#   irm https://raw.githubusercontent.com/Alexander-Florex/RestOS/<rama>/deploy/windows/diagnostico.ps1 | iex
# Deja diagnostico-restos.txt en el escritorio y lo abre.

$escritorio = [Environment]::GetFolderPath('Desktop')
$salida = Join-Path $escritorio 'diagnostico-restos.txt'
Write-Host 'Juntando datos (puede tardar 1 o 2 minutos)...' -ForegroundColor Cyan

$mysqlExe = 'C:\xampp\mysql\bin\mysql.exe'

$texto = & {
  '== Fecha'; Get-Date
  '== Windows'; (Get-CimInstance Win32_OperatingSystem).Caption
  '== Node'
  $n = Get-Command node -ErrorAction SilentlyContinue
  if ($n) { & $n.Source --version; $n.Source } else { 'Node no esta en el PATH' }

  '== MariaDB/MySQL'
  if (Test-Path $mysqlExe) { & $mysqlExe --version } else { 'No esta en C:\xampp\mysql\bin' }
  Get-ChildItem 'C:\xampp' -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name

  '== Servicios de base de datos'
  Get-Service | Where-Object { $_.Name -match 'mysql|maria|apache' } | Format-Table Name, Status, StartType -AutoSize | Out-String

  '== Procesos node (como arranca el sistema)'
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId, ExecutablePath, CommandLine | Format-List | Out-String
  '== Procesos de base de datos'
  Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'mysqld|mariadbd' } | Select-Object Name, ExecutablePath | Format-List | Out-String

  '== Puertos escuchando (3000-3010, 5173, 3306, 80)'
  Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { ($_.LocalPort -ge 3000 -and $_.LocalPort -le 3010) -or $_.LocalPort -in 5173, 3306, 80, 4173 } |
    Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table -AutoSize | Out-String

  '== Inicio automatico de Windows'
  Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup", 'C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp' -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty FullName
  Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskPath -eq '\' } | Select-Object TaskName, State | Format-Table -AutoSize | Out-String

  '== Red'
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' } | Select-Object InterfaceAlias, IPAddress | Format-Table -AutoSize | Out-String
  Get-NetConnectionProfile -ErrorAction SilentlyContinue | Select-Object Name, NetworkCategory | Format-Table -AutoSize | Out-String

  '== Carpetas del sistema (buscando schema.prisma)'
  $schemas = @()
  $schemas += Get-ChildItem 'C:\' -Filter schema.prisma -Recurse -Depth 5 -ErrorAction SilentlyContinue
  $schemas += Get-ChildItem $env:USERPROFILE -Filter schema.prisma -Recurse -Depth 8 -ErrorAction SilentlyContinue
  $schemas = $schemas | Where-Object { $_.FullName -notmatch 'node_modules' } | Sort-Object FullName -Unique
  if (-not $schemas) { 'No se encontro ningun schema.prisma' }

  foreach ($s in $schemas) {
    $back = $s.Directory.Parent.FullName
    $raiz = $s.Directory.Parent.Parent.Parent.FullName
    ''
    "---- Proyecto: $raiz"
    "Backend: $back"
    if (Test-Path (Join-Path $raiz '.git')) {
      Push-Location $raiz
      'git: ' + (git log -1 --format='%h %ci %s' 2>&1)
      'rama: ' + (git rev-parse --abbrev-ref HEAD 2>&1)
      Pop-Location
    } else { 'git: no es repositorio' }
    'Tiene dist (compilado): ' + (Test-Path (Join-Path $back 'dist'))
    'Ultimas migraciones en la carpeta:'
    Get-ChildItem (Join-Path $back 'prisma\migrations') -Directory -ErrorAction SilentlyContinue | Select-Object -Last 4 -ExpandProperty Name

    'Archivos .bat (proyecto y escritorio):'
    Get-ChildItem $raiz, $escritorio -Filter *.bat -ErrorAction SilentlyContinue | ForEach-Object {
      "## $($_.FullName)"
      Get-Content $_.FullName
    }

    $envFile = Join-Path $back '.env'
    if (Test-Path $envFile) {
      'Variables del .env (sin valores secretos):'
      Get-Content $envFile | Where-Object { $_ -match '^\s*[A-Z_]+\s*=' } | ForEach-Object {
        if ($_ -match '^\s*(NODE_ENV|PORT|HOST|TZ|SERVE_FRONTEND|CORS_ORIGIN|FRONTEND_URL)\s*=') { $_ } else { ($_ -split '=')[0].Trim() + '=(oculto)' }
      }
      $m = Select-String -Path $envFile -Pattern '^\s*DATABASE_URL\s*=\s*["'']?([^"'']+)' | Select-Object -First 1
      if ($m) {
        $u = $m.Matches[0].Groups[1].Value
        'DATABASE_URL: ' + ($u -replace '://([^:@]+):[^@]*@', '://$1:****@')
        if ((Test-Path $mysqlExe) -and ($u -match 'mysql://([^:@]+):?([^@]*)@([^:/]+):?(\d*)/([^?]+)')) {
          $usuario = $Matches[1]; $clave = [uri]::UnescapeDataString($Matches[2]); $hostDb = $Matches[3]
          $puerto = if ($Matches[4]) { $Matches[4] } else { '3306' }; $base = $Matches[5]
          $env:MYSQL_PWD = $clave
          'Migraciones aplicadas en la base:'
          & $mysqlExe -u $usuario -h $hostDb -P $puerto -N -e "SELECT migration_name FROM ``$base``._prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name" 2>&1
          'Cantidades:'
          & $mysqlExe -u $usuario -h $hostDb -P $puerto -N -e "SELECT 'ventas', COUNT(*) FROM ``$base``.sales UNION ALL SELECT 'restaurantes', COUNT(*) FROM ``$base``.restaurants UNION ALL SELECT 'usuarios', COUNT(*) FROM ``$base``.users" 2>&1
          'Tamano de la base (MB):'
          & $mysqlExe -u $usuario -h $hostDb -P $puerto -N -e "SELECT ROUND(SUM(data_length+index_length)/1024/1024,1) FROM information_schema.tables WHERE table_schema='$base'" 2>&1
          Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
        }
      }
    } else { "Sin .env en $back" }
  }
} *>&1 | Out-String -Width 300

$texto | Out-File $salida -Encoding utf8
Write-Host "Listo: $salida" -ForegroundColor Green
notepad $salida
