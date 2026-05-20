import type { Table } from '../lib/api';

interface MobileTableGridProps {
  tables: Table[];
  onSelectTable: (tableNumber: number) => void;
}

export function MobileTableGrid({ tables, onSelectTable }: MobileTableGridProps) {
  const getStatusColor = (status: Table['status']) => {
    switch (status) {
      case 'available':
        return 'bg-emerald-500 border-emerald-400';
      case 'occupied':
        return 'bg-red-500 border-red-400';
      case 'bill-requested':
        return 'bg-amber-500 border-amber-400';
    }
  };

  const getStatusLabel = (status: Table['status']) => {
    switch (status) {
      case 'available':
        return 'Available';
      case 'occupied':
        return 'Occupied';
      case 'bill-requested':
        return 'Bill Requested';
    }
  };

  return (
    <div className="p-4">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-white">Select Table</h3>
        <p className="text-sm text-gray-400 mt-1">Choose a table to take orders</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {tables.map((table) => (
          <button
            key={table.id}
            onClick={() => onSelectTable(table.number)}
            className={`aspect-square rounded-lg border-2 ${getStatusColor(table.status)}
              transition-all active:scale-95 flex flex-col items-center justify-center gap-1 p-3`}
          >
            <span className="text-2xl font-bold text-white">{table.number}</span>
            <span className="text-xs font-medium text-white/90">{getStatusLabel(table.status)}</span>
            {table.guestCount && (
              <span className="text-xs text-white/70">{table.guestCount} guests</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
