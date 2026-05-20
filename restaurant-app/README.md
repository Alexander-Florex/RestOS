# RestaurantOS 🍽️

Sistema de gestión de restaurante con roles, WebSocket y registro de ventas.

## Cuentas de acceso

| Usuario    | Contraseña  | Rol            | Acceso                                    |
|------------|-------------|----------------|-------------------------------------------|
| admin      | admin123    | Administrador  | Todo                                      |
| mesero1    | waiter123   | Mesero         | Toma de pedidos (vista móvil)             |
| personal1  | staff123    | Personal       | Mesas · Menú · Ventas                     |

## Desarrollo local

```bash
npm install
npm run dev:full   # Inicia servidor Express (3001) + Vite (5173)
```

## Deploy en Netlify (frontend)

1. Subí el proyecto a GitHub
2. Conectá el repo en Netlify
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Variables de entorno en Netlify:
   - `VITE_API_URL` → URL de tu backend (Railway/Render)
   - `VITE_WS_URL` → URL WebSocket de tu backend

## Deploy del backend (Railway / Render)

El servidor Express+WebSocket vive en `server/index.js`.
Usá Railway o Render para hostear el backend (free tier disponible).

Start command: `node server/index.js`

## WebSocket

El WebSocket transmite actualizaciones en tiempo real:
- `tables_updated` — cuando cambia el estado de una mesa
- `menu_updated` — cuando el admin cambia la carta
- `order_added` — cuando el mesero envía un pedido
- `sale_registered` — cuando se registra una venta

Funciona automáticamente en la red local (celulares conectados al mismo WiFi).
