// ──────────────────────────────────────────────
// DashboardPage.tsx — Shell post-login (admin / staff)
// Sidebar con navegación entre Mapa, Reservas, Menú, Ventas, Reportes, Inventario y Personal.
// Integra el hook global de notificaciones en vivo.
// ──────────────────────────────────────────────
import { useState } from 'react';
import {
  LogOut, ChefHat, LayoutGrid, BookOpen, Receipt, Package, Users,
  CalendarDays, BarChart3,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../lib/permissions';
import { useNotifications } from '../hooks/useNotifications';
import { Button } from '../components/ui/button';
import { NotificationToggle } from '../components/NotificationToggle';
import { PrinterConfigButton } from '../components/PrintButton';
import { TableMap } from '../components/TableMap';
import { MenuPage } from '../components/MenuPage';
import { SalesHistoryPage } from '../components/SalesHistoryPage';
import { InventoryPage } from '../components/InventoryPage';
import { StaffPage } from '../components/StaffPage';
import { ReservationsPage } from '../components/ReservationsPage';
import { ReportsPage } from '../components/ReportsPage';
import { cn } from '../lib/utils';

type View = 'tables' | 'reservations' | 'menu' | 'sales' | 'reports' | 'inventory' | 'staff';

interface NavItem {
  id: View;
  label: string;
  icon: typeof LayoutGrid;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { id: 'tables',       label: 'Mapa de mesas', icon: LayoutGrid },
  { id: 'reservations', label: 'Reservas',      icon: CalendarDays },
  { id: 'menu',         label: 'Menú',          icon: BookOpen },
  { id: 'sales',        label: 'Ventas',        icon: Receipt },
  { id: 'reports',      label: 'Reportes',      icon: BarChart3 },
  { id: 'inventory',    label: 'Inventario',    icon: Package },
  { id: 'staff',        label: 'Personal',      icon: Users, adminOnly: true },
];

export function DashboardPage() {
  const { user, logout } = useAuth();
  const [view, setView] = useState<View>('tables');

  // Hook global de notificaciones (sonido + toast + browser notif)
  useNotifications();

  if (!user) return null;

  const visibleNav = NAV.filter(item => !item.adminOnly || user.role === 'ADMIN');

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar desktop */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card/50 md:flex">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-500/30">
            <ChefHat className="h-4 w-4 text-emerald-400" strokeWidth={2.25} />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">RestOS</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Gestión</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {visibleNav.map(item => {
            const active = view === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-border p-3">
          <div className="rounded-xl bg-secondary/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {ROLE_LABELS[user.role]} · @{user.username}
                </p>
              </div>
              <NotificationToggle />
            </div>
            <Button variant="outline" size="sm" className="mt-3 w-full" onClick={logout}>
              <LogOut className="h-3.5 w-3.5" />
              Cerrar sesión
            </Button>
            <PrinterConfigButton />
          </div>
        </div>
      </aside>

      {/* Topbar mobile + contenido */}
      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur md:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/30">
                <ChefHat className="h-4 w-4 text-emerald-400" />
              </div>
              <p className="text-sm font-semibold">RestOS</p>
            </div>
            <div className="flex items-center gap-1">
              <NotificationToggle />
              <Button variant="ghost" size="icon" onClick={logout} aria-label="Cerrar sesión">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex overflow-x-auto border-t border-border">
            {visibleNav.map(item => {
              const active = view === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setView(item.id)}
                  className={cn(
                    'flex shrink-0 items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors',
                    active
                      ? 'border-b-2 border-emerald-500 text-emerald-400'
                      : 'text-muted-foreground'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-6 py-6">
          {view === 'tables'       && <TableMap />}
          {view === 'reservations' && <ReservationsPage />}
          {view === 'menu'         && <MenuPage />}
          {view === 'sales'        && <SalesHistoryPage />}
          {view === 'reports'      && <ReportsPage />}
          {view === 'inventory'    && <InventoryPage />}
          {view === 'staff'        && <StaffPage />}
        </main>
      </div>
    </div>
  );
}
