import { ChevronDown } from 'lucide-react';

interface MobileHeaderProps {
  waiterName: string;
  selectedTable: number | null;
}

export function MobileHeader({ waiterName, selectedTable }: MobileHeaderProps) {
  return (
    <header className="sticky top-0 z-10 bg-[#0F172A] border-b border-gray-700 px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400">Waiter</p>
          <p className="text-sm font-medium text-white">{waiterName}</p>
        </div>
        {selectedTable && (
          <button className="flex items-center gap-2 px-3 py-2 bg-emerald-500 rounded-lg">
            <span className="text-sm font-medium text-white">Table {selectedTable}</span>
            <ChevronDown className="w-4 h-4 text-white" />
          </button>
        )}
      </div>
    </header>
  );
}
