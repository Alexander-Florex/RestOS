// ──────────────────────────────────────────────
// DashboardPage.tsx — Shell post-login (roles con acceso al panel)
// Escritorio: sidebar agrupada con indicador animado.
// Celular: barra inferior con accesos principales + hoja "Más".
// Integra el hook global de notificaciones en vivo.
// ──────────────────────────────────────────────
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  LogOut, Home, LayoutGrid, BookOpen, Receipt, Package, Users,
  CalendarDays, BarChart3, ShoppingBag, UserCog, Calculator, MoreHorizontal, X, ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { Permission } from '../lib/permissions';
import { initials } from '../lib/admin-helpers';
import { useNotifications } from '../hooks/useNotifications';
import { NotificationToggle } from '../components/NotificationToggle';
import { PrinterConfigButton } from '../components/PrintButton';
import { DashboardHome } from '../components/DashboardHome';
import { TakeawayPage } from '../components/TakeawayPage';
import { TableMap } from '../components/TableMap';
import { MenuPage } from '../components/MenuPage';
import { SalesHistoryPage } from '../components/SalesHistoryPage';
import { InventoryPage } from '../components/InventoryPage';
import { StaffPage } from '../components/StaffPage';
import { UsersPage } from '../components/UsersPage';
import { ReservationsPage } from '../components/ReservationsPage';
import { ReportsPage } from '../components/ReportsPage';
import { RecipesPage } from '../components/RecipesPage';
import { RolesPage } from '../components/RolesPage';
import { BrandMark, EASE_OUT, PageTransition } from '../components/ui/motion';
import { cn } from '../lib/utils';

type View = 'dashboard' | 'tables' | 'takeaway' | 'reservations' | 'menu' | 'sales' | 'reports' | 'inventory' | 'recipes' | 'staff' | 'users' | 'roles';

interface NavItem {
  id: View;
  label: string;
  icon: typeof LayoutGrid;
  /** Permiso necesario para ver la sección (si falta, la ve cualquiera con acceso al panel). */
  perm?: Permission;
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Servicio',
    items: [
      { id: 'dashboard',    label: 'Inicio',        icon: Home },
      { id: 'tables',       label: 'Mapa de mesas', icon: LayoutGrid },
      { id: 'takeaway',     label: 'Para llevar',   icon: ShoppingBag },
      { id: 'reservations', label: 'Reservas',      icon: CalendarDays },
    ],
  },
  {
    title: 'Carta y stock',
    items: [
      { id: 'menu',      label: 'Menú',       icon: BookOpen },
      { id: 'inventory', label: 'Inventario', icon: Package, perm: 'inventory.view' },
      { id: 'recipes',   label: 'Recetas',    icon: Calculator, perm: 'recipes.manage' },
    ],
  },
  {
    title: 'Negocio',
    items: [
      { id: 'sales',   label: 'Ventas',   icon: Receipt, perm: 'sales.view' },
      { id: 'reports', label: 'Reportes', icon: BarChart3, perm: 'reports.view' },
      { id: 'staff',   label: 'Personal', icon: Users, perm: 'staff.manage' },
      { id: 'users',   label: 'Usuarios', icon: UserCog, perm: 'users.manage' },
      { id: 'roles',   label: 'Roles',    icon: ShieldCheck, perm: 'users.manage' },
    ],
  },
];

/** Accesos fijos de la barra inferior en celular. El resto va en "Más". */
const MOBILE_PRIMARY: View[] = ['dashboard', 'tables', 'takeaway', 'sales'];

export function DashboardPage() {
  const { user, logout, can } = useAuth();
  const [view, setView] = useState<View>('dashboard');
  const [moreOpen, setMoreOpen] = useState(false);

  // Hook global de notificaciones (sonido + toast + browser notif)
  useNotifications();

  if (!user) return null;

  const groups = NAV_GROUPS
    .map(g => ({ ...g, items: g.items.filter(item => !item.perm || can(item.perm)) }))
    .filter(g => g.items.length > 0);
  const allItems = groups.flatMap(g => g.items);
  const primaryItems = allItems.filter(i => MOBILE_PRIMARY.includes(i.id));
  const moreItems = allItems.filter(i => !MOBILE_PRIMARY.includes(i.id));
  const current = allItems.find(i => i.id === view);

  function go(v: View) {
    setView(v);
    setMoreOpen(false);
    window.scrollTo({ top: 0 });
  }

  return (
    <div className="flex min-h-[100dvh] text-foreground">
      {/* ── Sidebar escritorio ── */}
      <aside className="sticky top-0 hidden h-[100dvh] w-[264px] shrink-0 flex-col border-r border-white/[0.06] bg-black/20 backdrop-blur-xl md:flex">
        <div className="flex items-center gap-3 px-6 pb-6 pt-7">
          <BrandMark animated className="h-10 w-10" />
          <div>
            <p className="font-display text-lg font-bold leading-none tracking-tight">RestOS</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Gestión gastronómica</p>
          </div>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4">
          {groups.map(group => (
            <div key={group.title}>
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/60">
                {group.title}
              </p>
              <div className="space-y-0.5">
                {group.items.map(item => {
                  const active = view === item.id;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => go(item.id)}
                      className={cn(
                        'relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                        active ? 'text-foreground' : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="sidebar-active"
                          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                          className="absolute inset-0 rounded-xl border border-brand-400/25 bg-gradient-to-r from-brand-500/20 via-brand-500/[0.08] to-transparent shadow-[inset_0_1px_0_0_rgb(255_255_255/0.06)]"
                        >
                          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-400 shadow-[0_0_12px_2px_rgb(251_106_38/0.7)]" />
                        </motion.span>
                      )}
                      <Icon className={cn('relative h-[18px] w-[18px] transition-colors', active && 'text-brand-300')} />
                      <span className="relative">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3">
          <div className="glass rounded-2xl p-3">
            <div className="flex items-center gap-3">
              <Avatar name={user.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{user.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{user.roleName}</p>
              </div>
              <NotificationToggle />
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={logout}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-rose-400/30 hover:bg-rose-500/10 hover:text-rose-300"
              >
                <LogOut className="h-3.5 w-3.5" />
                Cerrar sesión
              </button>
            </div>
            <PrinterConfigButton />
          </div>
        </div>
      </aside>

      {/* ── Contenido ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar celular */}
        <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-background/70 backdrop-blur-xl md:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2.5">
              <BrandMark className="h-8 w-8" />
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={view}
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="font-display text-base font-bold tracking-tight"
                >
                  {current?.label ?? 'RestOS'}
                </motion.p>
              </AnimatePresence>
            </div>
            <div className="flex items-center gap-1">
              <NotificationToggle />
              <Avatar name={user.name} small />
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 pb-28 pt-6 sm:px-6 md:px-10 md:pb-10 md:pt-10">
          <div className="mx-auto w-full max-w-[1400px]">
            <AnimatePresence mode="wait">
              <PageTransition key={view}>
                {view === 'dashboard'    && <DashboardHome onNavigate={go} />}
                {view === 'tables'       && <TableMap />}
                {view === 'takeaway'     && <TakeawayPage />}
                {view === 'reservations' && <ReservationsPage />}
                {view === 'menu'         && <MenuPage />}
                {view === 'sales'        && <SalesHistoryPage />}
                {view === 'reports'      && <ReportsPage />}
                {view === 'inventory'    && <InventoryPage />}
                {view === 'recipes'      && <RecipesPage />}
                {view === 'staff'        && <StaffPage />}
                {view === 'users'        && <UsersPage />}
                {view === 'roles'        && <RolesPage />}
              </PageTransition>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* ── Barra inferior celular ── */}
      <nav className="fixed inset-x-3 bottom-3 z-40 md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="glass flex items-center justify-around rounded-[22px] bg-background/70 px-1.5 py-1.5">
          {primaryItems.map(item => (
            <BottomTab key={item.id} item={item} active={view === item.id} onClick={() => go(item.id)} />
          ))}
          <BottomTab
            item={{ id: 'dashboard', label: 'Más', icon: MoreHorizontal }}
            active={moreOpen || !!(current && moreItems.includes(current))}
            onClick={() => setMoreOpen(true)}
            layoutKey="more"
          />
        </div>
      </nav>

      {/* Hoja "Más" */}
      <AnimatePresence>
        {moreOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMoreOpen(false)}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm md:hidden"
            />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_, info) => { if (info.offset.y > 80) setMoreOpen(false); }}
              className="fixed inset-x-0 bottom-0 z-50 rounded-t-[28px] border-t border-white/10 bg-popover p-5 md:hidden"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}
            >
              <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-white/15" />
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Avatar name={user.name} />
                  <div>
                    <p className="text-sm font-semibold">{user.name}</p>
                    <p className="text-xs text-muted-foreground">{user.roleName}</p>
                  </div>
                </div>
                <button onClick={() => setMoreOpen(false)} className="rounded-full p-2 text-muted-foreground hover:bg-white/10" aria-label="Cerrar">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {moreItems.map((item, i) => {
                  const Icon = item.icon;
                  const active = view === item.id;
                  return (
                    <motion.button
                      key={item.id}
                      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.04 * i, duration: 0.4, ease: EASE_OUT }}
                      onClick={() => go(item.id)}
                      className={cn(
                        'flex flex-col items-center gap-2 rounded-2xl border px-2 py-4 text-xs font-medium transition-colors',
                        active
                          ? 'border-brand-400/40 bg-brand-500/15 text-brand-200'
                          : 'border-white/[0.07] bg-white/[0.03] text-muted-foreground active:bg-white/[0.08]'
                      )}
                    >
                      <Icon className="h-5 w-5" />
                      {item.label}
                    </motion.button>
                  );
                })}
              </div>
              <button
                onClick={logout}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-400/20 bg-rose-500/10 py-3 text-sm font-medium text-rose-300"
              >
                <LogOut className="h-4 w-4" />
                Cerrar sesión
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function BottomTab({ item, active, onClick, layoutKey }: {
  item: NavItem; active: boolean; onClick: () => void; layoutKey?: string;
}) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-2 text-[10px] font-semibold transition-colors',
        active ? 'text-brand-200' : 'text-muted-foreground'
      )}
      data-key={layoutKey}
    >
      {active && (
        <motion.span
          layoutId="bottom-active"
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          className="absolute inset-0 rounded-2xl bg-gradient-to-b from-brand-500/25 to-brand-500/5 ring-1 ring-brand-400/25"
        />
      )}
      <Icon className="relative h-5 w-5" />
      <span className="relative">{item.label}</span>
    </button>
  );
}

function Avatar({ name, small }: { name: string; small?: boolean }) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-rose-500 font-display font-bold text-white',
        'shadow-[inset_0_1px_0_0_rgb(255_255_255/0.3),0_4px_14px_-4px_rgb(251_106_38/0.6)]',
        small ? 'h-8 w-8 text-[11px]' : 'h-10 w-10 text-sm'
      )}
    >
      {initials(name)}
    </div>
  );
}
