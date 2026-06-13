// ──────────────────────────────────────────────
// Seed — Datos iniciales de demo
// Corre: npm run db:seed
// ──────────────────────────────────────────────
import { PrismaClient, UserRole, TableStatus, StockStatus, InventoryCategory, StaffRole, ReservationStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const ROUNDS = Number(process.env.BCRYPT_ROUNDS || 10);

async function main() {
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
  const restaurant = await prisma.restaurant.create({
    data: {
      name: 'RestOS Demo',
      email: 'contacto@restosdemo.com',
      phone: '+54 11 5555-0000',
      address: 'Av. Siempre Viva 123, Buenos Aires',
    },
  });
  const restaurantId = restaurant.id;
  console.log(`🏠 Restaurante creado: ${restaurant.name} (id=${restaurantId})`);

  // ── USUARIOS (los que loguean al sistema) ──
  const users = [
    { username: 'admin',     email: 'admin@resto.com', name: 'Administrador',   role: UserRole.ADMIN,  plain: 'admin123'  },
    { username: 'mesero1',   email: 'maria@resto.com', name: 'María Rodríguez', role: UserRole.WAITER, plain: 'waiter123' },
    { username: 'personal1', email: 'juan@resto.com',  name: 'Juan García',     role: UserRole.STAFF,  plain: 'staff123'  },
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
        password,
      },
    });
  }
  console.log(`👤 ${users.length} usuarios creados (passwords hasheadas con bcrypt).`);
  console.log(`   restaurantId = ${restaurantId} (usar este valor para hacer login)`);
  users.forEach(u => console.log(`   - ${u.username.padEnd(10)} / ${u.plain.padEnd(10)} (${u.role})`));
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
    { name: 'Pizza Margherita',    category: 'main-dishes', price: 18.50, description: 'Mozzarella fresca y albahaca',       stock: StockStatus.IN_STOCK,     enabled: true  },
    { name: 'Pasta Carbonara',     category: 'main-dishes', price: 16.99, description: 'Pasta cremosa con panceta',          stock: StockStatus.IN_STOCK,     enabled: true  },
    { name: 'Salmón a la Plancha', category: 'main-dishes', price: 24.99, description: 'Salmón atlántico con hierbas',       stock: StockStatus.LOW_STOCK,    enabled: true  },
    { name: 'Bife Término Medio',  category: 'main-dishes', price: 32.99, description: 'Corte premium de res',               stock: StockStatus.IN_STOCK,     enabled: true  },
    { name: 'Tacos de Pollo',      category: 'main-dishes', price: 11.99, description: 'Tacos estilo mexicano',              stock: StockStatus.OUT_OF_STOCK, enabled: false },
    { name: 'Vino de la Casa',     category: 'drinks',      price:  8.50, description: 'Tinto o blanco',                     stock: StockStatus.IN_STOCK,     enabled: true  },
    { name: 'Agua con Gas',        category: 'drinks',      price:  3.99, description: 'San Pellegrino',                     stock: StockStatus.IN_STOCK,     enabled: true  },
    { name: 'Té Frío',             category: 'drinks',      price:  3.50, description: 'Recién preparado',                   stock: StockStatus.IN_STOCK,     enabled: true  },
    { name: 'Cerveza Artesanal',   category: 'drinks',      price:  6.99, description: 'Selección de microcervecería local', stock: StockStatus.LOW_STOCK,    enabled: true  },
    { name: 'Ensalada César',      category: 'appetizers',  price: 12.99, description: 'Lechuga romana con parmesano',       stock: StockStatus.IN_STOCK,     enabled: true  },
    { name: 'Papas Fritas',        category: 'appetizers',  price:  5.99, description: 'Papas doradas crujientes',           stock: StockStatus.IN_STOCK,     enabled: true  },
    { name: 'Verduras Salteadas',  category: 'appetizers',  price: 14.50, description: 'Verduras de estación',               stock: StockStatus.IN_STOCK,     enabled: true  },
    { name: 'Tiramisú',            category: 'desserts',    price:  7.99, description: 'Clásico postre italiano',            stock: StockStatus.IN_STOCK,     enabled: true  },
    { name: 'Torta de Chocolate',  category: 'desserts',    price:  8.50, description: 'Capas de chocolate intenso',         stock: StockStatus.LOW_STOCK,    enabled: true  },
    { name: 'Sorbete de Frutas',   category: 'desserts',    price:  6.99, description: 'Sorbete refrescante de fruta',       stock: StockStatus.IN_STOCK,     enabled: true  },
  ];
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
  console.log(`📦 ${inventoryData.length} ítems de inventario creados.`);

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

  const reservationsData = [
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
