// ──────────────────────────────────────────────
// DashboardHome.tsx — Resumen del día (vista de inicio)
// Total facturado, cuentas cerradas, ticket promedio, mesas
// ocupadas vs disponibles, últimas ventas y accesos rápidos.
// ──────────────────────────────────────────────
import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  DollarSign, Receipt, TrendingUp, LayoutGrid, BookOpen, BarChart3,
  ShoppingBag, CalendarDays, ArrowUpRight, Sparkles,
} from 'lucide-react';
import { salesApi, reportsApi, type DailyStats, type DailyTicket } from '../lib/api';
import { useTables } from '../hooks/useTables';
import { useAuth } from '../context/AuthContext';
import { formatMoney } from '../lib/format';
import { getSocket, SocketEvents } from '../lib/socket';
import { AnimatedMoney, AnimatedNumber, EASE_OUT, PageHeader, SpotlightCard, Stagger, StaggerItem } from './ui/motion';
import { cn } from '../lib/utils';

type View = 'tables' | 'takeaway' | 'reservations' | 'menu' | 'sales' | 'reports' | 'inventory' | 'staff' | 'users';

interface QuickLink {
  view: View;
  label: string;
  hint: string;
  icon: typeof LayoutGrid;
}

const QUICK_LINKS: QuickLink[] = [
  { view: 'tables',       label: 'Mapa de mesas', hint: 'Salón en vivo',     icon: LayoutGrid },
  { view: 'takeaway',     label: 'Para llevar',   hint: 'Pedidos y retiros', icon: ShoppingBag },
  { view: 'reservations', label: 'Reservas',      hint: 'Agenda del día',    icon: CalendarDays },
  { view: 'menu',         label: 'Menú',          hint: 'Carta y precios',   icon: BookOpen },
  { view: 'reports',      label: 'Reportes',      hint: 'Números del día',   icon: BarChart3 },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return 'Buenas noches';
  if (h < 13) return 'Buen día';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

export function DashboardHome({ onNavigate }: { onNavigate: (view: View) => void }) {
  const { user, can } = useAuth();
  const canSales = can('sales.view');
  const canReports = can('reports.view');
  const { tables, loading: tablesLoading } = useTables();
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [recent, setRecent] = useState<DailyTicket[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const today = new Date();
      // Cada bloque se pide solo si el rol tiene permiso para verlo
      const [s, t] = await Promise.all([
        canSales ? salesApi.dailyStats(today) : null,
        canReports ? reportsApi.dailyTickets(today) : null,
      ]);
      setStats(s);
      setRecent(t ? t.tickets.slice(-5).reverse() : []);
    } catch {
      // Sin conexión o sin permiso: el inicio se muestra con lo que haya
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
  const billRequested = tables.filter(t => t.status === 'BILL_REQUESTED').length;
  const totalTables = tables.length;
  const occupancy = totalTables > 0 ? occupied / totalTables : 0;

  const averageTicket = stats && stats.count > 0 ? stats.total / stats.count : 0;
  const firstName = user?.name.split(' ')[0] ?? '';
  const today = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

  if (loading) return <HomeSkeleton />;

  return (
    <div>
      <PageHeader
        eyebrow={today}
        title={<>{greeting()}, <span className="text-gradient">{firstName}</span></>}
        description="Así viene el día en el local."
      />

      <Stagger className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* KPI principal */}
        {canSales && (
        <StaggerItem className="lg:col-span-5">
          <SpotlightCard className="h-full p-6 sm:p-7">
            <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand-500/25 blur-3xl" />
            <div className="relative flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500/20 text-brand-300">
                  <DollarSign className="h-4 w-4" />
                </span>
                Facturado hoy
              </span>
              <span className="flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> En vivo
              </span>
            </div>
            <AnimatedMoney value={stats?.total ?? 0} className="relative mt-6 block font-display text-5xl font-bold tracking-tight sm:text-6xl" />
            <p className="relative mt-3 text-sm text-muted-foreground">
              {stats?.count ?? 0} {stats?.count === 1 ? 'cuenta cerrada' : 'cuentas cerradas'} en el día
            </p>
          </SpotlightCard>
        </StaggerItem>
        )}

        {/* KPIs secundarios */}
        {canSales && (
        <StaggerItem className="grid grid-cols-2 gap-4 lg:col-span-4 lg:grid-cols-1">
          <MiniKpi icon={Receipt} label="Cuentas cerradas" value={<AnimatedNumber value={stats?.count ?? 0} />} />
          <MiniKpi icon={TrendingUp} label="Ticket promedio" value={<AnimatedMoney value={averageTicket} />} />
        </StaggerItem>
        )}

        {/* Ocupación */}
        <StaggerItem className="lg:col-span-3">
          <SpotlightCard className="h-full p-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Ocupación</span>
              <button onClick={() => onNavigate('tables')} className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground" aria-label="Ver mapa de mesas">
                <ArrowUpRight className="h-4 w-4" />
              </button>
            </div>
            {tablesLoading ? (
              <div className="skeleton mx-auto mt-6 h-32 w-32 rounded-full" />
            ) : totalTables === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">No hay mesas configuradas.</p>
            ) : (
              <>
                <OccupancyRing value={occupancy} occupied={occupied} total={totalTables} />
                <div className="mt-5 grid grid-cols-2 gap-2 text-xs">
                  <Legend color="bg-brand-400" label="Ocupadas" value={occupied} />
                  <Legend color="bg-emerald-400" label="Libres" value={available} />
                </div>
                {billRequested > 0 && (
                  <motion.button
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                    onClick={() => onNavigate('tables')}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300/30 bg-amber-400/10 py-2 text-xs font-semibold text-amber-200"
                  >
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
                    {billRequested} {billRequested === 1 ? 'mesa pide' : 'mesas piden'} la cuenta
                  </motion.button>
                )}
              </>
            )}
          </SpotlightCard>
        </StaggerItem>

        {/* Últimas ventas */}
        {canReports && (
        <StaggerItem className="lg:col-span-7">
          <div className="glass h-full rounded-3xl p-6">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">Últimas ventas</h3>
              <button onClick={() => onNavigate('reports')}
                className="flex items-center gap-1 text-xs font-semibold text-brand-300 transition-colors hover:text-brand-200">
                Ver reportes <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>
            {recent.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 py-10 text-center">
                <Sparkles className="h-6 w-6 text-brand-400" />
                <p className="mt-3 text-sm text-muted-foreground">Todavía no se cerró ninguna cuenta hoy.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <AnimatePresence initial={false}>
                  {recent.map((t, i) => (
                    <motion.div
                      key={t.id} layout
                      initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                      transition={{ delay: i * 0.04, duration: 0.4, ease: EASE_OUT }}
                      className="group flex items-center justify-between rounded-2xl px-3 py-3 transition-colors hover:bg-white/[0.04]"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.03] font-display text-sm font-bold tabular-nums">
                          {t.tableNumber}
                        </span>
                        <div>
                          <p className="text-sm font-medium">Mesa {t.tableNumber}</p>
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {new Date(t.closedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} hs
                          </p>
                        </div>
                      </div>
                      <span className="font-display text-base font-semibold tabular-nums">{formatMoney(t.total)}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </StaggerItem>
        )}

        {/* Accesos rápidos */}
        <StaggerItem className="lg:col-span-5">
          <div className="glass h-full rounded-3xl p-6">
            <h3 className="mb-5 font-display text-lg font-semibold">Accesos rápidos</h3>
            <div className="grid grid-cols-2 gap-2.5">
              {QUICK_LINKS.map((link, i) => {
                const Icon = link.icon;
                return (
                  <motion.button
                    key={link.view}
                    whileHover={{ y: -3 }} whileTap={{ scale: 0.97 }}
                    onClick={() => onNavigate(link.view)}
                    className={cn(
                      'group relative flex items-center gap-3 overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3.5 text-left transition-colors',
                      'hover:border-brand-400/30 hover:bg-brand-500/[0.07]',
                      i === 0 && 'col-span-2'
                    )}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-white/10 to-white/[0.02] text-muted-foreground transition-colors group-hover:from-brand-400 group-hover:to-brand-600 group-hover:text-white">
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{link.label}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{link.hint}</span>
                    </span>
                    <ArrowUpRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                  </motion.button>
                );
              })}
            </div>
          </div>
        </StaggerItem>
      </Stagger>
    </div>
  );
}

function MiniKpi({ icon: Icon, label, value }: { icon: typeof DollarSign; label: string; value: ReactNode }) {
  return (
    <SpotlightCard className="h-full p-5">
      <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <Icon className="h-4 w-4 text-brand-300" />
        {label}
      </span>
      <div className="mt-3 font-display text-2xl font-bold tracking-tight sm:text-3xl">{value}</div>
    </SpotlightCard>
  );
}

function OccupancyRing({ value, occupied, total }: { value: number; occupied: number; total: number }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  return (
    <div className="relative mx-auto mt-4 h-36 w-36">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <defs>
          <linearGradient id="occ-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffa970" />
            <stop offset="100%" stopColor="#ec4f12" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r={R} fill="none" stroke="rgb(255 255 255 / 0.07)" strokeWidth="10" />
        <motion.circle
          cx="60" cy="60" r={R} fill="none" stroke="url(#occ-grad)" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: C * (1 - value) }}
          transition={{ duration: 1.4, ease: EASE_OUT, delay: 0.2 }}
          style={{ filter: 'drop-shadow(0 0 8px rgb(251 106 38 / 0.6))' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-3xl font-bold tabular-nums">{Math.round(value * 100)}%</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{occupied} de {total}</span>
      </div>
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2">
      <span className="flex items-center gap-2 text-muted-foreground">
        <span className={cn('h-2 w-2 rounded-full', color)} />
        {label}
      </span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div>
      <div className="skeleton mb-3 h-4 w-40" />
      <div className="skeleton mb-10 h-10 w-72" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="skeleton h-52 rounded-3xl lg:col-span-5" />
        <div className="skeleton h-52 rounded-3xl lg:col-span-4" />
        <div className="skeleton h-52 rounded-3xl lg:col-span-3" />
        <div className="skeleton h-72 rounded-3xl lg:col-span-7" />
        <div className="skeleton h-72 rounded-3xl lg:col-span-5" />
      </div>
    </div>
  );
}
