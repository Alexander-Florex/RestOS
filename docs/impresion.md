# Impresión: comandera y protocolo con el agente (tarea 1.1)

## Cómo funciona hoy

1. Cuando alguien imprime una comanda, un ticket de caja o sale un cambio de plato, el backend:
   - arma el ticket línea por línea (`apps/backend/src/shared/ticket.ts`) con el nombre del local, la mesa como la llama el local y el ancho de papel configurado;
   - lo guarda en `print_jobs` con estado **PENDING** ("Sin confirmar");
   - lo emite por socket (`print:request`) al room del restaurante.
2. La pantalla **Comandera** (menú Negocio, permiso "Cobrar") muestra cada ticket al instante, dibujado tal como sale en papel. Desde ahí se reimprime, se ven ejemplos y el Administrador elige el papel (80 o 58 mm).
3. Los trabajos de más de 30 días se borran solos.

Mientras no haya agente instalado, los tickets quedan "Sin confirmar": **no sale nada en papel**, pero se puede ver exactamente cómo saldría.

## Ancho de papel

| Papel | Letra normal | Letra doble |
|-------|--------------|-------------|
| 80 mm (el del local) | 48 caracteres | 24 |
| 58 mm | 32 caracteres | 16 |

Las líneas largas se cortan por palabra (nunca se pierde texto).

## Lo que recibe el agente (`print:request`)

Además de los datos de siempre (`type`, `tableNumber`, `tableLabel`, `items`, `total`, …) llegan:

| Campo | Qué es |
|-------|--------|
| `jobId` | Número del trabajo, para confirmar |
| `doc` | El ticket armado: `{ paperWidth, columns, lines: [{ text, align, bold, size }] }` |
| `escpos` | **Los bytes listos para la impresora** (ESC/POS, base64): inicio, tabla CP858, texto, avance y corte |
| `title`, `paperWidth`, `createdAt` | Para mostrar o registrar |

El agente **no arma nada**: decodifica `escpos` y lo manda tal cual a la impresora (USB, red en el puerto 9100 o la cola de Windows en modo RAW). Así lo impreso es igual a la pantalla.

## Confirmación

Después de imprimir, el agente avisa:

```
POST /api/printing/jobs/:jobId/status
{ "ok": true }                         → "Impreso"
{ "ok": false, "error": "Sin papel" }  → "No imprimió" (se ve en la Comandera)
```

Hoy esa ruta usa el token de un usuario con permiso "Cobrar". Cuando exista el agente, conviene darle su propio usuario.

## Pendiente

- **Marca y modelo de la impresora.** Define la tabla de caracteres: hoy se usa CP858 (`ESC t 19`), que es la de casi todas (Epson, Xprinter, 3nStar). Si los acentos salen mal en la hoja de autoprueba, se cambia `codePage` en `src/lib/escpos.ts`.
- **El agente** (`apps/print-agent`): conectarse por socket, imprimir `escpos` y confirmar.
- **Alerta visible** en caja y en el mozo cuando un ticket falla, con botón de reintentar.
