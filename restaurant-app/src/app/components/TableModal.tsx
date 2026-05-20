import { useState, useEffect, useCallback } from 'react';
import { X, Users, Clock, Printer, CheckCircle, Plus, Minus, ShoppingCart, UtensilsCrossed } from 'lucide-react';
import { useToast } from '../lib/toast';
import type { Table, MenuItem } from '../lib/api';

interface TableModalProps {
  table: Table;
  menuItems: MenuItem[];
  onClose: () => void;
  onAddOrder: (tableId: number, orders: Array<{ item: string; quantity: number; price: number }>) => Promise<void>;
  onCloseTable: (tableId: number) => Promise<void>;
  onStatusChange: (tableId: number, status: Table['status'], guestCount?: number) => Promise<void>;
}

type View = 'detail' | 'add-order' | 'seat-guests';

export function TableModal({ table, menuItems, onClose, onAddOrder, onCloseTable, onStatusChange }: TableModalProps) {
  const toast = useToast();
  const [view, setView] = useState<View>(table.status === 'available' ? 'seat-guests' : 'detail');
  const [elapsedTime, setElapsedTime] = useState(table.occupiedTime || 0);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [activeCategory, setActiveCategory] = useState('main-dishes');
  const [guestCount, setGuestCount] = useState(table.guestCount || 2);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (table.status !== 'available') {
      const iv = setInterval(() => setElapsedTime(p => p + 1), 1000);
      return () => clearInterval(iv);
    }
  }, [table.status]);

  const handleClose = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [handleClose]);

  const fmt = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  };

  const total = (table.orders || []).reduce((s, o) => s + o.price * o.quantity, 0);
  const categories = [
    { id: 'main-dishes', label: 'Platos' },
    { id: 'drinks', label: 'Bebidas' },
    { id: 'appetizers', label: 'Entradas' },
    { id: 'desserts', label: 'Postres' },
  ];
  const cartTotal = Object.entries(cart).reduce((s, [id, qty]) => {
    const item = menuItems.find(i => i.id === Number(id));
    return s + (item?.price || 0) * qty;
  }, 0);
  const cartCount = Object.values(cart).reduce((s, q) => s + q, 0);

  const updateCart = (id: number, delta: number) =>
    setCart(prev => {
      const next = Math.max(0, (prev[id] || 0) + delta);
      if (next === 0) { const { [id]: _, ...rest } = prev; return rest; }
      return { ...prev, [id]: next };
    });

  const handleSendOrder = async () => {
    if (!cartCount) return;
    setLoading(true);
    try {
      const orders = Object.entries(cart).map(([id, qty]) => {
        const item = menuItems.find(i => i.id === Number(id))!;
        return { item: item.name, quantity: qty, price: item.price };
      });
      await onAddOrder(table.id, orders);
      toast.success('Pedido enviado', `${cartCount} ítem(s) agregados a la mesa ${table.number}`);
      setCart({});
      setView('detail');
    } catch { toast.error('Error al enviar pedido'); }
    finally { setLoading(false); }
  };

  const handleSeatGuests = async () => {
    setLoading(true);
    try {
      await onStatusChange(table.id, 'occupied', guestCount);
      toast.success(`Mesa ${table.number} abierta`, `${guestCount} comensales`);
      setView('detail');
    } catch { toast.error('Error al abrir la mesa'); }
    finally { setLoading(false); }
  };

  const handleRequestBill = async () => {
    setLoading(true);
    try {
      await onStatusChange(table.id, 'bill-requested');
      toast.info(`Mesa ${table.number}`, 'Cuenta solicitada');
    } catch { toast.error('Error al solicitar la cuenta'); }
    finally { setLoading(false); }
  };

  const handleCloseTable = async () => {
    setLoading(true);
    try {
      await onCloseTable(table.id);
      toast.success(`Mesa ${table.number} cerrada`, `Total cobrado: $${total.toFixed(2)}`);
    } catch { toast.error('Error al cerrar la mesa'); }
    finally { setLoading(false); }
  };

  const statusColor = table.status === 'available' ? 'text-emerald-400' : table.status === 'occupied' ? 'text-red-400' : 'text-amber-400';
  const statusLabel = table.status === 'available' ? 'Libre' : table.status === 'occupied' ? 'Ocupada' : 'Cuenta pedida';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[#1E293B] rounded-2xl border border-gray-700/80 w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="bg-[#0F172A] px-6 py-4 border-b border-gray-700/80 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
              <span className="text-lg font-black text-white">{table.number}</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-white">Mesa {table.number}</h3>
                <span className={`text-xs font-medium ${statusColor}`}>· {statusLabel}</span>
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                {table.guestCount ? (
                  <span className="flex items-center gap-1 text-xs text-gray-400">
                    <Users className="w-3 h-3" />{table.guestCount} comensales
                  </span>
                ) : null}
                {table.status !== 'available' && (
                  <span className="flex items-center gap-1 text-xs text-amber-400 font-mono">
                    <Clock className="w-3 h-3" />{fmt(elapsedTime)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {table.status !== 'available' && view === 'detail' && (
              <button onClick={() => setView('add-order')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium rounded-xl transition-colors">
                <Plus className="w-3.5 h-3.5" />Agregar pedido
              </button>
            )}
            {view !== 'detail' && (
              <button onClick={() => setView('detail')}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium rounded-xl transition-colors">
                ← Volver
              </button>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-gray-800 rounded-xl transition-colors">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>

        {/* SEAT GUESTS VIEW */}
        {view === 'seat-guests' && (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center max-w-sm">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 flex items-center justify-center mx-auto mb-4">
                <Users className="w-8 h-8 text-emerald-400" />
              </div>
              <h4 className="text-lg font-semibold text-white mb-1">¿Cuántos comensales?</h4>
              <p className="text-sm text-gray-400 mb-8">Mesa {table.number} está libre</p>
              <div className="flex items-center justify-center gap-6 mb-8">
                <button onClick={() => setGuestCount(Math.max(1, guestCount - 1))}
                  className="w-12 h-12 rounded-full bg-gray-700 hover:bg-gray-600 text-white text-xl font-bold transition-colors flex items-center justify-center">
                  <Minus className="w-5 h-5" />
                </button>
                <span className="text-5xl font-black text-white w-16 text-center">{guestCount}</span>
                <button onClick={() => setGuestCount(Math.min(20, guestCount + 1))}
                  className="w-12 h-12 rounded-full bg-gray-700 hover:bg-gray-600 text-white text-xl font-bold transition-colors flex items-center justify-center">
                  <Plus className="w-5 h-5" />
                </button>
              </div>
              <button onClick={handleSeatGuests} disabled={loading}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                {loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                Abrir mesa
              </button>
            </div>
          </div>
        )}

        {/* ADD ORDER VIEW */}
        {view === 'add-order' && (
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex gap-1 px-4 pt-4 border-b border-gray-700/50 pb-0">
                {categories.map(cat => (
                  <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
                    className={`px-3 py-2 text-xs font-medium rounded-t-lg transition-colors relative ${activeCategory === cat.id ? 'text-emerald-400 bg-gray-800/60' : 'text-gray-500 hover:text-gray-300'}`}>
                    {cat.label}
                    {activeCategory === cat.id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 gap-2 content-start">
                {menuItems.filter(i => i.category === activeCategory).map(item => (
                  <div key={item.id} className={`bg-[#0F172A] border rounded-xl p-3 flex flex-col gap-2 transition-colors ${item.stock === 'out-of-stock' ? 'opacity-40 border-gray-700' : 'border-gray-700 hover:border-gray-600'}`}>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-white leading-tight">{item.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5 leading-tight">{item.description}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-emerald-400">${item.price.toFixed(2)}</span>
                      {item.stock === 'out-of-stock' ? (
                        <span className="text-xs text-red-400">Sin stock</span>
                      ) : cart[item.id] ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => updateCart(item.id, -1)} className="w-6 h-6 rounded-lg bg-gray-700 hover:bg-gray-600 text-white flex items-center justify-center transition-colors"><Minus className="w-3 h-3" /></button>
                          <span className="w-5 text-center text-sm font-bold text-white">{cart[item.id]}</span>
                          <button onClick={() => updateCart(item.id, 1)} className="w-6 h-6 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center transition-colors"><Plus className="w-3 h-3" /></button>
                        </div>
                      ) : (
                        <button onClick={() => updateCart(item.id, 1)} className="w-7 h-7 rounded-lg bg-gray-700 hover:bg-emerald-500 text-white flex items-center justify-center transition-colors">
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Cart sidebar */}
            <div className="w-56 border-l border-gray-700/50 flex flex-col bg-[#0F172A]/50">
              <div className="p-3 border-b border-gray-700/50">
                <p className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
                  <ShoppingCart className="w-3.5 h-3.5" />Pedido actual
                  {cartCount > 0 && <span className="ml-auto bg-emerald-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{cartCount}</span>}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {Object.entries(cart).length === 0 ? (
                  <p className="text-xs text-gray-600 text-center mt-4">Sin ítems</p>
                ) : Object.entries(cart).map(([id, qty]) => {
                  const item = menuItems.find(i => i.id === Number(id));
                  if (!item) return null;
                  return (
                    <div key={id} className="flex items-center gap-2">
                      <span className="text-xs text-white font-medium w-4 text-right flex-shrink-0">{qty}×</span>
                      <span className="text-xs text-gray-300 flex-1 leading-tight">{item.name}</span>
                      <span className="text-xs text-emerald-400 flex-shrink-0">${(item.price * qty).toFixed(0)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="p-3 border-t border-gray-700/50 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Total</span>
                  <span className="font-bold text-white">${cartTotal.toFixed(2)}</span>
                </div>
                <button onClick={handleSendOrder} disabled={!cartCount || loading}
                  className="w-full py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-1.5">
                  {loading && <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  Enviar pedido
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DETAIL VIEW */}
        {view === 'detail' && (
          <div className="flex-1 overflow-hidden flex">
            {/* Orders */}
            <div className="flex-1 overflow-y-auto p-6">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Pedidos de la mesa</h4>
              {!table.orders?.length ? (
                <div className="h-32 flex flex-col items-center justify-center gap-2 bg-[#0F172A] rounded-xl border border-gray-700/50">
                  <UtensilsCrossed className="w-8 h-8 text-gray-700" />
                  <p className="text-sm text-gray-500">Sin pedidos todavía</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {table.orders.map((order, idx) => (
                    <div key={idx} className="flex items-center gap-3 px-4 py-3 bg-[#0F172A] rounded-xl border border-gray-700/50">
                      <span className="text-xs text-gray-500 w-5 text-right flex-shrink-0">{order.quantity}×</span>
                      <span className="text-sm text-white flex-1">{order.item}</span>
                      <span className="text-sm font-medium text-white">${(order.price * order.quantity).toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700 mt-3 pt-4">
                    <span className="text-sm font-semibold text-gray-300">Total</span>
                    <span className="text-xl font-black text-emerald-400">${total.toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="w-52 border-l border-gray-700/50 p-4 flex flex-col gap-2 flex-shrink-0">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Acciones</p>

              {table.status === 'available' && (
                <button onClick={() => setView('seat-guests')}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl transition-colors">
                  <Users className="w-4 h-4" />Sentar comensales
                </button>
              )}

              {table.status === 'occupied' && (
                <>
                  <button onClick={() => setView('add-order')}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl transition-colors">
                    <Plus className="w-4 h-4" />Agregar pedido
                  </button>
                  <button onClick={handleRequestBill} disabled={loading}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60">
                    <CheckCircle className="w-4 h-4" />Pedir cuenta
                  </button>
                </>
              )}

              {(table.status === 'bill-requested' || table.status === 'occupied') && (
                <button onClick={handleCloseTable} disabled={loading}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60">
                  {loading
                    ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    : <Printer className="w-4 h-4" />}
                  Cerrar mesa
                </button>
              )}

              {table.orders && table.orders.length > 0 && (
                <div className="mt-auto pt-3 border-t border-gray-700/50">
                  <p className="text-xs text-gray-500 mb-1">Total acumulado</p>
                  <p className="text-xl font-black text-emerald-400">${total.toFixed(2)}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
