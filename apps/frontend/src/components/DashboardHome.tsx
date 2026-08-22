// ──────────────────────────────────────────────
// DashboardHome.tsx — Resumen del día (vista de inicio)
// Total facturado, cuentas cerradas, ticket promedio, mesas
// ocupadas vs disponibles, últimas ventas y accesos rápidos.
// ──────────────────────────────────────────────
import { useEffect, useState } from 'react';
import {
  DollarSign, Receipt, TrendingUp, LayoutGrid, BookOpen, BarChart3,
  ShoppingBag, CalendarDays, Loader2, ArrowRight, CheckCircle2, Circle,
} from 'lucide-react';
import { salesApi, reportsApi, type DailyStats, type DailyTicket } from '../lib/api';
import { useTables } from '../hooks/useTables';
import { formatMoney } from '../lib/format';
import { getSocket, SocketEvents } from '../lib/socket';
import { cn } from '../lib/utils';

type View = 'tables' | 'takeaway' | 'reservations' | 'menu' | 'sales' | 'reports' | 'inventory' | 'staff' | 'users';

interface QuickLink {
  view: View;
  label: string;
  icon: typeof LayoutGrid;
}

const QUICK_LINKS: QuickLink[] = [
  { view: 'tables',       label: 'Mapa de mesas', icon: LayoutGrid },
  { view: 'takeaway',     label: 'Para llevar',   icon: ShoppingBag },
  { view: 'reservations', label: 'Reservas',      icon: CalendarDays },
  { view: 'menu',         label: 'Menú',          icon: BookOpen },
  { view: 'reports',      label: 'Reportes',      icon: BarChart3 },
];

export function DashboardHome({ onNavigate }: { onNavigate: (view: View) => void }) {
  const { tables, loading: tablesLoading } = useTables();
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [recent, setRecent] = useState<DailyTicket[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const today = new Date();
      const [s, t] = await Promise.all([
        salesApi.dailyStats(today),
        reportsApi.dailyTickets(today),
      ]);
      setStats(s);
      setRecent(t.tickets.slice(-5).reverse());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Refrescar en vivo cuando se registra una venta
  useEffect(() => {
    const socket = getSocket();
    const onSale = () => load();
    socket.on(SocketEvents.SALE_REGISTERED, onSale);
    return () => { socket.off(SocketEvents.SALE_REGISTERED, onSale); };
  }, []);

  const occupied  = tables.filter(t => t.status === 'OCCUPIED' || t.status === 'BILL_REQUESTED').length;
  const available = tables.filter(t => t.status === 'AVAILABLE').length;
  const totalTables = tables.length;

  const averageTicket = stats && stats.count > 0 ? stats.total / stats.count : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">Inicio</h2>
        <p className="text-sm text-muted-foreground">Resumen del día de hoy</p>
      </div>

      {/* KPIs del día */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard icon={DollarSign} label="Total facturado hoy" value={formatMoney(stats?.total ?? 0)}
          sublabel={`${stats?.count ?? 0} ${stats?.count === 1 ? 'cuenta cerrada' : 'cuentas cerradas'}`} highlight />
        <KpiCard icon={Receipt} label="Cuentas cerradas" value={String(stats?.count ?? 0)} sublabel="Hoy" />
        <KpiCard icon={TrendingUp} label="Ticket promedio" value={formatMoney(averageTicket)} sublabel="Por cuenta" />
      </div>

      {/* Mesas */}
      <div className="mb-6 rounded-2xl border border-border bg-card p-5">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <LayoutGrid className="h-4 w-4 text-emerald-400" />
          Estado de mesas
        </h3>
        {tablesLoading ? (
          <p className="text-sm text-muted-foreground">Cargando mesas...</p>
        ) : totalTables === 0 ? (
          <p className="text-sm text-muted-foreground">No hay mesas configuradas.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-background/50 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                <Circle className="h-3 w-3 fill-rose-400 text-rose-400" />
                Ocupadas
              </div>
              <p className="text-2xl font-bold tabular-nums">{occupied}</p>
            </div>
            <div className="rounded-xl border border-border bg-background/50 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                Disponibles
              </div>
              <p className="text-2xl font-bold tabular-nums">{available}</p>
            </div>
            <div className="rounded-xl border border-border bg-background/50 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                <LayoutGrid className="h-3 w-3 text-muted-foreground" />
                Total
              </div>
              <p className="text-2xl font-bold tabular-nums">{totalTables}</p>
            </div>
          </div>
        )}
        <button onClick={() => onNavigate('tables')}
          className="mt-4 flex items-center gap-1 text-xs font-medium text-emerald-400 hover:underline">
          Ver mapa de mesas <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      {/* Últimas ventas del día */}
      <div className="mb-6 rounded-2xl border border-border bg-card p-5">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Receipt className="h-4 w-4 text-emerald-400" />
          Últimas ventas
        </h3>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no se cerró ninguna cuenta hoy.</p>
        ) : (
          <div className="space-y-2">
            {recent.map(t => (
              <div key={t.id} className="flex items-center justify-between rounded-lg bg-secondary/30 px-3 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="tabular-nums text-muted-foreground">
                    {new Date(t.closedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="font-medium">Mesa {t.tableNumber}</span>
                </div>
                <span className="font-semibold tabular-nums text-emerald-400">{formatMoney(t.total)}</span>
              </div>
            ))}
          </div>
        )}
        <button onClick={() => onNavigate('reports')}
          className="mt-4 flex items-center gap-1 text-xs font-medium text-emerald-400 hover:underline">
          Ver reportes del día <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      {/* Accesos rápidos */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="mb-4 text-sm font-semibold">Accesos rápidos</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {QUICK_LINKS.map(link => {
            const Icon = link.icon;
            return (
              <button key={link.view} onClick={() => onNavigate(link.view)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-xl border border-border bg-background/50 p-4 text-center transition-colors',
                  'hover:border-emerald-500/30 hover:bg-emerald-500/5 hover:text-emerald-400'
                )}>
                <Icon className="h-5 w-5" />
                <span className="text-xs font-medium">{link.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sublabel, highlight }: {
  icon: typeof DollarSign; label: string; value: string; sublabel: string; highlight?: boolean;
}) {
  return (
    <div className={cn('rounded-2xl border p-4', highlight ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border bg-card')}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className={cn('h-4 w-4', highlight && 'text-emerald-400')} />
        {label}
      </div>
      <p className={cn('mt-2 text-2xl font-bold tabular-nums', highlight ? 'text-emerald-400' : 'text-foreground')}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground truncate">{sublabel}</p>
    </div>
  );
}
