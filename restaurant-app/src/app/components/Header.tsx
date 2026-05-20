import { Bell, Circle, UtensilsCrossed, Map, Package, Users } from 'lucide-react';

const PAGE_META: Record<string, { label: string; icon: React.ElementType }> = {
  dashboard: { label: 'Dashboard / Ventas', icon: UtensilsCrossed },
  tables:    { label: 'Mapa de mesas', icon: Map },
  menu:      { label: 'Catálogo de menú', icon: UtensilsCrossed },
  inventory: { label: 'Inventario', icon: Package },
  staff:     { label: 'Personal', icon: Users },
  accounting:{ label: 'Contabilidad', icon: UtensilsCrossed },
  expenses:  { label: 'Gastos', icon: UtensilsCrossed },
};

interface HeaderProps { activePage: string; }

export function Header({ activePage }: HeaderProps) {
  const meta = PAGE_META[activePage] || PAGE_META.tables;
  const now = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <header className="h-16 bg-[#0F172A] border-b border-gray-800 flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold text-white">{meta.label}</h2>
        <span className="hidden md:block text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full capitalize">{now}</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
          <Circle className="w-2 h-2 fill-emerald-500 text-emerald-500" />
          <span className="text-xs font-medium text-emerald-400">appDB activa</span>
        </div>

        <div className="text-xs text-gray-500 hidden lg:block px-3 py-1.5 bg-gray-800/60 rounded-lg border border-gray-700/50">
          Sucursal Principal
        </div>

        <button className="relative p-2 bg-gray-800 rounded-xl border border-gray-700 hover:bg-gray-700 transition-colors group">
          <Bell className="w-4 h-4 text-gray-400 group-hover:text-white transition-colors" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-emerald-500 rounded-full" />
        </button>
      </div>
    </header>
  );
}
