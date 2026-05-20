import { LayoutDashboard, Map, Package, Calculator, Receipt, Users, UtensilsCrossed, LogOut, TrendingUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../lib/auth';

interface SidebarProps {
  activePage: string;
  onPageChange: (page: string) => void;
}

const ALL_PAGES = [
  { id: 'dashboard',  label: 'Dashboard',       icon: LayoutDashboard, roles: ['admin'] as UserRole[] },
  { id: 'tables',     label: 'Mapa de Mesas',   icon: Map,             roles: ['admin', 'staff'] as UserRole[] },
  { id: 'sales',      label: 'Ventas',           icon: TrendingUp,      roles: ['admin', 'staff'] as UserRole[] },
  { id: 'menu',       label: 'Catálogo Menú',   icon: UtensilsCrossed, roles: ['admin', 'staff'] as UserRole[] },
  { id: 'inventory',  label: 'Inventario',       icon: Package,         roles: ['admin'] as UserRole[] },
  { id: 'accounting', label: 'Contabilidad',     icon: Calculator,      roles: ['admin'] as UserRole[] },
  { id: 'expenses',   label: 'Gastos',           icon: Receipt,         roles: ['admin'] as UserRole[] },
  { id: 'staff',      label: 'Personal',         icon: Users,           roles: ['admin'] as UserRole[] },
];

const ROLE_LABELS: Record<UserRole, string> = {
  admin:  'Administrador',
  waiter: 'Mesero',
  staff:  'Personal',
};

const ROLE_COLORS: Record<UserRole, string> = {
  admin:  'bg-emerald-500/20 text-emerald-300',
  waiter: 'bg-blue-500/20 text-blue-300',
  staff:  'bg-purple-500/20 text-purple-300',
};

export function Sidebar({ activePage, onPageChange }: SidebarProps) {
  const { user, logout } = useAuth();
  const role = user?.role ?? 'staff';

  const visiblePages = ALL_PAGES.filter(p => p.roles.includes(role));

  return (
    <aside className="w-64 bg-[#0F172A] border-r border-gray-800 flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500 flex items-center justify-center">
            <UtensilsCrossed className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-white">RestaurantOS</h1>
            <p className="text-xs text-gray-400">Management Suite</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {visiblePages.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onPageChange(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive ? 'bg-emerald-500 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* User info + logout */}
      <div className="p-4 border-t border-gray-800">
        <div className="flex items-center gap-3 px-3 py-2 mb-2">
          <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-white">
              {user?.name?.slice(0, 2).toUpperCase() ?? 'US'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white truncate">{user?.name}</p>
            <span className={`inline-block text-xs px-1.5 py-0.5 rounded-md font-medium mt-0.5 ${ROLE_COLORS[role]}`}>
              {ROLE_LABELS[role]}
            </span>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors text-sm"
        >
          <LogOut className="w-4 h-4" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
