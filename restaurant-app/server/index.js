import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const app = express();
const httpServer = createServer(app);

// ──────────────────────────────────────────────
// WebSocket Server
// ──────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

function broadcast(type, data) {
  const message = JSON.stringify({ type, data, ts: Date.now() });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(message);
  });
}

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`📱 WS conectado desde ${ip}`);
  ws.send(JSON.stringify({ type: 'connected', data: { status: 'ok' } }));
  ws.on('close', () => console.log(`📴 WS desconectado ${ip}`));
  ws.on('error', console.error);
});

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '20mb' })); // para imágenes base64

// ──────────────────────────────────────────────
// appDB — Base de datos en memoria
// ──────────────────────────────────────────────
const appDB = {
  users: [
    { id: 1, username: 'admin',    password: 'admin123',   name: 'Administrador',    role: 'admin',   email: 'admin@resto.com'  },
    { id: 2, username: 'mesero1',  password: 'waiter123',  name: 'María Rodríguez',  role: 'waiter',  email: 'maria@resto.com'  },
    { id: 3, username: 'personal1',password: 'staff123',   name: 'Juan García',      role: 'staff',   email: 'juan@resto.com'   },
  ],

  tables: [
    { id: 1,  number: 1,  status: 'available',      guestCount: null, occupiedTime: null, orders: [] },
    { id: 2,  number: 2,  status: 'occupied',        guestCount: 4,    occupiedTime: 5055, orders: [
      { item: 'Ensalada César', quantity: 2, price: 12.99 },
      { item: 'Pizza Margherita', quantity: 1, price: 18.50 },
    ]},
    { id: 3,  number: 3,  status: 'available',      guestCount: null, occupiedTime: null, orders: [] },
    { id: 4,  number: 4,  status: 'occupied',        guestCount: 2,    occupiedTime: 2345, orders: [
      { item: 'Pasta Carbonara', quantity: 2, price: 16.99 },
      { item: 'Vino de la Casa', quantity: 2, price: 8.50 },
      { item: 'Tiramisú', quantity: 1, price: 7.99 },
    ]},
    { id: 5,  number: 5,  status: 'bill-requested', guestCount: 6,    occupiedTime: 7823, orders: [
      { item: 'Salmón a la Plancha', quantity: 3, price: 24.99 },
      { item: 'Verduras Salteadas', quantity: 2, price: 14.50 },
      { item: 'Agua con Gas', quantity: 4, price: 3.99 },
    ]},
    { id: 6,  number: 6,  status: 'available',      guestCount: null, occupiedTime: null, orders: [] },
    { id: 7,  number: 7,  status: 'occupied',        guestCount: 3,    occupiedTime: 3120, orders: [
      { item: 'Bife Término Medio', quantity: 2, price: 32.99 },
      { item: 'Papas Fritas', quantity: 2, price: 5.99 },
    ]},
    { id: 8,  number: 8,  status: 'available',      guestCount: null, occupiedTime: null, orders: [] },
    { id: 9,  number: 9,  status: 'available',      guestCount: null, occupiedTime: null, orders: [] },
    { id: 10, number: 10, status: 'occupied',        guestCount: 2,    occupiedTime: 1890, orders: [
      { item: 'Tacos de Pollo', quantity: 3, price: 11.99 },
      { item: 'Té Frío', quantity: 2, price: 3.50 },
    ]},
    { id: 11, number: 11, status: 'available',      guestCount: null, occupiedTime: null, orders: [] },
    { id: 12, number: 12, status: 'available',      guestCount: null, occupiedTime: null, orders: [] },
  ],

  menuItems: [
    { id: 1,  name: 'Pizza Margherita',      category: 'main-dishes', price: 18.50, description: 'Mozzarella fresca y albahaca',          stock: 'in-stock',  enabled: true },
    { id: 2,  name: 'Pasta Carbonara',       category: 'main-dishes', price: 16.99, description: 'Pasta cremosa con panceta',             stock: 'in-stock',  enabled: true },
    { id: 3,  name: 'Salmón a la Plancha',   category: 'main-dishes', price: 24.99, description: 'Salmón atlántico con hierbas',          stock: 'low-stock', enabled: true },
    { id: 4,  name: 'Bife Término Medio',    category: 'main-dishes', price: 32.99, description: 'Corte premium de res',                  stock: 'in-stock',  enabled: true },
    { id: 5,  name: 'Tacos de Pollo',        category: 'main-dishes', price: 11.99, description: 'Tacos estilo mexicano',                 stock: 'out-of-stock', enabled: false },
    { id: 6,  name: 'Vino de la Casa',       category: 'drinks',      price: 8.50,  description: 'Tinto o blanco',                        stock: 'in-stock',  enabled: true },
    { id: 7,  name: 'Agua con Gas',          category: 'drinks',      price: 3.99,  description: 'San Pellegrino',                        stock: 'in-stock',  enabled: true },
    { id: 8,  name: 'Té Frío',              category: 'drinks',      price: 3.50,  description: 'Recién preparado',                      stock: 'in-stock',  enabled: true },
    { id: 9,  name: 'Cerveza Artesanal',     category: 'drinks',      price: 6.99,  description: 'Selección de microcervecería local',    stock: 'low-stock', enabled: true },
    { id: 10, name: 'Ensalada César',        category: 'appetizers',  price: 12.99, description: 'Lechuga romana con parmesano',          stock: 'in-stock',  enabled: true },
    { id: 11, name: 'Papas Fritas',          category: 'appetizers',  price: 5.99,  description: 'Papas doradas crujientes',              stock: 'in-stock',  enabled: true },
    { id: 12, name: 'Verduras Salteadas',    category: 'appetizers',  price: 14.50, description: 'Verduras de estación',                 stock: 'in-stock',  enabled: true },
    { id: 13, name: 'Tiramisú',              category: 'desserts',    price: 7.99,  description: 'Clásico postre italiano',               stock: 'in-stock',  enabled: true },
    { id: 14, name: 'Torta de Chocolate',    category: 'desserts',    price: 8.50,  description: 'Capas de chocolate intenso',            stock: 'low-stock', enabled: true },
    { id: 15, name: 'Sorbete de Frutas',     category: 'desserts',    price: 6.99,  description: 'Sorbete refrescante de fruta',          stock: 'in-stock',  enabled: true },
  ],

  staff: [
    { id: 1, name: 'María Rodríguez', email: 'maria@resto.com', role: 'waiter',  phone: '+54 11 5555-0101', status: 'active' },
    { id: 2, name: 'Juan García',     email: 'juan@resto.com',  role: 'chef',    phone: '+54 11 5555-0102', status: 'active' },
    { id: 3, name: 'Sara Johnson',    email: 'sara@resto.com',  role: 'manager', phone: '+54 11 5555-0103', status: 'active' },
    { id: 4, name: 'Marcos Davis',    email: 'marcos@resto.com',role: 'waiter',  phone: '+54 11 5555-0104', status: 'active' },
    { id: 5, name: 'Emily Brown',     email: 'emily@resto.com', role: 'cashier', phone: '+54 11 5555-0105', status: 'inactive' },
  ],

  inventory: [
    { id: 1, name: 'Tomates',         category: 'food',      quantity: 45, unit: 'kg',     minStock: 20, supplier: 'Granja Fresca',          lastRestocked: '2026-05-15' },
    { id: 2, name: 'Mozzarella',      category: 'food',      quantity: 12, unit: 'kg',     minStock: 15, supplier: 'Lácteos Directos',        lastRestocked: '2026-05-14' },
    { id: 3, name: 'Aceite de Oliva', category: 'food',      quantity: 28, unit: 'L',      minStock: 10, supplier: 'Importaciones del Med.',   lastRestocked: '2026-05-10' },
    { id: 4, name: 'Vino Tinto',      category: 'beverage',  quantity: 24, unit: 'botella',minStock: 12, supplier: 'Distribuidora de Vinos',  lastRestocked: '2026-05-12' },
    { id: 5, name: 'Agua con Gas',    category: 'beverage',  quantity: 8,  unit: 'caja',   minStock: 10, supplier: 'Bebidas y Más',           lastRestocked: '2026-05-16' },
    { id: 6, name: 'Servilletas',     category: 'supplies',  quantity: 150,unit: 'pcs',    minStock: 100,supplier: 'Suministros Resto',       lastRestocked: '2026-05-11' },
  ],

  sales: [],

  _nextId: { tables: 13, menuItems: 16, staff: 6, inventory: 7, sales: 1 },
};

function nextId(col) { return appDB._nextId[col]++; }

// ──────────────────────────────────────────────
// AUTH
// ──────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = appDB.users.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });
  const { password: _, ...safeUser } = user;
  res.json({ user: safeUser });
});

app.get('/api/auth/me', (req, res) => {
  const userId = Number(req.headers['x-user-id']);
  const user = appDB.users.find(u => u.id === userId);
  if (!user) return res.status(401).json({ error: 'No autorizado' });
  const { password: _, ...safeUser } = user;
  res.json({ user: safeUser });
});

// ──────────────────────────────────────────────
// TABLES
// ──────────────────────────────────────────────
app.get('/api/tables', (_, res) => res.json(appDB.tables));

app.post('/api/tables', (req, res) => {
  const table = { ...req.body, id: nextId('tables'), orders: [] };
  appDB.tables.push(table);
  broadcast('tables_updated', appDB.tables);
  res.status(201).json(table);
});

app.put('/api/tables/:id', (req, res) => {
  const id = Number(req.params.id);
  const idx = appDB.tables.findIndex(t => t.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Mesa no encontrada' });
  appDB.tables[idx] = { ...appDB.tables[idx], ...req.body, id };
  broadcast('tables_updated', appDB.tables);
  res.json(appDB.tables[idx]);
});

app.delete('/api/tables/:id', (req, res) => {
  const id = Number(req.params.id);
  appDB.tables = appDB.tables.filter(t => t.id !== id);
  broadcast('tables_updated', appDB.tables);
  res.status(204).end();
});

app.post('/api/tables/:id/orders', (req, res) => {
  const id = Number(req.params.id);
  const idx = appDB.tables.findIndex(t => t.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Mesa no encontrada' });
  const newOrders = req.body.orders || [];
  appDB.tables[idx] = {
    ...appDB.tables[idx],
    status: 'occupied',
    orders: [...(appDB.tables[idx].orders || []), ...newOrders],
    guestCount: appDB.tables[idx].guestCount || 2,
    occupiedTime: appDB.tables[idx].occupiedTime || 0,
  };
  broadcast('tables_updated', appDB.tables);
  broadcast('order_added', { tableId: id, tableNumber: appDB.tables[idx].number, orders: newOrders });
  res.json(appDB.tables[idx]);
});

// ──────────────────────────────────────────────
// MENU ITEMS
// ──────────────────────────────────────────────
app.get('/api/menu', (_, res) => res.json(appDB.menuItems));

app.post('/api/menu', (req, res) => {
  const item = { ...req.body, id: nextId('menuItems'), enabled: req.body.enabled ?? true };
  appDB.menuItems.push(item);
  broadcast('menu_updated', appDB.menuItems);
  res.status(201).json(item);
});

app.put('/api/menu/:id', (req, res) => {
  const id = Number(req.params.id);
  const idx = appDB.menuItems.findIndex(m => m.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Item no encontrado' });
  appDB.menuItems[idx] = { ...appDB.menuItems[idx], ...req.body, id };
  broadcast('menu_updated', appDB.menuItems);
  res.json(appDB.menuItems[idx]);
});

app.delete('/api/menu/:id', (req, res) => {
  const id = Number(req.params.id);
  appDB.menuItems = appDB.menuItems.filter(m => m.id !== id);
  broadcast('menu_updated', appDB.menuItems);
  res.status(204).end();
});

// ──────────────────────────────────────────────
// STAFF
// ──────────────────────────────────────────────
app.get('/api/staff', (_, res) => res.json(appDB.staff));

app.post('/api/staff', (req, res) => {
  const member = { ...req.body, id: nextId('staff') };
  appDB.staff.push(member);
  res.status(201).json(member);
});

app.put('/api/staff/:id', (req, res) => {
  const id = Number(req.params.id);
  const idx = appDB.staff.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Empleado no encontrado' });
  appDB.staff[idx] = { ...appDB.staff[idx], ...req.body, id };
  res.json(appDB.staff[idx]);
});

app.delete('/api/staff/:id', (req, res) => {
  const id = Number(req.params.id);
  appDB.staff = appDB.staff.filter(s => s.id !== id);
  res.status(204).end();
});

// ──────────────────────────────────────────────
// INVENTORY
// ──────────────────────────────────────────────
app.get('/api/inventory', (_, res) => res.json(appDB.inventory));

app.post('/api/inventory', (req, res) => {
  const item = { ...req.body, id: nextId('inventory') };
  appDB.inventory.push(item);
  res.status(201).json(item);
});

app.put('/api/inventory/:id', (req, res) => {
  const id = Number(req.params.id);
  const idx = appDB.inventory.findIndex(i => i.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Item no encontrado' });
  appDB.inventory[idx] = { ...appDB.inventory[idx], ...req.body, id };
  res.json(appDB.inventory[idx]);
});

app.delete('/api/inventory/:id', (req, res) => {
  const id = Number(req.params.id);
  appDB.inventory = appDB.inventory.filter(i => i.id !== id);
  res.status(204).end();
});

// ──────────────────────────────────────────────
// SALES
// ──────────────────────────────────────────────
app.get('/api/sales', (_, res) => res.json(appDB.sales));

app.post('/api/sales', (req, res) => {
  const sale = {
    ...req.body,
    id: nextId('sales'),
    createdAt: new Date().toISOString(),
  };
  appDB.sales.unshift(sale); // más recientes primero
  broadcast('sale_registered', sale);
  res.status(201).json(sale);
});

app.delete('/api/sales/:id', (req, res) => {
  const id = Number(req.params.id);
  appDB.sales = appDB.sales.filter(s => s.id !== id);
  res.status(204).end();
});

// ──────────────────────────────────────────────
// HEALTH
// ──────────────────────────────────────────────
app.get('/api/health', (_, res) => {
  res.json({
    status: 'ok',
    wsClients: wss.clients.size,
    counts: { tables: appDB.tables.length, menuItems: appDB.menuItems.length, staff: appDB.staff.length, sales: appDB.sales.length },
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🍽️  RestaurantOS server corriendo en http://0.0.0.0:${PORT}`);
  console.log(`📡  WebSocket disponible en ws://0.0.0.0:${PORT}/ws`);
  console.log(`   ⚠️  DB en memoria — los datos se resetean al reiniciar\n`);
});
