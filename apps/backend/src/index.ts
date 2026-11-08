// ──────────────────────────────────────────────
// index.ts — Entry point del backend
// ──────────────────────────────────────────────
import { createServer } from 'http';
import { buildApp } from './server.js';
import { initSocket } from './sockets/index.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { logger, LOG_DIR, accessLogStream } from './lib/logger.js';

// Errores que se escaparon de todo manejo: quedan en el log.
// Una promesa rechazada sin catch se registra y el servidor sigue; una excepción
// no capturada deja el proceso en estado dudoso, así que se registra y se sale
// (el servicio del sistema lo reinicia, ver tarea 6.1).
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', { error: reason });
});
process.on('uncaughtException', (err) => {
  logger.error('uncaught_exception', { error: err });
  process.exit(1);
});

async function bootstrap() {
  const app = buildApp();
  const httpServer = createServer(app);

  // Socket.io comparte el server HTTP
  initSocket(httpServer);

  httpServer.listen(env.PORT, () => {
    logger.info('server_started', {
      port: env.PORT,
      env: env.NODE_ENV,
      logDir: accessLogStream ? LOG_DIR : null,
    });
    if (env.NODE_ENV !== 'production') {
      console.log('');
      console.log('  🍽️  RestOS Backend');
      console.log('  ─────────────────────────────────────');
      console.log(`  • API:        http://localhost:${env.PORT}/api`);
      console.log(`  • Socket.io:  ws://localhost:${env.PORT}/socket.io`);
      console.log(`  • Health:     http://localhost:${env.PORT}/api/health`);
      console.log(`  • Entorno:    ${env.NODE_ENV}`);
      console.log('');
    }
  });

  // Puertos viejos: redirigen al actual con la misma ruta (si el puerto está ocupado, se avisa y sigue)
  for (const p of (env.REDIRECT_PORTS ?? '').split(',').map(s => Number(s.trim())).filter(n => n > 0 && n !== env.PORT)) {
    const redirect = createServer((req, res) => {
      const host = (req.headers.host ?? 'localhost').replace(/:\d+$/, '');
      const port = env.PORT === 80 ? '' : `:${env.PORT}`;
      res.writeHead(301, { Location: `http://${host}${port}${req.url ?? '/'}` });
      res.end();
    });
    redirect.on('error', (err) => logger.warn('redirect_port_failed', { port: p, error: err }));
    redirect.listen(p, () => logger.info('redirect_port', { from: p, to: env.PORT }));
  }

  // ── Graceful shutdown ──
  const shutdown = async (signal: string) => {
    logger.info('server_stopping', { signal });
    httpServer.close();
    await prisma.$disconnect();
    logger.info('server_stopped', { signal });
    process.exit(0);
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.error('startup_failed', { error: err });
  process.exit(1);
});
