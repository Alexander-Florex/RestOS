// ──────────────────────────────────────────────
// import-planillas.ts — Importa las planillas del cliente (tarea 2.9)
//
//   npm run import:planillas -- --restaurant 2                 (prueba: no escribe nada)
//   npm run import:planillas -- --restaurant 2 --apply         (importa)
//
// Opciones:
//   --costos <archivo>    Planillas de costos (por defecto ../report-mejoras/Planillas costos platos.xlsx)
//   --stock <archivo>     Planilla de stock    (por defecto ../report-mejoras/Planilla stock.xlsx)
//   --restaurant <id>     Restaurante destino (obligatorio con --apply)
//   --apply               Escribe en la base. Sin esto solo arma el informe.
//   --update              Con --apply: actualiza precio de insumos y líneas de recetas que ya existen
//   --out <carpeta>       Dónde dejar el informe (por defecto, la carpeta de las planillas)
//   --confirm-production  Necesario si NODE_ENV=production
//
// Solo se corre a mano (nunca desde un endpoint). Volver a correrlo no duplica nada.
// ──────────────────────────────────────────────
import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readWorkbooks } from '../src/lib/planillas/parse.js';
import { buildPlan } from '../src/lib/planillas/plan.js';
import { writeReport } from '../src/lib/planillas/report.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function dbLabel(url: string | undefined): string {
  if (!url) return '(sin DATABASE_URL)';
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || 3306}/${u.pathname.replace(/^\//, '')}`;
  } catch {
    return '(DATABASE_URL inválida)';
  }
}

async function main() {
  const defaultDir = path.resolve(process.cwd(), '../report-mejoras');
  const costos = path.resolve(arg('costos') ?? path.join(defaultDir, 'Planillas costos platos.xlsx'));
  const stock = path.resolve(arg('stock') ?? path.join(defaultDir, 'Planilla stock.xlsx'));
  const out = path.resolve(arg('out') ?? path.dirname(costos));
  const apply = flag('apply');
  const restaurantId = arg('restaurant') ? Number(arg('restaurant')) : null;

  for (const f of [costos, stock]) {
    if (!existsSync(f)) throw new Error(`No encuentro el archivo: ${f}`);
  }
  if (apply && !(restaurantId && Number.isInteger(restaurantId) && restaurantId > 0)) {
    throw new Error('Con --apply hay que indicar el restaurante: --restaurant <id>');
  }
  if (apply && process.env.NODE_ENV === 'production' && !flag('confirm-production')) {
    throw new Error('NODE_ENV=production: hacé un respaldo y volvé a correrlo con --confirm-production');
  }

  console.log(`📄 Costos: ${costos}`);
  console.log(`📄 Stock:  ${stock}`);
  const raw = await readWorkbooks(costos, stock);
  const plan = buildPlan(raw);
  const n = (s: string) => plan.issues.filter(i => i.severity === s).length;
  console.log(`🔎 ${plan.items.length} insumos · ${plan.recipes.length} recetas · ${plan.stock.length} ítems de stock`);
  console.log(`   ${n('error')} errores · ${n('warn')} para revisar · ${n('info')} avisos`);

  if (!apply) {
    await writeReport(out, plan, { mode: 'dry-run', files: [costos, stock] });
    console.log(`\n🧪 Prueba (--dry-run): no se escribió nada en la base.`);
    console.log(`📝 Informe: ${path.join(out, 'import-report.md')}`);
    console.log('   Para importar: agregá --restaurant <id> --apply');
    return;
  }

  console.log(`\n💾 Importando en ${dbLabel(process.env.DATABASE_URL)} · restaurante #${restaurantId}${flag('update') ? ' · con --update' : ''}`);
  // Los servicios avisan por socket a las pantallas abiertas; acá no hay ninguna
  const { initSocket } = await import('../src/sockets/index.js');
  const server = http.createServer();
  initSocket(server);
  const { applyPlan } = await import('../src/lib/planillas/apply.js');
  const { prisma } = await import('../src/lib/prisma.js');
  try {
    const result = await applyPlan(plan, restaurantId!, { update: flag('update') });
    await writeReport(out, plan, { mode: 'apply', files: [costos, stock], result });
    console.log(`✅ Insumos: ${result.itemsCreated} nuevos, ${result.itemsExisting} ya existían · Recetas: ${result.recipesCreated} nuevas, ${result.recipesExisting} ya existían, ${result.recipesUpdated} actualizadas, ${result.recipesFailed.length} con error`);
    for (const f of result.recipesFailed) console.log(`   ❌ ${f.name}: ${f.error}`);
    console.log(`📝 Informe: ${path.join(out, 'import-report.md')}`);
  } finally {
    await prisma.$disconnect();
    server.close();
  }
}

main().catch((err) => {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
