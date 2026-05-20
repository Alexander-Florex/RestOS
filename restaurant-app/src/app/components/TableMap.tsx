import { useState } from 'react';
import { TableModal } from './TableModal';
import { tablesApi } from '../lib/api';
import type { Table, MenuItem } from '../lib/api';

interface TableMapProps {
  tables: Table[];
  menuItems: MenuItem[];
  onTableUpdate: (id: number, data: Partial<Table>) => Promise<void>;
  /** Navegación a Ventas con datos pre-cargados tras cerrar una mesa */
  onGoToSales?: (saleData: { tableNumber: number; total: number; orders: Table['orders'] }) => void;
}

export function TableMap({ tables, menuItems, onTableUpdate, onGoToSales }: TableMapProps) {
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);

  const stats = {
    available: tables.filter(t => t.status === 'available').length,
    occupied: tables.filter(t => t.status === 'occupied').length,
    billRequested: tables.filter(t => t.status === 'bill-requested').length,
  };

  const getStyle = (status: Table['status']) => {
    switch (status) {
      case 'available':    return 'bg-emerald-500/20 border-emerald-500/50 hover:bg-emerald-500/30 hover:border-emerald-400';
      case 'occupied':     return 'bg-red-500/20 border-red-500/50 hover:bg-red-500/30 hover:border-red-400';
      case 'bill-requested': return 'bg-amber-500/20 border-amber-500/50 hover:bg-amber-500/30 hover:border-amber-400';
      default:             return 'bg-gray-500/20 border-gray-500/50';
    }
  };

  const getDot = (status: Table['status']) => {
    switch (status) {
      case 'available':    return 'bg-emerald-400';
      case 'occupied':     return 'bg-red-400';
      case 'bill-requested': return 'bg-amber-400 animate-pulse';
      default:             return 'bg-gray-400';
    }
  };

  const getLabel = (status: Table['status']) => {
    switch (status) {
      case 'available':    return 'Libre';
      case 'occupied':     return 'Ocupada';
      case 'bill-requested': return 'Pidió cuenta';
      default:             return status;
    }
  };

  const handleAddOrder = async (tableId: number, newOrders: Array<{ item: string; quantity: number; price: number }>) => {
    const updated = await tablesApi.addOrders(tableId, newOrders);
    await onTableUpdate(tableId, updated);
    setSelectedTable(updated);
  };

  const handleCloseTable = async (tableId: number) => {
    await onTableUpdate(tableId, { status: 'available', guestCount: null, orders: [], occupiedTime: null });
    setSelectedTable(null);
  };

  const handleStatusChange = async (tableId: number, status: Table['status'], guestCount?: number) => {
    const patch: Partial<Table> = { status };
    if (status === 'occupied' && guestCount) patch.guestCount = guestCount;
    if (status === 'occupied' && !tables.find(t => t.id === tableId)?.occupiedTime) patch.occupiedTime = 0;
    const updated = await tablesApi.update(tableId, patch);
    await onTableUpdate(tableId, updated);
    setSelectedTable(updated);
  };

  const openTable = (table: Table) => {
    // Always get fresh data
    const fresh = tables.find(t => t.id === table.id) || table;
    setSelectedTable(fresh);
  };

  return (
    <>
      <div className="p-8">
        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-[#0F172A] border border-emerald-500/20 rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stats.available}</p>
              <p className="text-xs text-gray-400">Mesas libres</p>
            </div>
          </div>
          <div className="bg-[#0F172A] border border-red-500/20 rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stats.occupied}</p>
              <p className="text-xs text-gray-400">Ocupadas</p>
            </div>
          </div>
          <div className="bg-[#0F172A] border border-amber-500/20 rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stats.billRequested}</p>
              <p className="text-xs text-gray-400">Pidieron cuenta</p>
            </div>
          </div>
        </div>

        {/* Table grid */}
        <div className="grid grid-cols-4 gap-5">
          {tables.map(table => (
            <button
              key={table.id}
              onClick={() => openTable(table)}
              className={`relative aspect-square rounded-2xl border-2 ${getStyle(table.status)}
                transition-all duration-150 flex flex-col items-center justify-center gap-2 p-4 group`}
            >
              {table.status === 'bill-requested' && (
                <span className="absolute top-2 right-2 text-[10px] font-bold text-amber-300 bg-amber-500/20 border border-amber-500/30 px-1.5 py-0.5 rounded-full">CUENTA</span>
              )}
              <span className="text-4xl font-black text-white">{table.number}</span>
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${getDot(table.status)}`} />
                <span className="text-xs text-white/70 font-medium">{getLabel(table.status)}</span>
              </div>
              {table.guestCount ? (
                <span className="text-xs text-white/50">{table.guestCount} comensales</span>
              ) : null}
              {(table.orders?.length ?? 0) > 0 && (
                <span className="text-xs text-white/50">{table.orders!.length} ítem{table.orders!.length !== 1 ? 's' : ''}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {selectedTable && (
        <TableModal
          table={tables.find(t => t.id === selectedTable.id) || selectedTable}
          menuItems={menuItems}
          onClose={() => setSelectedTable(null)}
          onAddOrder={handleAddOrder}
          onCloseTable={handleCloseTable}
          onStatusChange={handleStatusChange}
          onCloseTableGoSales={onGoToSales}
        />
      )}
    </>
  );
}