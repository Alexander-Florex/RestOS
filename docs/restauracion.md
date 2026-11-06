# Respaldo y restauración de RestOS

## Cómo funciona el respaldo

- La tarea **"RestOS - Respaldo"** corre **cada hora** y al prender la PC. La crea `deploy\windows\programar-respaldo.ps1`.
- **Desde las 3 a. m.** (`BACKUP_HOUR`) hace el respaldo del día, una sola vez. Si la PC estaba apagada a esa hora, lo hace apenas prende.
- Cada respaldo genera:
  - `restos-db-AAAA-MM-DD_HHMM.sql.gz.enc`: toda la base (ventas, pedidos, carta, stock, usuarios...).
  - `restos-comprobantes-AAAA-MM-DD_HHMM.tar.gz.enc`: la carpeta `uploads` con los comprobantes de pago.
- Los dos van **comprimidos y cifrados** (AES-256-GCM) con `BACKUP_PASSPHRASE`. Sin esa contraseña no se pueden abrir, ni en la nube ni si alguien se lleva el disco.
- Quedan en `BACKUP_DIR` y se copian a los destinos externos: carpeta de OneDrive o disco (`BACKUP_COPY_DIR`) y/o Hostinger por SFTP (`BACKUP_SFTP_*`).
- **Sin internet**, el respaldo local se hace igual y la subida **se reintenta cada hora** hasta que sale.
- Se guardan **30 días** (`BACKUP_RETENTION_DAYS`), local y afuera. Siempre quedan al menos los 7 respaldos más nuevos, aunque sean viejos (por si la PC estuvo apagada mucho tiempo).
- Si **fallan dos noches seguidas**, manda un aviso (`BACKUP_ALERT_URL`) una vez por día, y el inicio del panel lo muestra en rojo.
- Registro: `BACKUP_DIR\respaldo-AAAA-MM.log`. Estado: `BACKUP_DIR\estado.json`, o `npm run respaldo -- --estado`.

Comandos (en `C:\RestOS\app\apps\backend`):

```powershell
npm run respaldo -- --ahora          # respaldar ya (por ejemplo, antes de tocar algo delicado)
npm run respaldo -- --estado         # cómo está el último respaldo
npm run respaldo -- --probar-aviso   # mandar un aviso de prueba
```

## Lo más importante

1. **La contraseña de cifrado** (`BACKUP_PASSPHRASE`) tiene que estar **anotada fuera de la PC**: en papel, en un sobre cerrado que guarda el dueño, y en un gestor de contraseñas. Si se pierde, los respaldos no sirven.
2. **Un respaldo que nunca se restauró no está probado.** Hacé el simulacro de abajo al instalar y después **una vez por mes**.
3. Restaurá siempre en una **base nueva** y cambiá recién cuando compruebes que está bien. El comando se niega a pisar una base con datos, salvo `--forzar`.

---

## Simulacro (una vez por mes, en el mismo servidor)

No toca la base del sistema: restaura en una base aparte y la borra al final.

```powershell
cd C:\RestOS\app\apps\backend
npm run respaldo -- --ahora
# El nombre del archivo más nuevo:
Get-ChildItem C:\RestOS\respaldos\restos-db-*.enc | Sort-Object Name | Select-Object -Last 1
npm run restaurar -- --base restos_simulacro --archivo C:\RestOS\respaldos\restos-db-AAAA-MM-DD_HHMM.sql.gz.enc
```

Comprobá en el "MySQL 8.0 Command Line Client" que estén los datos de hoy:

```sql
SELECT COUNT(*) FROM restos_simulacro.sales;
SELECT MAX(createdAt) FROM restos_simulacro.sales;   -- la última venta (en UTC: 3 horas más que la hora local)
DROP DATABASE restos_simulacro;
```

Probá también un archivo **del destino externo** (OneDrive o Hostinger), no solo el local: es el que vas a necesitar si se rompe la PC.

---

## Caso 1 — Se rompió la base pero la PC anda

1. **Pará el servicio** para que nadie siga escribiendo (como administrador):
   ```powershell
   C:\RestOS\nssm\nssm.exe stop RestOS
   ```
2. Restaurá el último respaldo bueno en una base nueva:
   ```powershell
   cd C:\RestOS\app\apps\backend
   npm run restaurar -- --base restos_restaurado --archivo C:\RestOS\respaldos\restos-db-....sql.gz.enc
   ```
3. Revisá que estén los datos (consultas del simulacro, con `restos_restaurado`).
4. En `apps\backend\.env`, cambiá la base de `DATABASE_URL` a `restos_restaurado`.
5. Aplicá migraciones por si el respaldo es de una versión anterior, y arrancá:
   ```powershell
   npx prisma migrate deploy
   C:\RestOS\nssm\nssm.exe start RestOS
   ```
6. Dejá la base rota con su nombre (`restos`) hasta estar seguro. No la borres el mismo día.

> Se pierde lo cargado entre el último respaldo y la falla. Si fue en pleno servicio, anotá en papel las ventas de esas horas y cargalas de nuevo.

## Caso 2 — Se rompió la PC (restauración en una máquina limpia)

1. En la PC nueva, seguí **[instalacion-local.md](instalacion-local.md)** hasta el paso 4.4 inclusive (`npm run build`), **sin** correr `prisma migrate deploy` ni el alta del restaurante.
2. En `apps\backend\.env` poné la **misma `BACKUP_PASSPHRASE`** de antes (la del sobre).
3. Traé los dos archivos más nuevos (`restos-db-…` y `restos-comprobantes-…`) desde OneDrive o Hostinger a `C:\RestOS\respaldos`. Desde Hostinger, con la llave o desde el Administrador de archivos de hPanel.
4. Restaurá la base (en la base `restos` vacía del paso 3 de la instalación) y los comprobantes:
   ```powershell
   cd C:\RestOS\app\apps\backend
   npm run restaurar -- --base restos --archivo C:\RestOS\respaldos\restos-db-....sql.gz.enc
   npm run restaurar -- --comprobantes C:\RestOS\respaldos\restos-comprobantes-....tar.gz.enc --destino .
   npx prisma migrate deploy
   ```
   El segundo comando deja los comprobantes en `apps\backend\uploads`.
5. Seguí la instalación desde el paso 5 (servicio, IP fija, respaldo). Los usuarios, contraseñas, carta y ventas son los del respaldo, así que **no** hagas el alta del restaurante.
6. Si la IP del servidor nueva es distinta, reservala en el router con la misma que tenía (o avisá la nueva a los mozos).

## Si algo falla al restaurar

| Mensaje | Qué pasa |
|---|---|
| `No se pudo descifrar: la contraseña … no es la correcta o el archivo está dañado` | La `BACKUP_PASSPHRASE` no es la que se usó al respaldar, o el archivo se dañó. Probá con otro día |
| `La base "x" ya tiene N tablas` | Elegí otro nombre de base. `--forzar` la borra y la reemplaza: usalo solo si estás seguro |
| `No es un respaldo de RestOS` | El archivo no es un `.enc` de RestOS (o se bajó incompleto) |
| `No se encontró mysql` | Configurá `MYSQL_BIN_DIR` en el `.env` |
| `Access denied … to database 'x'` | El usuario de MySQL no puede crear esa base: usá un nombre que empiece con `restos` (ver el `GRANT` de la instalación) |

## Ver un respaldo a mano

Para mirar el contenido sin restaurar, restauralo en una base de prueba (`--base restos_ver`) y consultala. No hay otra forma de abrir los `.enc`, y está bien que así sea.
