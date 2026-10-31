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
import { menuCategoriesRouter } from './modules/menu-categories/menu-categories.routes.js';
import { recipesRouter } from './modules/recipes/recipes.routes.js';
import { ordersRouter } from './modules/orders/orders.routes.js';
import { salesRouter } from './modules/sales/sales.routes.js';
import { inventoryRouter } from './modules/inventory/inventory.routes.js';
import { staffRouter } from './modules/staff/staff.routes.js';
import { reservationsRouter } from './modules/reservations/reservations.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { sectionsRouter } from './modules/sections/sections.routes.js';
import { printingRouter } from './modules/printing/printing.routes.js';
import { takeawayRouter } from './modules/takeaway/takeaway.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { rolesRouter } from './modules/roles/roles.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { prisma } from './lib/prisma.js';

export function buildApp(): Express {
  const app = express();
  if (env.TRUST_PROXY) {
    const v = env.TRUST_PROXY;
    app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v === 'true' ? true : v);
  }

  // ── Seguridad y parsing ──
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: corsOrigins, credentials: true }));
  // 1 MB en general; solo registrar una venta acepta más (comprobante en base64)
  const smallJson = express.json({ limit: '1mb' });
  const saleJson = express.json({ limit: '20mb' });
  app.use((req, res, next) => {
    const isSaleCreate = req.method === 'POST' && req.path === '/api/sales';
    return (isSaleCreate ? saleJson : smallJson)(req, res, next);
  });
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

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

  // Los comprobantes de venta (carpeta uploads/) NO se sirven en público:
  // se piden por GET /api/sales/:id/receipt, con login y del mismo restaurante.

  // ── Rutas de la API ──
  app.use('/api/auth',         authRouter);
  app.use('/api/tables',       tablesRouter);
  app.use('/api/menu',         menuRouter);
  app.use('/api/menu-categories', menuCategoriesRouter);
  app.use('/api/recipes',      recipesRouter);
  app.use('/api/orders',       ordersRouter);
  app.use('/api/sales',        salesRouter);
  app.use('/api/inventory',    inventoryRouter);
  app.use('/api/staff',        staffRouter);
  app.use('/api/reservations', reservationsRouter);
  app.use('/api/reports',      reportsRouter);
  app.use('/api/sections',     sectionsRouter);
  app.use('/api/printing',     printingRouter);
  app.use('/api/takeaway',     takeawayRouter);
  app.use('/api/users',        usersRouter);
  app.use('/api/roles',        rolesRouter);

  // ── 404 y manejo de errores (siempre al final) ──
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
