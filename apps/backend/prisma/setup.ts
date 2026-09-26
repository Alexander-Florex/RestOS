// ──────────────────────────────────────────────
// setup.ts — npm run db:setup
//
// Producción (NODE_ENV=production): solo aplica migraciones con
// `prisma migrate deploy`. No corre el seed ni crea datos demo.
// Desarrollo: `prisma migrate dev` + seed de demo (el seed se
// cancela solo si la base ya tiene restaurantes).
// ──────────────────────────────────────────────
import 'dotenv/config';
import { execSync } from 'node:child_process';

function run(cmd: string) {
  console.log(`▶ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

if (process.env.NODE_ENV === 'production') {
  run('npx prisma migrate deploy');
  console.log('\n✅ Migraciones aplicadas. Para dar de alta el restaurante usá:');
  console.log('   npx tsx prisma/reset-restaurant.ts --name "..." --admin-user ... --admin-pass "..."');
} else {
  run('npx prisma migrate dev');
  run('npx tsx prisma/seed.ts');
}
