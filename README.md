# RestOS Cliente 🍽️

Sistema de gestión de restaurante. Mapa de mesas en tiempo real, toma de pedidos móvil, catálogo, ventas, inventario y staff.

## Stack

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend**: Node + Express + TypeScript + Socket.io
- **Base de datos**: MySQL + Prisma ORM
- **Auth**: JWT + bcrypt (cookies httpOnly opcionales)
- **Real-time**: Socket.io (mesas, pedidos, ventas)

## Estructura

```
restos-cliente/
├── apps/
│   ├── backend/      # API Express + Socket.io + Prisma
│   └── frontend/     # SPA React (admin/staff/mesero)
└── package.json      # npm workspaces
```

## Setup inicial

### 1. Pre-requisitos

- Node.js ≥ 20
- MySQL ≥ 8 corriendo (local, XAMPP, o donde tengas)

### 2. Instalar dependencias

```bash
npm install
```

Esto instala las deps del root + de ambos workspaces.

### 3. Variables de entorno

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
```

Editá `apps/backend/.env` con tu URL de MySQL:

```env
DATABASE_URL="mysql://usuario:password@localhost:3306/restos_db"
JWT_SECRET="cambiame-por-algo-largo-y-aleatorio"
```

### 4. Inicializar la base de datos

```bash
# Crea la base + corre migraciones + inserta datos demo
npm run db:setup
```

Equivalente a:

```bash
npm run db:migrate   # corre Prisma migrate
npm run db:seed      # inserta usuarios y datos demo
```

### 5. Levantar el proyecto

```bash
npm run dev
```

- Backend: http://localhost:3001
- Frontend: http://localhost:5173

### Cuentas demo (creadas por el seed)

| Usuario     | Contraseña   | Rol            |
|-------------|--------------|----------------|
| `admin`     | `admin123`   | Administrador  |
| `mesero1`   | `waiter123`  | Mesero         |
| `personal1` | `staff123`   | Personal       |

> ⚠️ Cambiar antes de pasar a producción.

## Scripts útiles

| Script                  | Hace                                          |
|-------------------------|-----------------------------------------------|
| `npm run dev`           | Levanta backend + frontend en paralelo        |
| `npm run dev:backend`   | Solo backend                                  |
| `npm run dev:frontend`  | Solo frontend                                 |
| `npm run build`         | Build de producción de ambos                  |
| `npm run db:migrate`    | Aplica migraciones de Prisma                  |
| `npm run db:seed`       | Re-poblar con datos demo                      |
| `npm run db:studio`     | Abre Prisma Studio (GUI para inspeccionar DB) |

## Estado del proyecto

**Fase 1 ✅** — Setup monorepo + Prisma + Auth (JWT/bcrypt) + Socket.io configurado + LoginPage funcional

**Fase 2 ✅** — Mapa de mesas + CRUD + estados en tiempo real

**Fase 3 ✅** — Catálogo de menú + toma de pedidos móvil
- Endpoints: `/api/menu` (CRUD + toggle + stock) y `/api/orders` (crear, listar por mesa, total)
- Apertura automática de mesa cuando un mesero crea el primer pedido
- Snapshot de precios al momento del pedido (si el menú cambia, el pedido mantiene su precio)
- Vista móvil del mesero (auto-detectada por rol WAITER): selector de mesa → contador de comensales → catálogo con +/− → enviar
- Vista admin del menú: CRUD completo, toggle de visibilidad, cambio rápido de stock

**Fase 4 ✅** — Ventas y caja
- Endpoint `POST /api/sales`: en una transacción crea la venta, borra los pedidos y libera la mesa
- Upload de comprobante en base64 (se guarda en `apps/backend/uploads/sales/`)
- Stats del día: total, conteo, breakdown por método de pago
- Modal de cobro con desglose de items, método de pago, monto cobrado (con vuelto), notas y comprobante
- Historial de ventas con filtros y preview de comprobantes

**Fase 5 ✅** — Inventario + personal
- Inventario: CRUD, búsqueda, filtros por categoría (Alimentos, Bebidas, Insumos, Equipo), indicador de stock bajo automático (cuando `quantity < minStock`), acción rápida "Reabastecer" que suma cantidad y actualiza `lastRestocked`
- Personal: CRUD, vista de tarjetas con avatar de iniciales, filtros por rol (Mesero, Cocinero, Encargado, Cajero), toggle activo/inactivo, validación de email único
- Eventos Socket.io para ambos módulos (sincronización en vivo entre clientes)
- Permisos: inventario abierto a ADMIN/STAFF (CRUD solo ADMIN); personal solo para ADMIN

**Fase 6 ✅** — Reservas + Reportes + Notificaciones
- **Reservas**: entidad `Reservation` con cliente, fecha/hora, tamaño de grupo, mesa asignada opcional y estado (PENDING / CONFIRMED / SEATED / COMPLETED / CANCELLED / NO_SHOW). Selector de día con navegación, lista cronológica con alertas para las próximas 30 min. Acciones contextuales: marcar mesa como reservada, sentar comensales (ocupa la mesa automáticamente con `partySize`), cancelar, no-show.
- **Reportes**: tabla nueva `SaleItem` con snapshot inmutable de items por venta. Página de reportes con rango de fechas, KPIs (total facturado, cobrado, ticket promedio, días con ventas), breakdown por método de pago, gráfico de barras por día (SVG nativo sin dependencias), top 10 ítems más vendidos y exportación a CSV con BOM UTF-8 para Excel.
- **Notificaciones**: sonidos sintéticos generados con Web Audio API (sin archivos), toast persistente y browser notifications con permiso opcional. Se disparan en `order:created`, `table:changed → BILL_REQUESTED` (solo la transición, no en cada update) y `reservation:created`. Toggle global persistente en localStorage con icono en el topbar.
