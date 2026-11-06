// ──────────────────────────────────────────────
// Seed — Datos iniciales de demo (SOLO DESARROLLO)
// Corre: npm run db:seed            (base vacía)
//        npm run db:seed -- --force (pisa una base de desarrollo con datos)
// En producción no corre nunca: para el alta del cliente usar
// prisma/reset-restaurant.ts.
// ──────────────────────────────────────────────
import 'dotenv/config';
import { PrismaClient, UserRole, TableStatus, StockStatus, InventoryCategory, StaffRole, ReservationStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { checkSeedAllowed } from './seed-guard.js';
import { SYSTEM_ROLES, type SystemRoleKey } from '../src/lib/permissions.js';
import { createDefaultStorageAreas } from '../src/lib/default-storage-areas.js';

const prisma = new PrismaClient();
const ROUNDS = Number(process.env.BCRYPT_ROUNDS || 10);

async function main() {
  const guard = checkSeedAllowed({
    nodeEnv: process.env.NODE_ENV,
    restaurantCount: await prisma.restaurant.count(),
    force: process.argv.includes('--force'),
  });
  if (!guard.ok) {
    console.error(`⛔ Seed cancelado. ${guard.reason}`);
    process.exitCode = 1;
    return;
  }

  console.log('🌱  Iniciando seed...\n');

  // ── Limpieza (orden importa por foreign keys) ──
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.saleItem.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.table.deleteMany();
  await prisma.section.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.staffMember.deleteMany();
  await prisma.user.deleteMany();
  await prisma.restaurant.deleteMany();
  console.log('🧹 Tablas limpiadas.\n');

  // ── RESTAURANTE (tenant demo) ──
  // id fijo: sin esto el autoincremento sigue después de cada seed (2, 3, ...)
  // y el login demo con "ID de restaurante 1" deja de funcionar.
  const restaurant = await prisma.restaurant.create({
    data: {
      id: 1,
      name: 'RestOS Demo',
      email: 'contacto@restosdemo.com',
      phone: '+54 11 5555-0000',
      address: 'Av. Siempre Viva 123, Buenos Aires',
    },
  });
  const restaurantId = restaurant.id;
  console.log(`🏠 Restaurante creado: ${restaurant.name} (id=${restaurantId})`);

  // ── ROLES DE SISTEMA (Administrador, Mesero, Cajero) ──
  const roleIds = {} as Record<SystemRoleKey, number>;
  for (const key of Object.keys(SYSTEM_ROLES) as SystemRoleKey[]) {
    const def = SYSTEM_ROLES[key];
    const role = await prisma.role.create({ data: { restaurantId, key, name: def.name, permissions: [...def.permissions] } });
    roleIds[key] = role.id;
  }

  // ── USUARIOS (los que loguean al sistema) ──
  const users = [
    { username: 'admin',     email: 'admin@resto.com', name: 'Administrador',   role: UserRole.ADMIN,  roleKey: 'ADMIN' as const,   plain: 'admin123'  },
    { username: 'mesero1',   email: 'maria@resto.com', name: 'María Rodríguez', role: UserRole.WAITER, roleKey: 'WAITER' as const,  plain: 'waiter123' },
    { username: 'personal1', email: 'juan@resto.com',  name: 'Juan García',     role: UserRole.STAFF,  roleKey: 'CASHIER' as const, plain: 'staff123'  },
  ];

  for (const u of users) {
    const password = await bcrypt.hash(u.plain, ROUNDS);
    await prisma.user.create({
      data: {
        restaurantId,
        username: u.username,
        email: u.email,
        name: u.name,
        role: u.role,
        roleId: roleIds[u.roleKey],
        password,
      },
    });
  }
  console.log(`👤 ${users.length} usuarios creados (passwords hasheadas con bcrypt).`);
  console.log(`   restaurantId = ${restaurantId} (usar este valor para hacer login)`);
  users.forEach(u => console.log(`   - ${u.username.padEnd(10)} / ${u.plain.padEnd(10)} (${SYSTEM_ROLES[u.roleKey].name})`));
  console.log('');

  // ── SECCIONES ──
  const salonSection = await prisma.section.create({
    data: { restaurantId, name: 'Salón principal', color: '#10b981', order: 0 },
  });
  const patioSection = await prisma.section.create({
    data: { restaurantId, name: 'Patio', color: '#3b82f6', order: 1 },
  });
  const barSection = await prisma.section.create({
    data: { restaurantId, name: 'Bar', color: '#a855f7', order: 2 },
  });
  console.log('🗂️  3 secciones creadas (Salón principal, Patio, Bar).');

  // ── MESAS — distribuidas por sección con capacidades variadas ──
  const tableData = [
    // Salón principal
    { number: 1,  capacity: 2,  sectionId: salonSection.id },
    { number: 2,  capacity: 2,  sectionId: salonSection.id },
    { number: 3,  capacity: 4,  sectionId: salonSection.id },
    { number: 4,  capacity: 4,  sectionId: salonSection.id },
    { number: 5,  capacity: 4,  sectionId: salonSection.id },
    { number: 6,  capacity: 6,  sectionId: salonSection.id },
    { number: 7,  capacity: 8,  sectionId: salonSection.id },
    // Patio
    { number: 8,  capacity: 4,  sectionId: patioSection.id },
    { number: 9,  capacity: 4,  sectionId: patioSection.id },
    { number: 10, capacity: 6,  sectionId: patioSection.id },
    { number: 11, capacity: 10, sectionId: patioSection.id },
    // Bar
    { number: 12, capacity: 2,  sectionId: barSection.id },
    { number: 13, capacity: 2,  sectionId: barSection.id },
    { number: 14, capacity: 2,  sectionId: barSection.id },
  ];
  await prisma.table.createMany({
    data: tableData.map(t => ({ ...t, restaurantId, status: TableStatus.AVAILABLE, enabled: true })),
  });
  console.log(`🪑 ${tableData.length} mesas creadas en 3 secciones.`);

  // ── MENÚ ──
  const menuData = [
    { name: 'Pizza Margherita',    category: 'Principales', price: 18500, description: 'Mozzarella fresca y albahaca',       stock: StockStatus.IN_STOCK,     enabled: true  },
    { name: 'Pasta Carbonara',     category: 'Principales', price: 17000, description: 'Pasta cremosa con panceta',          stock: StockStatus.IN_STOCK,     enabled: true  },
    { name: 'Salmón a la Plancha', category: 'Principales', price: 25000, description: 'Salmón atlántico con hierbas',       stock: StockStatus.LOW_STOCK,    enabled: true  },
    { name: 'Bife Término Medio',  category: 'Principales', price: 33000, description: 'Corte premium de res',               stock: StockStatus.IN_STOCK,     enabled: true  },
    { name: 'Tacos de Pollo',      category: 'Principales', price: 12000, description: 'Tacos estilo mexicano',              stock: StockStatus.OUT_OF_STOCK, enabled: false },
    { name: 'Vino de la Casa',     category: 'Bebidas',     price:  8500, description: 'Tinto o blanco',                     stock: StockStatus.IN_STOCK,     enabled: true  },
    { name: 'Agua con Gas',        category: 'Bebidas',     price:  4000, description: 'San Pellegrino',                     stock: StockStatus.IN_STOCK,     enabled: true  },
    { name: 'Té Frío',             category: 'Bebidas',     price:  3500, description: 'Recién preparado',                   stock: StockStatus.IN_STOCK,     enabled: true  },
    { name: 'Cerveza Artesanal',   category: 'Bebidas',     price:  7000, description: 'Selección de microcervecería local', stock: StockStatus.LOW_STOCK,    enabled: true  },
    { name: 'Ensalada César',      category: 'Entradas',    price: 13000, description: 'Lechuga romana con parmesano',       stock: StockStatus.IN_STOCK,     enabled: true  },
    { name: 'Papas Fritas',        category: 'Entradas',    price:  6000, description: 'Papas doradas crujientes',           stock: StockStatus.IN_STOCK,     enabled: true  },
    { name: 'Verduras Salteadas',  category: 'Entradas',    price: 14500, description: 'Verduras de estación',               stock: StockStatus.IN_STOCK,     enabled: true  },
    { name: 'Tiramisú',            category: 'Postres',     price:  8000, description: 'Clásico postre italiano',            stock: StockStatus.IN_STOCK,     enabled: true  },
    { name: 'Torta de Chocolate',  category: 'Postres',     price:  8500, description: 'Capas de chocolate intenso',         stock: StockStatus.LOW_STOCK,    enabled: true  },
    { name: 'Sorbete de Frutas',   category: 'Postres',     price:  7000, description: 'Sorbete refrescante de fruta',       stock: StockStatus.IN_STOCK,     enabled: true  },
  ];
  // Las categorías existen como entidad: sin esto el filtro de la carta queda vacío
  const menuCategories = [
    { name: 'Entradas',    color: '#f59e0b' },
    { name: 'Principales', color: '#f97316' },
    { name: 'Postres',     color: '#ec4899' },
    { name: 'Bebidas',     color: '#0ea5e9' },
  ];
  await prisma.menuCategory.createMany({ data: menuCategories.map((c, order) => ({ ...c, order, restaurantId })) });
  await prisma.menuItem.createMany({ data: menuData.map(m => ({ ...m, restaurantId })) });
  console.log(`🍽️  ${menuData.length} platos creados.`);

  // ── INVENTARIO ──
  const inventoryData = [
    { name: 'Tomates',         category: InventoryCategory.FOOD,     quantity: 45,  unit: 'kg',      minStock: 20,  supplier: 'Granja Fresca' },
    { name: 'Mozzarella',      category: InventoryCategory.FOOD,     quantity: 12,  unit: 'kg',      minStock: 15,  supplier: 'Lácteos Directos' },
    { name: 'Aceite de Oliva', category: InventoryCategory.FOOD,     quantity: 28,  unit: 'L',       minStock: 10,  supplier: 'Importaciones del Mediterráneo' },
    { name: 'Vino Tinto',      category: InventoryCategory.BEVERAGE, quantity: 24,  unit: 'botella', minStock: 12,  supplier: 'Distribuidora de Vinos' },
    { name: 'Agua con Gas',    category: InventoryCategory.BEVERAGE, quantity: 8,   unit: 'caja',    minStock: 10,  supplier: 'Bebidas y Más' },
    { name: 'Servilletas',     category: InventoryCategory.SUPPLIES, quantity: 150, unit: 'pcs',     minStock: 100, supplier: 'Suministros Resto' },
  ];
  await prisma.inventoryItem.createMany({
    data: inventoryData.map(i => ({ ...i, restaurantId, lastRestocked: new Date() })),
  });
  // El stock es la suma de movimientos (tarea 3.2): el saldo de arranque entra como uno
  const seededItems = await prisma.inventoryItem.findMany({ where: { restaurantId } });
  await prisma.stockMovement.createMany({
    data: seededItems.map(i => ({
      restaurantId, inventoryItemId: i.id, type: 'ADJUSTMENT' as const,
      quantity: i.quantity, balanceAfter: i.quantity, unitCost: i.costPerUnit, reason: 'Saldo inicial',
    })),
  });
  await createDefaultStorageAreas(prisma, restaurantId);
  console.log(`📦 ${inventoryData.length} ítems de inventario creados (y los sectores de guardado).`);

  // ── STAFF ──
  const staffData = [
    { name: 'María Rodríguez', email: 'maria@resto.com',  role: StaffRole.WAITER,  phone: '+54 11 5555-0101', active: true,  cuit: '27-31234567-8' },
    { name: 'Juan García',     email: 'juan@resto.com',   role: StaffRole.CHEF,    phone: '+54 11 5555-0102', active: true,  cuit: '20-25678901-3' },
    { name: 'Sara Johnson',    email: 'sara@resto.com',   role: StaffRole.MANAGER, phone: '+54 11 5555-0103', active: true,  cuit: null },
    { name: 'Marcos Davis',    email: 'marcos@resto.com', role: StaffRole.WAITER,  phone: '+54 11 5555-0104', active: true,  cuit: '20-30123456-7' },
    { name: 'Emily Brown',     email: 'emily@resto.com',  role: StaffRole.CASHIER, phone: '+54 11 5555-0105', active: false, cuit: null },
  ];
  await prisma.staffMember.createMany({ data: staffData.map(s => ({ ...s, restaurantId })) });
  console.log(`👥 ${staffData.length} miembros de staff creados.`);

  // ── RESERVAS ── (próximas, para ver algo al entrar)
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  // Helper para construir una fecha hoy/mañana a una hora dada
  const at = (dayOffset: number, hour: number, minute = 0) => {
    const d = new Date(today);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute, 0, 0);
    return d;
  };

  const reservationsData: Array<{ customerName: string; customerPhone: string | null; partySize: number; reservedAt: Date; tableId: number | null; duration: number; notes?: string; status: ReservationStatus }> = [
    { customerName: 'Familia Pérez',  customerPhone: '+54 11 4444-1001', partySize: 4, reservedAt: at(0, 20, 30), tableId: 3,    duration: 120, notes: 'Cumpleaños',         status: ReservationStatus.CONFIRMED },
    { customerName: 'Luis Méndez',    customerPhone: '+54 11 4444-1002', partySize: 2, reservedAt: at(0, 21, 0),  tableId: 5,    duration: 90,                                status: ReservationStatus.CONFIRMED },
    { customerName: 'Carla Ferreira', customerPhone: '+54 11 4444-1003', partySize: 6, reservedAt: at(1, 13, 0),  tableId: null, duration: 120, notes: 'Almuerzo de trabajo', status: ReservationStatus.CONFIRMED },
    { customerName: 'Pedro Suárez',   customerPhone: null,               partySize: 2, reservedAt: at(1, 20, 0),  tableId: null, duration: 90,                                status: ReservationStatus.PENDING },
  ];
  // Resolver tableId por número de mesa
  for (const r of reservationsData) {
    if (r.tableId !== null) {
      const t = await prisma.table.findUnique({ where: { restaurantId_number: { restaurantId, number: r.tableId } } });
      r.tableId = t?.id ?? null;
    }
  }
  await prisma.reservation.createMany({ data: reservationsData.map(r => ({ ...r, restaurantId })) });
  console.log(`📅 ${reservationsData.length} reservas creadas (hoy y mañana).\n`);

  console.log('✅ Seed completo.\n');
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
