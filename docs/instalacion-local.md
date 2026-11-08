# Instalación de RestOS en el servidor del local (Windows)

Guía paso a paso para dejar RestOS funcionando en la PC del local que hace de servidor. Al terminar:

- RestOS corre como **servicio de Windows**: arranca solo al prender la PC (después de MySQL), sin que nadie inicie sesión, y se reinicia si se cae.
- Celulares y PC del local entran a **una sola dirección**, por ejemplo `http://192.168.0.10:3001`. Funciona **sin internet**.
- Hay un **respaldo cifrado cada noche**, con copia fuera de la PC y aviso si falla (ver [restauracion.md](restauracion.md)).

Tiempo estimado: 1 a 2 horas. Hacelo fuera del horario de servicio.

> **¿La PC ya tiene una versión anterior de RestOS con XAMPP?** No sigas esta guía: corré, en PowerShell **como administrador** y fuera de horario:
>
> ```powershell
> irm https://raw.githubusercontent.com/Alexander-Florex/RestOS/produccion/deploy/windows/actualizar-desde-xampp.ps1 -OutFile $env:TEMP\actualizar-restos.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\actualizar-restos.ps1
> ```
>
> Detiene la versión anterior y desactiva su tarea `RestOS-Watcher`. Respalda la base en `C:\RestOS\respaldos`, baja el código, compila y aplica las migraciones. Si algo falla, vuelve atrás solo. Si sale bien:
> - Deja la tarea **"RestOS"**, que arranca con Windows sin iniciar sesión y se reinicia si se cae (`deploy\windows\iniciar-restos.ps1`, sin NSSM).
> - Deja el respaldo nocturno programado.
> - Pasa la red a Privada y abre el puerto del `.env` (también para ZeroTier).
> - Si Apache servía las pantallas viejas y le pasaba `/api` al sistema, copia las nuevas en el mismo lugar. Los mozos siguen entrando a la misma dirección (por ejemplo `http://10.147.17.83/` por ZeroTier). Si Apache no pasaba `/api`, el sistema pasa al puerto 80 (la dirección sin puerto vuelve a andar), Apache y phpMyAdmin pasan al 8080, y el puerto anterior redirige al nuevo (`REDIRECT_PORTS`).
> - Al final mide la velocidad: cuánto tarda el servidor y si cada celular de ZeroTier llega directo (`DIRECT`) o pasando por los servidores de ZeroTier (`RELAY`, lento).
> - Programa la tarea **"RestOS - Actualización"**: todas las noches a las 4 se fija si hay cambios en la rama `produccion` y, si los tests de GitHub pasaron, actualiza sola (con respaldo y vuelta atrás). Resultado de cada noche en `C:\RestOS\actualizacion-automatica.log`.
>
> **El local corre la rama `produccion`, no `main`.** Para mandar cambios al local: unir `main` a `produccion` (PR de `main` a `produccion`); esa noche se aplican. Para aplicarlos ya, la misma línea de arriba. Para no tocar el puerto: `-SinPuerto80`. Antes de actualizar, para ver cómo está la PC: `irm https://raw.githubusercontent.com/Alexander-Florex/RestOS/main/deploy/windows/diagnostico.ps1 | iex`.

---

## 0. Antes de empezar

- **La PC:** Windows 10 u 11 de 64 bits, que quede siempre prendida, **conectada por cable al router** (no por Wi-Fi) y, si se puede, con UPS (ver tarea 6.6).
- **Lo que hay que bajar:**
  - MySQL Community Server 8.0 (instalador para Windows).
  - Node.js LTS (20 o más nuevo).
  - NSSM 2.24, de nssm.cc.
- **Carpeta de trabajo:** `C:\RestOS`. **No** la pongas dentro de OneDrive, Escritorio ni Documentos: la sincronización de OneDrive bloquea archivos mientras el sistema los usa.

```
C:\RestOS\
  app\         ← el proyecto (este repositorio)
  nssm\        ← nssm.exe
  respaldos\   ← respaldos locales (los crea solo)
  secretos\    ← llave SSH de Hostinger (si se usa)
```

## 1. Ajustes de Windows

En PowerShell **como administrador**:

```powershell
# Que no se suspenda ni apague el disco (si se duerme, los celulares no pueden tomar pedidos)
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change disk-timeout-ac 0
```

- **Configuración → Red e Internet → (la conexión) → Tipo de perfil de red: Privada.** Si queda en "Pública", el firewall no deja entrar a los celulares.
- **Windows Update → Opciones avanzadas → Horas activas:** poné el horario del local (por ejemplo, de 10 a 1) para que nunca reinicie en pleno servicio.

## 2. MySQL y Node.js

1. Instalá **MySQL Server 8.0**. Elegí "Server only", configuralo **como servicio de Windows** con el nombre `MySQL80` e inicio automático, y anotá la contraseña de `root` en un lugar seguro.
2. Instalá **Node.js LTS** con las opciones por defecto.
3. Comprobá en una PowerShell nueva:
   ```powershell
   node --version          # v20 o más
   Get-Service MySQL80     # Running
   ```

## 3. Base de datos y usuario propio

Abrí "MySQL 8.0 Command Line Client" (pide la contraseña de root) y pegá, **cambiando la contraseña**:

```sql
CREATE DATABASE restos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'restos'@'localhost' IDENTIFIED BY 'UNA-CONTRASEÑA-LARGA';
-- "restos%" incluye la base del sistema y las que se crean al probar una restauración
GRANT ALL PRIVILEGES ON `restos%`.* TO 'restos'@'localhost';
FLUSH PRIVILEGES;
```

> Si la contraseña tiene caracteres como `@ : / # ?`, en el `.env` van codificados (`@` → `%40`, `#` → `%23`, `:` → `%3A`, `/` → `%2F`, `?` → `%3F`). Es más simple usar solo letras y números.

## 4. El proyecto

1. Copiá el proyecto a `C:\RestOS\app`, con `git clone` o descomprimiendo el ZIP. **No copies** `node_modules`, `.env` ni `dist` de otra PC.
2. Bajá NSSM y dejá `nssm.exe` (el de la carpeta `win64`) en `C:\RestOS\nssm\nssm.exe`.
3. Configuración: copiá `deploy\windows\env.produccion.example` a `apps\backend\.env` y completalo:
   - `DATABASE_URL`: con el usuario y la contraseña del paso 3.
   - `JWT_SECRET`: generalo con
     ```powershell
     node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
     ```
   - Lo del respaldo se completa en el paso 7.
   - **Las rutas de Windows van entre comillas simples** (`'C:\RestOS\respaldos'`). Con comillas dobles, `\r` y `\n` se convierten en saltos de línea.
4. Instalar, compilar y crear las tablas (PowerShell en `C:\RestOS\app`):
   ```powershell
   npm ci
   npm run build
   cd apps\backend
   npx prisma migrate deploy
   ```
5. Alta del restaurante y del primer usuario Administrador. Usá una contraseña de verdad, no la del ejemplo:
   ```powershell
   npx tsx prisma/reset-restaurant.ts --name "Nombre del local" --admin-user admin --admin-pass "CONTRASEÑA-DEL-DUEÑO" --admin-name "Nombre"
   ```
   Anotá el **ID de restaurante** que muestra: se pide al iniciar sesión.

> **Nunca** corras `npm run db:seed`, `db:setup` en modo desarrollo, `prisma migrate reset` ni `prisma db push` en este servidor: borran o pisan datos.

## 5. RestOS como servicio

PowerShell **como administrador**, en `C:\RestOS\app`:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\instalar-servicio.ps1
```

El script:
- Controla que esté todo (Node, NSSM, la compilación, el `.env` con `NODE_ENV=production`).
- Registra el servicio **RestOS**, que depende de MySQL, arranca solo y se reinicia si se cae.
- Abre el puerto 3001 en el firewall **solo para la red privada**.
- Lo arranca y verifica que responda.
- Muestra la dirección para los celulares.

Si el servicio de MySQL tiene otro nombre: `-ServicioMySql NOMBRE`. Si NSSM está en otro lado: `-Nssm C:\ruta\nssm.exe`.

## 6. Dirección fija y celulares

1. En el router, hacé una **reserva DHCP** (IP fija) para la PC servidor, con la IP que mostró el script. Así la dirección no cambia nunca.
2. En cada celular, abrí Chrome en `http://IP-DEL-SERVIDOR:3001`, iniciá sesión y usá **"Agregar a la pantalla principal"**.
3. Las notificaciones del navegador no funcionan sobre `http://` en la red local. Se resuelve con la tarea 6.2 (HTTPS en la LAN). El resto funciona igual.

## 7. Respaldo nocturno

Detalle completo y cómo restaurar: **[restauracion.md](restauracion.md)**. Resumen:

1. En `apps\backend\.env`:
   - `BACKUP_PASSPHRASE`: generala con
     ```powershell
     node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"
     ```
     **Anotala en papel**, en un sobre cerrado que guarde el dueño, y en un gestor de contraseñas. **Sin ella no se puede restaurar ningún respaldo.**
   - `BACKUP_DIR='C:\RestOS\respaldos'`.
   - **Al menos un destino fuera de la PC** (una opción, o las dos):
     - **Carpeta de OneDrive o Google Drive del dueño**, o disco externo: `BACKUP_COPY_DIR='C:\Users\Dueño\OneDrive\Respaldos RestOS'`. Los archivos van cifrados, así que en la nube no se pueden leer.
     - **Hostinger por SFTP**, con llave SSH (sin contraseña):
       ```powershell
       mkdir C:\RestOS\secretos
       ssh-keygen -t ed25519 -f C:\RestOS\secretos\hostinger -N '""' -C restos-respaldo
       ```
       En hPanel: **Avanzado → Acceso SSH**. Activalo, agregá el contenido de `C:\RestOS\secretos\hostinger.pub` y copiá host, puerto y usuario a `BACKUP_SFTP_HOST`, `BACKUP_SFTP_PORT` y `BACKUP_SFTP_USER`. Después: `BACKUP_SFTP_KEY='C:\RestOS\secretos\hostinger'`.
   - **Aviso si fallan dos noches** (`BACKUP_ALERT_URL`): WhatsApp con CallMeBot o notificación al celular con ntfy.sh. Ver el ejemplo en `env.produccion.example`.
2. Programar la tarea (PowerShell **como administrador**):
   ```powershell
   powershell -ExecutionPolicy Bypass -File deploy\windows\programar-respaldo.ps1 -LlaveSsh C:\RestOS\secretos\hostinger
   ```
   Sin Hostinger, sacá `-LlaveSsh ...`.
3. Probarlo ya:
   ```powershell
   cd C:\RestOS\app\apps\backend
   npm run respaldo -- --ahora
   npm run respaldo -- --probar-aviso    # si configuraste el aviso
   ```
4. **Hacer una restauración de prueba** (ver [restauracion.md](restauracion.md), sección "Simulacro"). Un respaldo que nunca se restauró no está probado.

## 8. Verificación final

- [ ] Reiniciá la PC **sin iniciar sesión**. Desde un celular, entrá a la dirección: tiene que andar.
- [ ] Tomá un pedido de prueba desde un celular y cobralo desde la caja.
- [ ] En el inicio del panel (Administrador) aparece **"Respaldo al día"** en verde.
- [ ] Hay archivos `restos-db-…enc` en `C:\RestOS\respaldos` **y** en el destino externo.
- [ ] El simulacro de restauración salió bien.
- [ ] La contraseña de los respaldos está anotada en papel, fuera de la PC.

## 9. Mantenimiento

| Qué | Cómo |
|---|---|
| Ver si el servicio anda | `Get-Service RestOS`, o `services.msc` → "RestOS (sistema del restaurante)" |
| Reiniciarlo | `C:\RestOS\nssm\nssm.exe restart RestOS` (como administrador) |
| Logs | `C:\RestOS\app\apps\backend\logs\` → `app-AAAA-MM-DD.log` (errores), `access-…log` (pedidos), `servicio.log` (arranque). Se borran solos a los 30 días |
| Logs del respaldo | `C:\RestOS\respaldos\respaldo-AAAA-MM.log` y `estado.json` |
| ¿Responde? | Abrí `http://localhost:3001/api/health` → `"status":"ok"` |
| Actualizar a una versión nueva | Copiá el código nuevo (o usá `-GitPull`) y corré, como administrador: `powershell -ExecutionPolicy Bypass -File deploy\windows\actualizar.ps1`. Hace respaldo, compila, aplica migraciones y reinicia. Fuera de horario |

## 10. Problemas comunes

- **Los celulares no entran, pero en la PC sí anda:** la red de Windows está como "Pública" (paso 1), el celular está en otra red (por ejemplo, Wi-Fi de invitados), o cambió la IP (paso 6).
- **El servicio no arranca:** mirá `logs\servicio.log`. Lo más común es un error en el `.env` (`Variables de entorno inválidas`) o MySQL detenido.
- **"Respaldo atrasado" en el panel:** mirá `C:\RestOS\respaldos\respaldo-AAAA-MM.log`. Sin internet, se reintenta solo cada hora.
- **Error de SFTP "UNPROTECTED PRIVATE KEY FILE":** volvé a correr `programar-respaldo.ps1 -LlaveSsh ...`, que ajusta los permisos de la llave.
- **"No se encontró mysqldump":** MySQL está en otra carpeta. Indicala en el `.env` con `MYSQL_BIN_DIR='C:\...\bin'`.
