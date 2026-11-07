// ──────────────────────────────────────────────
// server.ts — Construye la app Express
// Separa la creación del listen() para facilitar testing.
// ──────────────────────────────────────────────
import express, { type Express } from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
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
import { storageAreasRouter } from './modules/storage-areas/storage-areas.routes.js';
import { stockCountsRouter } from './modules/stock-counts/stock-counts.routes.js';
import { staffRouter } from './modules/staff/staff.routes.js';
import { reservationsRouter } from './modules/reservations/reservations.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { sectionsRouter } from './modules/sections/sections.routes.js';
import { printingRouter } from './modules/printing/printing.routes.js';
import { takeawayRouter } from './modules/takeaway/takeaway.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { rolesRouter } from './modules/roles/roles.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { systemRouter } from './modules/system/system.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { prisma } from './lib/prisma.js';
import { requestId } from './middleware/request-id.js';
import { accessLogStream, logger } from './lib/logger.js';

const HEALTH_DB_TIMEOUT_MS = 3000;

morgan.token('req-id', (req) => (req as express.Request).requestId ?? '-');
const ACCESS_LOG_FORMAT =
  ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ' +
  '":referrer" ":user-agent" :req-id :response-time ms';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout de ${ms} ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** Carpeta del build del frontend que sirve el backend, o null si no corresponde (tarea 6.1). */
export function frontendDist(): string | null {
  const dir = path.resolve(env.FRONTEND_DIST ?? path.join(process.cwd(), '..', 'frontend', 'dist'));
  const wanted = env.SERVE_FRONTEND ? env.SERVE_FRONTEND === 'true' : env.NODE_ENV === 'production';
  return wanted && existsSync(path.join(dir, 'index.html')) ? dir : null;
}

export function buildApp(): Express {
  const app = express();
  if (env.TRUST_PROXY) {
    const v = env.TRUST_PROXY;
    app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v === 'true' ? true : v);
  }

  // ── Código por pedido + log de acceso (primero, para registrar también los rechazados) ──
  app.use(requestId);
  if (accessLogStream) {
    // Producción: formato combined + código del pedido + duración, a archivo diario
    app.use(morgan(ACCESS_LOG_FORMAT, { stream: accessLogStream }));
  } else if (env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
  }

  // ── Seguridad y parsing ──
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        // En la red del local se entra por http://192.168.x.x (sin HTTPS hasta la tarea 6.2):
        // "upgrade-insecure-requests" haría que el navegador pida todo por https y no cargue nada
        upgradeInsecureRequests: null,
        // Comprobantes (blob:) e íconos en línea (data:)
        imgSrc: ["'self'", 'data:', 'blob:'],
        // API y socket.io (ws/wss del mismo origen)
        connectSrc: ["'self'", 'ws:', 'wss:'],
      },
    },
    // Solo tiene sentido con HTTPS; en http lo ignora el navegador pero ensucia la consola
    strictTransportSecurity: false,
  }));
  app.use(cors({ origin: corsOrigins, credentials: true }));
  // 1 MB en general; solo registrar una venta acepta más (comprobante en base64)
  const smallJson = express.json({ limit: '1mb' });
  const saleJson = express.json({ limit: '20mb' });
  app.use((req, res, next) => {
    const isSaleCreate = req.method === 'POST' && req.path === '/api/sales';
    return (isSaleCreate ? saleJson : smallJson)(req, res, next);
  });
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  // ── Health check (público, para monitoreo y para el agente de impresión) ──
  // 200 si la base responde; 503 si no responde o tarda más de HEALTH_DB_TIMEOUT_MS.
  app.get('/api/health', async (_req, res) => {
    const started = Date.now();
    try {
      await withTimeout(prisma.$queryRaw`SELECT 1`, HEALTH_DB_TIMEOUT_MS);
      res.json({
        status: 'ok',
        db: 'ok',
        dbLatencyMs: Date.now() - started,
        uptimeSec: Math.round(process.uptime()),
        time: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('health_db_failed', { error: err });
      res.status(503).json({ status: 'degraded', db: 'down', time: new Date().toISOString() });
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
  app.use('/api/storage-areas', storageAreasRouter);
  app.use('/api/stock-counts', stockCountsRouter);
  app.use('/api/staff',        staffRouter);
  app.use('/api/reservations', reservationsRouter);
  app.use('/api/reports',      reportsRouter);
  app.use('/api/sections',     sectionsRouter);
  app.use('/api/printing',     printingRouter);
  app.use('/api/takeaway',     takeawayRouter);
  app.use('/api/users',        usersRouter);
  app.use('/api/roles',        rolesRouter);
  app.use('/api/audit',        auditRouter);
  app.use('/api/system',       systemRouter);

  // ── Pantallas (build de Vite) servidas por el mismo servidor (tarea 6.1) ──
  const dist = frontendDist();
  if (dist) {
    // Los archivos con hash en el nombre no cambian nunca: caché larga. index.html, sin caché,
    // para que una actualización llegue a los celulares apenas recargan.
    app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '365d', index: false }));
    app.use(express.static(dist, { index: false, maxAge: 0 }));
    // Rutas de la app (React): todo GET que no sea de la API ni de socket.io devuelve index.html
    app.get(/^\/(?!api\/|api$|socket\.io\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
    logger.info('frontend_served', { dir: dist });
  }

  // ── 404 y manejo de errores (siempre al final) ──
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
