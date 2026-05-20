import { useState } from 'react';
import { Users, Plus, Minus, Receipt, ShoppingBag, X } from 'lucide-react';
import type { Table } from '../lib/api';

interface MobileTableGridProps {
  tables: Table[];
  /** Mesa disponible: usuario confirmó N comensales → ir a tomar pedido */
  onOpenTable: (tableNumber: number, guestCount: number) => void;
  /** Mesa ocupada: usuario elige agregar pedido */
  onAddOrder: (tableNumber: number) => void;
  /** Mesa ocupada: usuario pide la cuenta */
  onRequestBill: (tableNumber: number) => void;
}

type ModalState =
  | { kind: 'none' }
  | { kind: 'guests'; table: Table }
  | { kind: 'occupied'; table: Table };

const STATUS_STYLE: Record<string, string> = {
  'available':     'bg-emerald-500/20 border-emerald-500/50 active:bg-emerald-500/30',
  'occupied':      'bg-red-500/20     border-red-500/50     active:bg-red-500/30',
  'bill-requested':'bg-amber-500/20   border-amber-500/50   active:bg-amber-500/30',
};
const DOT_COLOR: Record<string, string> = {
  'available':     'bg-emerald-400',
  'occupied':      'bg-red-400',
  'bill-requested':'bg-amber-400 animate-pulse',
};
const STATUS_LABEL: Record<string, string> = {
  'available':     'Libre',
  'occupied':      'Ocupada',
  'bill-requested':'Cuenta pedida',
};

export function MobileTableGrid({ tables, onOpenTable, onAddOrder, onRequestBill }: MobileTableGridProps) {
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const [guestCount, setGuestCount] = useState(2);

  const handleTap = (table: Table) => {
    if (table.status === 'available') {
      setGuestCount(2);
      setModal({ kind: 'guests', table });
    } else {
      setModal({ kind: 'occupied', table });
    }
  };

  const closeModal = () => setModal({ kind: 'none' });

  const stats = {
    available: tables.filter(t => t.status === 'available').length,
    occupied:  tables.filter(t => t.status === 'occupied').length,
    bill:      tables.filter(t => t.status === 'bill-requested').length,
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Mini stats */}
      <div className="grid grid-cols-3 gap-2 px-4 pt-4 pb-2">
        {[
          { label: 'Libres',   count: stats.available, color: 'text-emerald-400' },
          { label: 'Ocupadas', count: stats.occupied,  color: 'text-red-400'     },
          { label: 'Cuenta',   count: stats.bill,      color: 'text-amber-400'   },
        ].map(s => (
          <div key={s.label} className="bg-[#0F172A] rounded-xl p-2.5 text-center border border-gray-800">
            <p className={`text-xl font-black ${s.color}`}>{s.count}</p>
            <p className="text-[10px] text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Table grid */}
      <div className="grid grid-cols-3 gap-3 p-4">
        {tables.map(table => (
          <button
            key={table.id}
            onClick={() => handleTap(table)}
            className={`aspect-square rounded-2xl border-2 transition-all active:scale-95 flex flex-col items-center justify-center gap-1 p-3 ${STATUS_STYLE[table.status] ?? 'bg-gray-700/20 border-gray-700'}`}
          >
            {table.status === 'bill-requested' && (
              <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-amber-400 rounded-full border-2 border-[#121827]" />
            )}
            <span className="text-2xl font-black text-white">{table.number}</span>
            <div className="flex items-center gap-1">
              <div className={`w-1.5 h-1.5 rounded-full ${DOT_COLOR[table.status] ?? 'bg-gray-400'}`} />
              <span className="text-[11px] text-white/70 font-medium">{STATUS_LABEL[table.status] ?? table.status}</span>
            </div>
            {table.guestCount ? (
              <span className="text-[10px] text-white/50">{table.guestCount} comensales</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* ── Modal: cuántos comensales (mesa libre) ── */}
      {modal.kind === 'guests' && (
        <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50" onClick={closeModal}>
          <div className="bg-[#1E293B] border border-gray-700 rounded-t-3xl w-full max-w-sm p-6 pb-10"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Mesa {modal.table.number}</h3>
              <button onClick={closeModal} className="p-1.5 rounded-xl hover:bg-gray-700 text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-[#0F172A] rounded-2xl p-4 mb-5">
              <p className="text-sm text-gray-400 text-center mb-4 flex items-center justify-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />¿Cuántos comensales?
              </p>
              <div className="flex items-center justify-center gap-5">
                <button
                  onClick={() => setGuestCount(c => Math.max(1, c - 1))}
                  className="w-12 h-12 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors"
                >
                  <Minus className="w-5 h-5 text-white" />
                </button>
                <span className="text-5xl font-black text-white w-16 text-center">{guestCount}</span>
                <button
                  onClick={() => setGuestCount(c => Math.min(20, c + 1))}
                  className="w-12 h-12 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors"
                >
                  <Plus className="w-5 h-5 text-white" />
                </button>
              </div>
            </div>

            <button
              onClick={() => { closeModal(); onOpenTable(modal.table.number, guestCount); }}
              className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-base rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <ShoppingBag className="w-5 h-5" />
              Abrir mesa y tomar pedido
            </button>
          </div>
        </div>
      )}

      {/* ── Modal: acciones mesa ocupada ── */}
      {modal.kind === 'occupied' && (
        <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50" onClick={closeModal}>
          <div className="bg-[#1E293B] border border-gray-700 rounded-t-3xl w-full max-w-sm p-6 pb-10"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <div>
                <h3 className="text-lg font-bold text-white">Mesa {modal.table.number}</h3>
                {modal.table.guestCount && (
                  <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                    <Users className="w-3 h-3" />{modal.table.guestCount} comensales
                  </p>
                )}
              </div>
              <button onClick={closeModal} className="p-1.5 rounded-xl hover:bg-gray-700 text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Orders summary */}
            {modal.table.orders && modal.table.orders.length > 0 && (
              <div className="bg-[#0F172A] rounded-xl p-3 mb-5 mt-3 space-y-1 max-h-32 overflow-y-auto">
                {modal.table.orders.map((o, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-emerald-400 font-bold w-5 text-right">{o.quantity}×</span>
                    <span className="text-white flex-1">{o.item}</span>
                    <span className="text-gray-400">${(o.price * o.quantity).toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-1.5 border-t border-gray-700 mt-1.5">
                  <span className="text-xs text-gray-400 font-medium">Total</span>
                  <span className="text-sm font-black text-emerald-400">
                    ${modal.table.orders.reduce((s, o) => s + o.price * o.quantity, 0).toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={() => { closeModal(); onAddOrder(modal.table.number); }}
                className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-base rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-5 h-5" />
                Agregar pedido
              </button>

              <button
                onClick={() => { closeModal(); onRequestBill(modal.table.number); }}
                className="w-full py-4 bg-amber-500 hover:bg-amber-600 text-white font-bold text-base rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <Receipt className="w-5 h-5" />
                Pedir cuenta → Caja
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}