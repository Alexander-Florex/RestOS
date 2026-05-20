import { Map, UtensilsCrossed, Bell } from 'lucide-react';

interface MobileBottomNavProps {
  activeTab: 'tables' | 'menu' | 'notifications';
  onTabChange: (tab: 'tables' | 'menu' | 'notifications') => void;
}

export function MobileBottomNav({ activeTab, onTabChange }: MobileBottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-[#0F172A] border-t border-gray-700 px-4 py-2 safe-area-inset-bottom">
      <div className="flex items-center justify-around">
        <button
          onClick={() => onTabChange('tables')}
          className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors ${
            activeTab === 'tables' ? 'text-emerald-500' : 'text-gray-400'
          }`}
        >
          <Map className="w-6 h-6" />
          <span className="text-xs font-medium">Tables</span>
        </button>

        <button
          onClick={() => onTabChange('menu')}
          className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors ${
            activeTab === 'menu' ? 'text-emerald-500' : 'text-gray-400'
          }`}
        >
          <UtensilsCrossed className="w-6 h-6" />
          <span className="text-xs font-medium">Menu</span>
        </button>

        <button
          onClick={() => onTabChange('notifications')}
          className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors relative ${
            activeTab === 'notifications' ? 'text-emerald-500' : 'text-gray-400'
          }`}
        >
          <Bell className="w-6 h-6" />
          <span className="text-xs font-medium">Alerts</span>
          <span className="absolute top-1 right-2 w-2 h-2 bg-emerald-500 rounded-full"></span>
        </button>
      </div>
    </nav>
  );
}
