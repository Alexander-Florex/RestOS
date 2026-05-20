import { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginPage } from './components/LoginPage';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { TableMap } from './components/TableMap';
import { MenuCatalog } from './components/MenuCatalog';
import { MobileHeader } from './components/MobileHeader';
import { MobileTableGrid } from './components/MobileTableGrid';
import { MobileOrderTaking } from './components/MobileOrderTaking';
import { MobileBottomNav } from './components/MobileBottomNav';
import { StaffManagement } from './components/StaffManagement';
import { InventoryManagement } from './components/InventoryManagement';
import { TableManagement } from './components/TableManagement';
import { SalesPage } from './components/SalesPage';
import { ToastProvider, useToast } from './lib/toast';
import { tablesApi, menuApi } from './lib/api';
import { useWebSocket } from './lib/websocket';
import { canAccess } from './lib/auth';
import type { Table, MenuItem } from './lib/api';

// ── First valid page for a role ──────────────────────────────
function firstPage(role: 'admin' | 'waiter' | 'staff'): string {
  if (role === 'admin')  return 'dashboard';
  if (role === 'staff')  return 'tables';
  return 'tables';
}

// ── Waiter mobile view ───────────────────────────────────────
function WaiterView({ tables, menuItems, onTableUpdate, onSendOrder }: {
  tables: Table[];
  menuItems: MenuItem[];
  onTableUpdate: (id: number, data: Partial<Table>) => Promise<void>;
  onSendOrder: (items: Array<{ item: string; quantity: number; price: number }>, tableId: number) => Promise<void>;
}) {
  const { user } = useAuth();
  const [mobileTab, setMobileTab] = useState<'tables' | 'menu' | 'notifications'>('tables');
  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  // Mesero solo ve items habilitados por el admin
  const enabledItems = menuItems.filter(m => m.enabled && m.stock !== 'out-of-stock');

  const handleSend = async (items: Array<{ item: string; quantity: number; price: number }>) => {
    if (!selectedTable) return;
    const table = tables.find(t => t.number === selectedTable);
    if (!table) return;
    await onSendOrder(items, table.id);
    setSelectedTable(null);
    setMobileTab('tables');
  };

  return (
    <div className="h-screen bg-[#121827] text-white flex flex-col dark">
      {!selectedTable && <MobileHeader waiterName={user?.name ?? 'Mesero'} selectedTable={selectedTable} />}
      <div className="flex-1 overflow-hidden flex flex-col">
        {mobileTab === 'tables' && !selectedTable && (
          <MobileTableGrid tables={tables} onSelectTable={setSelectedTable} />
        )}
        {selectedTable && (
          <MobileOrderTaking
            tableNumber={selectedTable}
            menuItems={enabledItems}
            onSendOrder={handleSend}
            onBack={() => { setSelectedTable(null); setMobileTab('tables'); }}
          />
        )}
        {mobileTab === 'notifications' && !selectedTable && (
          <div className="p-4">
            <h3 className="text-lg font-semibold text-white mb-4">Notificaciones</h3>
            <div className="space-y-3">
              <div className="bg-[#0F172A] border border-emerald-500/30 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="w-2 h-2 mt-1.5 bg-emerald-500 rounded-full" />
                  <div>
                    <p className="text-sm font-medium text-white">Sistema conectado en tiempo real</p>
                    <p className="text-xs text-gray-400 mt-1">WebSocket activo</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {!selectedTable && <MobileBottomNav activeTab={mobileTab} onTabChange={setMobileTab} />}
    </div>
  );
}

// ── Main app content (after auth) ────────────────────────────
function AppContent() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [activePage, setActivePage] = useState(() => user ? firstPage(user.role) : 'tables');
  const [showTableConfig, setShowTableConfig] = useState(false);
  const [tables, setTables] = useState<Table[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Load initial data
  useEffect(() => {
    Promise.all([tablesApi.getAll(), menuApi.getAll()])
      .then(([t, m]) => { setTables(t); setMenuItems(m); })
      .catch(() => toast.error('Error al conectar con el servidor'))
      .finally(() => setLoading(false));
  }, []);

  // WebSocket real-time updates
  const handleWsMessage = useCallback((msg: { type: string; data: unknown }) => {
    if (msg.type === 'tables_updated') {
      setTables(msg.data as Table[]);
    } else if (msg.type === 'menu_updated') {
      setMenuItems(msg.data as MenuItem[]);
    } else if (msg.type === 'order_added') {
      const payload = msg.data as { tableNumber: number; orders: Array<{ item: string; quantity: number }> };
      toast.info(
        `Pedido en Mesa ${payload.tableNumber}`,
        payload.orders.map(o => `${o.quantity}x ${o.item}`).join(', ')
      );
    } else if (msg.type === 'sale_registered') {
      toast.success('Nueva venta registrada');
    }
  }, []);

  useWebSocket(handleWsMessage);

  const handleTableUpdate = async (id: number, data: Partial<Table>) => {
    const updated = await tablesApi.update(id, data);
    setTables(prev => prev.map(t => t.id === updated.id ? updated : t));
  };

  const handleSendOrder = async (items: Array<{ item: string; quantity: number; price: number }>, tableId: number) => {
    const updated = await tablesApi.addOrders(tableId, items);
    setTables(prev => prev.map(t => t.id === updated.id ? updated : t));
  };

  const handlePageChange = (page: string) => {
    if (!user) return;
    if (!canAccess(user.role, page)) {
      toast.error('Acceso denegado', 'No tenés permiso para ver esta página');
      return;
    }
    setActivePage(page);
    setShowTableConfig(false);
  };

  if (loading) {
    return (
      <div className="h-screen bg-[#121827] flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-400 text-sm">Conectando con el servidor...</p>
        </div>
      </div>
    );
  }

  // Mesero siempre ve la vista móvil de toma de pedidos
  if (user?.role === 'waiter') {
    return (
      <WaiterView
        tables={tables}
        menuItems={menuItems}
        onTableUpdate={handleTableUpdate}
        onSendOrder={handleSendOrder}
      />
    );
  }

  // Admin y personal ven la vista de escritorio
  return (
    <div className="h-screen bg-[#121827] text-white flex dark">
      <Sidebar activePage={activePage} onPageChange={handlePageChange} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header activePage={activePage} />
        <main className="flex-1 overflow-y-auto bg-[#121827]">

          {/* TABLE MAP */}
          {activePage === 'tables' && !showTableConfig && (
            <div>
              <div className="p-8 pb-4 flex items-center justify-between border-b border-gray-700/50">
                <div>
                  <h3 className="text-xl font-semibold text-white">Mapa de Mesas</h3>
                  <p className="text-sm text-gray-400 mt-0.5">Hacé clic en una mesa para ver detalles y gestionar pedidos</p>
                </div>
                {user?.role === 'admin' && (
                  <button
                    onClick={() => setShowTableConfig(true)}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-xl transition-colors"
                  >
                    Configurar mesas
                  </button>
                )}
              </div>
              <TableMap tables={tables} menuItems={menuItems} onTableUpdate={handleTableUpdate} />
            </div>
          )}

          {/* TABLE CONFIG (admin only) */}
          {activePage === 'tables' && showTableConfig && user?.role === 'admin' && (
            <div>
              <div className="p-8 pb-4 flex items-center justify-between border-b border-gray-700/50">
                <div>
                  <h3 className="text-xl font-semibold text-white">Configuración de Mesas</h3>
                  <p className="text-sm text-gray-400 mt-0.5">Agregar, editar o eliminar mesas</p>
                </div>
                <button
                  onClick={() => setShowTableConfig(false)}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm rounded-xl transition-colors"
                >
                  Ver mapa activo
                </button>
              </div>
              <TableManagement tables={tables} onUpdate={setTables} />
            </div>
          )}

          {/* MENU CATALOG */}
          {activePage === 'menu' && <MenuCatalog />}

          {/* SALES PAGE (admin + staff) */}
          {activePage === 'sales' && <SalesPage registeredBy={user?.name} />}

          {/* ADMIN-ONLY PAGES */}
          {activePage === 'inventory' && user?.role === 'admin' && <InventoryManagement />}
          {activePage === 'staff'     && user?.role === 'admin' && <StaffManagement />}

          {activePage === 'dashboard' && user?.role === 'admin' && (
            <div className="p-8">
              <h3 className="text-xl font-semibold text-white mb-2">Dashboard</h3>
              <p className="text-gray-400 text-sm mb-6">Resumen general del restaurante</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {[
                  { label: 'Mesas ocupadas',  value: String(tables.filter(t => t.status === 'occupied').length), sub: `de ${tables.length} mesas` },
                  { label: 'Cuenta pedida',   value: String(tables.filter(t => t.status === 'bill-requested').length), sub: 'esperando cobro' },
                  { label: 'Platos en carta', value: String(menuItems.filter(m => m.enabled).length), sub: 'habilitados' },
                  { label: 'Sin stock',       value: String(menuItems.filter(m => m.stock === 'out-of-stock').length), sub: 'ítems agotados' },
                ].map(({ label, value, sub }) => (
                  <div key={label} className="bg-[#0F172A] border border-gray-800 rounded-xl p-5">
                    <p className="text-xs text-gray-500 mb-1">{label}</p>
                    <p className="text-3xl font-bold text-white">{value}</p>
                    <p className="text-xs text-gray-600 mt-1">{sub}</p>
                  </div>
                ))}
              </div>
              <div className="bg-[#0F172A] border border-gray-800 rounded-xl p-6 text-center text-gray-500">
                <p className="text-sm">Navegá a <strong className="text-gray-400">Ventas</strong> para ver el historial de cuentas cerradas</p>
              </div>
            </div>
          )}

          {activePage === 'accounting' && user?.role === 'admin' && (
            <div className="p-8 flex items-center justify-center h-full">
              <div className="text-center text-gray-500">
                <p className="text-lg font-medium">Contabilidad próximamente</p>
              </div>
            </div>
          )}

          {activePage === 'expenses' && user?.role === 'admin' && (
            <div className="p-8 flex items-center justify-center h-full">
              <div className="text-center text-gray-500">
                <p className="text-lg font-medium">Gastos próximamente</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ── Root with auth gate ──────────────────────────────────────
function AuthGate() {
  const { user } = useAuth();
  if (!user) return <LoginPage />;
  return <AppContent />;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </ToastProvider>
  );
}
