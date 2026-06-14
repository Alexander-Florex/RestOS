// ──────────────────────────────────────────────
// reset-restaurant.ts — Crea o vacía un restaurante (tenant) y le
// deja un único usuario ADMIN para que el cliente arranque desde cero.
//
// Como `Restaurant` tiene onDelete: Cascade en todas sus relaciones,
// borrar el restaurante borra en cascada TODO lo asociado (menú,
// secciones, mesas, pedidos, ventas, takeaway, reservas, staff, users).
// Después se vuelve a crear el restaurante (mismo id si se pasa) y un
// usuario admin nuevo.
//
// Uso:
//   npx tsx prisma/reset-restaurant.ts \
//     --id 1 \
//     --name "Local Don Mario" \
//     --admin-user admin \
//     --admin-pass "unaPasswordSegura" \
//     --admin-name "Mario"
//
// Si --id corresponde a un restaurante que ya existe, se borra todo
// su contenido (cascade) y se recrea limpio con ese mismo id.
// Si --id no existe, simplemente se crea nuevo con ese id.
// Si no se pasa --id, se crea uno nuevo con id autogenerado.
// ──────────────────────────────────────────────
import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const ROUNDS = Number(process.env.BCRYPT_ROUNDS || 10);

function arg(name: string, required = true): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  const val = idx >= 0 ? process.argv[idx + 1] : undefined;
  if (required && !val) {
    console.error(`❌ Falta el argumento --${name}`);
    process.exit(1);
  }
  return val;
}

async function main() {
  const idArg = arg('id', false);
  const name = arg('name')!;
  const adminUser = arg('admin-user')!;
  const adminPass = arg('admin-pass')!;
  const adminName = arg('admin-name', false) ?? 'Administrador';
  const email = arg('email', false);
  const phone = arg('phone', false);
  const address = arg('address', false);

  const id = idArg ? Number(idArg) : undefined;

  if (id) {
    const existing = await prisma.restaurant.findUnique({ where: { id } });
    if (existing) {
      console.log(`🗑️  Borrando restaurante #${id} ("${existing.name}") y todo su contenido (cascade)...`);
      await prisma.restaurant.delete({ where: { id } });
    }
  }

  const restaurant = await prisma.restaurant.create({
    data: { ...(id ? { id } : {}), name, email, phone, address },
  });
  console.log(`🏠  Restaurante creado: #${restaurant.id} — "${restaurant.name}"`);

  const password = await bcrypt.hash(adminPass, ROUNDS);
  const admin = await prisma.user.create({
    data: {
      restaurantId: restaurant.id,
      username: adminUser,
      email: `${adminUser}@${restaurant.id}.restos.local`,
      password,
      name: adminName,
      role: UserRole.ADMIN,
    },
  });

  console.log('\n✅ Listo. Datos para el primer login:');
  console.log(`   ID de restaurante : ${restaurant.id}`);
  console.log(`   Usuario           : ${admin.username}`);
  console.log(`   Contraseña        : ${adminPass}`);
  console.log('\nDesde el panel, el admin puede crear el menú, secciones/mesas, etc.');
  console.log('Para agregar más usuarios (meseros, personal, otros admins) usá add-user.ts.');
}

main()
  .catch(e => { console.error('❌ Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());