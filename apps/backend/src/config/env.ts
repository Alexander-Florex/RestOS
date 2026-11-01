// ──────────────────────────────────────────────
// env.ts — Validación de variables de entorno
// Falla rápido si falta algo crítico.
// ──────────────────────────────────────────────
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es requerida'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  // Vida corta: la app renueva el token sola (POST /api/auth/refresh) mientras está abierta
  JWT_EXPIRES_IN: z.string().default('12h'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(8).max(15).default(10),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  // Solo si hay un proxy/túnel adelante (ej. Cloudflare Tunnel): sin esto, el
  // límite de login por IP vería a todos con la IP del proxy. Ej.: "loopback" o "1".
  TRUST_PROXY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variables de entorno inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

// Lista de orígenes permitidos para CORS (acepta coma-separados)
export const corsOrigins = env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);
