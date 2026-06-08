// ──────────────────────────────────────────────
// index.ts — Entry point del backend
// ──────────────────────────────────────────────
import { createServer } from 'http';
import { buildApp } from './server.js';
import { initSocket } from './sockets/index.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';

async function bootstrap() {
  const app = buildApp();
  const httpServer = createServer(app);

  // Socket.io comparte el server HTTP
  initSocket(httpServer);

  httpServer.listen(env.PORT, () => {
    console.log('');
    console.log('  🍽️  RestOS Backend');
    console.log('  ─────────────────────────────────────');
    console.log(`  • API:        http://localhost:${env.PORT}/api`);
    console.log(`  • Socket.io:  ws://localhost:${env.PORT}/socket.io`);
    console.log(`  • Health:     http://localhost:${env.PORT}/api/health`);
    console.log(`  • Entorno:    ${env.NODE_ENV}`);
    console.log('');
  });

  // ── Graceful shutdown ──
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} recibido, cerrando...`);
    httpServer.close(() => console.log('🔌 HTTP cerrado'));
    await prisma.$disconnect();
    console.log('🗄️  Prisma desconectado');
    process.exit(0);
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('💥 Error al iniciar:', err);
  process.exit(1);
});
