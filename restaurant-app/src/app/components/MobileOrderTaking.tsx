import { useState } from 'react';
import { Plus, Minus, ShoppingCart, ArrowLeft, Trash2, Send, ChefHat, UtensilsCrossed, Coffee, IceCream } from 'lucide-react';

interface MenuItem {
  id: number;
  name: string;
  category: string;
  price: number;
  description: string;
}

interface CartItem {
  id: number;
  name: string;
  price: number;
  quantity: number;
}

interface MobileOrderTakingProps {
  tableNumber: number;
  menuItems: MenuItem[];
  onSendOrder: (items: Array<{ item: string; quantity: number; price: number }>) => void;
  onBack: () => void;
}

const CATEGORIES = [
  { id: 'main-dishes', label: 'Platos',     icon: ChefHat },
  { id: 'appetizers',  label: 'Entradas',   icon: UtensilsCrossed },
  { id: 'drinks',      label: 'Bebidas',    icon: Coffee },
  { id: 'desserts',    label: 'Postres',    icon: IceCream },
];

export function MobileOrderTaking({ tableNumber, menuItems, onSendOrder, onBack }: MobileOrderTakingProps) {
  const [activeCategory, setActiveCategory] = useState('main-dishes');
  const [cart, setCart] = useState<Record<number, number>>({});
  const [sending, setSending] = useState(false);

  const filteredItems = menuItems.filter(item => item.category === activeCategory);

  const updateCart = (itemId: number, delta: number) => {
    setCart(prev => {
      const next = Math.max(0, (prev[itemId] || 0) + delta);
      if (next === 0) { const { [itemId]: _, ...rest } = prev; return rest; }
      return { ...prev, [itemId]: next };
    });
  };

  const cartItems: CartItem[] = Object.entries(cart).map(([id, qty]) => {
    const m = menuItems.find(i => i.id === parseInt(id))!;
    return { id: m.id, name: m.name, price: m.price, quantity: qty };
  });

  const totalItems = cartItems.reduce((s, i) => s + i.quantity, 0);
  const totalPrice = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);

  const handleSend = async () => {
    if (!totalItems || sending) return;
    setSending(true);
    const payload = cartItems.map(i => ({ item: i.name, quantity: i.quantity, price: i.price }));
    await onSendOrder(payload);
    setCart({});
    setSending(false);
  };

  return (
    <div className="flex-1 flex flex-col bg-[#121827] h-full overflow-hidden">

      {/* Header */}
      <div className="bg-[#0F172A] border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-gray-800 transition-colors">
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>
        <div className="flex-1">
          <h3 className="text-base font-bold text-white">Mesa {tableNumber}</h3>
          <p className="text-xs text-gray-400">Seleccioná los items del pedido</p>
        </div>
        {totalItems > 0 && (
          <div className="flex items-center gap-1.5 bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 rounded-full">
            <ShoppingCart className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs font-bold text-emerald-400">{totalItems}</span>
          </div>
        )}
      </div>

      {/* Category tabs */}
      <div className="bg-[#0F172A] border-b border-gray-800 px-3 py-2 flex gap-1.5 overflow-x-auto scrollbar-hide">
        {CATEGORIES.map(cat => {
          const Icon = cat.icon;
          const count = menuItems.filter(m => m.category === cat.id).length;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                activeCategory === cat.id
                  ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                  : 'bg-gray-800/80 text-gray-400 hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {cat.label}
              <span className={`text-xs px-1 rounded-md ${activeCategory === cat.id ? 'bg-white/20' : 'bg-gray-700'}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Menu items */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 pb-40">
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-600">
            <ChefHat className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">Sin items en esta categoría</p>
          </div>
        ) : filteredItems.map(item => {
          const qty = cart[item.id] || 0;
          return (
            <div
              key={item.id}
              className={`bg-[#0F172A] rounded-xl border transition-all ${
                qty > 0 ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-gray-800'
              }`}
            >
              <div className="flex items-start gap-3 p-3.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold text-white leading-snug">{item.name}</h4>
                      <p className="text-xs text-gray-500 mt-0.5 leading-snug">{item.description}</p>
                    </div>
                    <span className="text-base font-bold text-emerald-400 whitespace-nowrap">${item.price.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Counter */}
              <div className="flex items-center gap-3 px-3.5 pb-3.5">
                <button
                  onClick={() => updateCart(item.id, -1)}
                  disabled={qty === 0}
                  className="w-9 h-9 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-30 flex items-center justify-center transition-colors"
                >
                  <Minus className="w-4 h-4 text-white" />
                </button>
                <span className={`flex-1 text-center text-lg font-bold transition-colors ${qty > 0 ? 'text-emerald-400' : 'text-gray-600'}`}>
                  {qty}
                </span>
                <button
                  onClick={() => updateCart(item.id, 1)}
                  className="w-9 h-9 rounded-lg bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center transition-colors"
                >
                  <Plus className="w-4 h-4 text-white" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom panel: cart summary + SEND BUTTON */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#0F172A] border-t border-gray-800 p-3 space-y-2.5">

        {/* Items in cart (compact list) */}
        {cartItems.length > 0 && (
          <div className="bg-[#1E293B] rounded-xl p-3 max-h-28 overflow-y-auto space-y-1">
            {cartItems.map(i => (
              <div key={i.id} className="flex items-center gap-2">
                <span className="text-xs font-bold text-emerald-400 w-5 text-center">{i.quantity}×</span>
                <span className="text-xs text-white flex-1 truncate">{i.name}</span>
                <span className="text-xs text-gray-400">${(i.price * i.quantity).toFixed(2)}</span>
                <button onClick={() => updateCart(i.id, -i.quantity)} className="text-gray-600 hover:text-red-400 transition-colors">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!totalItems || sending}
          className={`w-full flex items-center justify-between px-5 py-4 rounded-xl font-bold text-base transition-all ${
            totalItems
              ? 'bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] text-white shadow-lg shadow-emerald-500/25'
              : 'bg-gray-800 text-gray-600 cursor-not-allowed'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Send className="w-5 h-5" />
            <span>{sending ? 'Enviando...' : totalItems ? 'Enviar pedido' : 'Agregá items al pedido'}</span>
          </div>
          {totalItems > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium opacity-80">{totalItems} items</span>
              <span className="text-lg font-bold">${totalPrice.toFixed(2)}</span>
            </div>
          )}
        </button>
      </div>
    </div>
  );
}