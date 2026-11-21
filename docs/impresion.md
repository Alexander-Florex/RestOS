# Impresión: comandera (tarea 1.1)

Impresora del local: **Xprinter XP-V320N**. Es térmica, de 80 mm, tiene cortador automático y se conecta por USB o por red. Está enchufada **por USB a la PC del servidor**.

## Cómo funciona

1. Cada vez que alguien imprime una comanda o un ticket de caja, o sale un cambio de plato, el backend hace esto:
   - arma el ticket línea por línea (`apps/backend/src/shared/ticket.ts`) con el nombre del local, la mesa como la llama el local y el ancho de papel;
   - lo guarda en `print_jobs` con el estado **PENDING**;
   - lo muestra al instante en la pantalla **Comandera**.
2. La **cola de impresión** (`modules/printing/printer-worker.ts`) corre dentro del mismo backend. No hace falta un programa aparte ni otro usuario.
   - Toma los tickets en orden y los manda a la impresora elegida, convertidos a ESC/POS (`src/lib/escpos.ts`).
   - Si salió → **PRINTED** ("Impreso").
   - Si falló → reintenta sola hasta **3 veces, cada 10 segundos** ("Reintentando").
   - Si sigue fallando → **FAILED** ("No salió"). Arriba de todas las pantallas de quien cobra aparece una **alerta roja** con el motivo y dos botones:
     - **Reintentar**;
     - **Ya está**: se resolvió sin imprimir, por ejemplo avisándole a cocina de palabra. El ticket pasa a **DISCARDED**.
   - Un ticket que esperó **más de 30 minutos** no se imprime tarde (por ejemplo, si el servidor estuvo apagado): queda como "No salió" para decidir a mano.
3. Los tickets quedan guardados en la base, así que si el servidor se reinicia, la cola sigue donde quedó. Los de más de 30 días se borran solos.

## Cómo se manda a la impresora

| `restaurants.printerName` | Cómo imprime |
|---|---|
| Nombre de Windows (`XP-80C`, `POS-80`…) | **USB.** Usa la cola de Windows en modo RAW, a través de la API winspool, con un PowerShell que queda abierto (`src/lib/printers/windows.ts`). Después de mandar, espera hasta 20 s a que el trabajo salga de la cola de Windows. Si no sale (impresora apagada, sin papel o con la tapa abierta), lo **saca de la cola** y avisa el error, para que el reintento no imprima dos veces. |
| IP (`192.168.1.50` o `192.168.1.50:9100`) | **Red.** Manda los bytes directo al puerto 9100. |
| Vacío | No imprime: los tickets solo se ven en la pantalla ("Solo pantalla"). |

`PRINTER_WORKER=off` en el `.env` apaga la cola. Sirve, por ejemplo, en una PC de desarrollo que tiene cargada la base del local.

## Puesta en marcha en el local (una sola vez)

1. **Driver.** En la PC del servidor, instalar el driver de la Xprinter: viene en el CD de la caja o se baja de la web de Xprinter. Con la impresora enchufada por USB y prendida, en **Configuración → Impresoras y escáneres** tiene que aparecer, por ejemplo como "XP-80C".
2. **Actualizar RestOS.** Se hace con la actualización de la noche o con `actualizar-desde-xampp.ps1`. Aplica la migración `20261119120000_printer`.
3. **Elegir la impresora.** Entrar como Administrador → **Negocio → Comandera → Elegir impresora**. La lista muestra las impresoras de Windows y marca la que "parece la comandera". Elegirla y tocar **Usar esta**.
4. **Probar.** Tocar **Imprimir prueba**. Sale una hoja con acentos, eñes, los cuatro tamaños de letra y una regla de 48 caracteres. Tiene que salir:
   - entera, sin líneas cortadas;
   - con la **ñ y los acentos bien**;
   - con el corte al final.

Lo que se elige se guarda en la auditoría (`printing.settings`). Si en ese momento había tickets esperando de más de 5 minutos atrás, se descartan para que no salgan todos de golpe.

### Si algo sale mal

| Síntoma | Qué hacer |
|---|---|
| No aparece en la lista | Falta el driver o la impresora está apagada. Instalar el driver, prenderla y tocar **Buscar de nuevo**. |
| "Windows marca la impresora como desconectada" | Revisar el cable USB y que esté prendida. |
| "La impresora no tomó el ticket" | Revisar papel, tapa y que esté prendida. Después, **Reintentar**. |
| Salen símbolos raros o letras chinas | El sistema ya manda `FS .` (sin modo chino) y la tabla **PC850** (`ESC t 2`). Si aun así falla, imprimir la hoja de autoprueba: con la impresora apagada, mantener **FEED** y prenderla. Mirar qué tabla de caracteres lista y cambiar `codePage` en `src/lib/escpos.ts`. |
| No corta el papel | Revisar el DIP switch del cortador (manual, "Configuración del modo de impresión"). |

## Ancho de papel

| Papel | Letra normal | Letra doble |
|-------|--------------|-------------|
| 80 mm (el del local) | 48 caracteres | 24 |
| 58 mm | 32 caracteres | 16 |

Las líneas largas se cortan por palabra (nunca se pierde texto). Lo que no existe en la tabla PC850 (emojis, €) sale como "?", y la pantalla lo muestra igual.

## API

| Ruta | Permiso | Qué hace |
|---|---|---|
| `GET /api/printing/status` | Cobrar | Muestra la impresora elegida, si anda, el último error, cuántos tickets hay en cola y los que no salieron en las últimas 12 h. |
| `POST /api/printing/jobs/:id/retry` | Cobrar | Vuelve a intentar el mismo ticket, desde cero. |
| `POST /api/printing/jobs/:id/discard` | Cobrar | "Ya está": lo da por resuelto. |
| `POST /api/printing/jobs/:id/reprint` | Cobrar | Imprime otra copia (queda como ticket nuevo). |
| `POST /api/printing/sample/test` | Cobrar | Imprime la hoja de prueba. |
| `GET /api/printing/printers` | Configurar salón (Administrador) | Lista las impresoras instaladas en Windows. |
| `PUT /api/printing/settings` | Configurar salón (Administrador) | Guarda `{ paperWidth?, printerName? }`. |

Por socket:
- `print:request`: un ticket nuevo, con `jobId`, `doc` y `escpos` en base64.
- `print-job:updated`: un ticket cambió de estado.

## Qué sale en la comanda de cocina

Salen los platos de mesa y para llevar, **sin bebidas**. Lo decide cada categoría en **Menú → Categorías** con el botón "Va a cocina / No va a cocina" (la categoría Bebidas viene apagada). Vale también para los tickets de rehacer y cambiar plato. Un pedido solo de bebidas no genera ticket, pero sigue en la cuenta. Si no se puede saber la categoría de un plato, se imprime.

## Pendiente

- Decidir con el local:
  - si la comanda sale **sola** al mandar el pedido o, como hoy, con el botón;
  - si el ticket de caja sale solo al cobrar;
  - si hay un cajón de dinero enchufado a la impresora.
- Avisarle también al mozo cuando su comanda no salió (hoy la alerta la ven Caja y el Administrador).
