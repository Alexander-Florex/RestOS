// ──────────────────────────────────────────────
// server.ts — Construye la app Express
// Separa la creación del listen() para facilitar testing.
// ──────────────────────────────────────────────
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env, corsOrigins } from './config/env.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { tablesRouter } from './modules/tables/tables.routes.js';
import { menuRouter } from './modules/menu/menu.routes.js';
import { ordersRouter } from './modules/orders/orders.routes.js';
import { salesRouter } from './modules/sales/sales.routes.js';
import { inventoryRouter } from './modules/inventory/inventory.routes.js';
import { staffRouter } from './modules/staff/staff.routes.js';
import { reservationsRouter } from './modules/reservations/reservations.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { sectionsRouter } from './modules/sections/sections.routes.js';
import { printingRouter } from './modules/printing/printing.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { prisma } from './lib/prisma.js';
import path from 'node:path';

export function buildApp(): Express {
  const app = express();

  // ── Seguridad y parsing ──
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(express.json({ limit: '20mb' })); // 20mb para comprobantes de venta en base64
  app.use(express.urlencoded({ extended: true }));

  // ── Logger HTTP (solo en dev) ──
  if (env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
  }

  // ── Health check ──
  app.get('/api/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({
        status: 'ok',
        env: env.NODE_ENV,
        db: 'connected',
        timestamp: new Date().toISOString(),
      });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'disconnected' });
    }
  });

  // ── Archivos estáticos (comprobantes de venta) ──
  app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

  // ── Rutas de la API ──
  app.use('/api/auth',         authRouter);
  app.use('/api/tables',       tablesRouter);
  app.use('/api/menu',         menuRouter);
  app.use('/api/orders',       ordersRouter);
  app.use('/api/sales',        salesRouter);
  app.use('/api/inventory',    inventoryRouter);
  app.use('/api/staff',        staffRouter);
  app.use('/api/reservations', reservationsRouter);
  app.use('/api/reports',      reportsRouter);
  app.use('/api/sections',     sectionsRouter);
  app.use('/api/printing',     printingRouter);

  // ── 404 y manejo de errores (siempre al final) ──
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
