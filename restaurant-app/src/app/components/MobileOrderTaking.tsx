import { useState } from 'react';
import { Plus, Minus, ShoppingCart, ArrowLeft, Trash2, Check } from 'lucide-react';

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

export function MobileOrderTaking({ tableNumber, menuItems, onSendOrder, onBack }: MobileOrderTakingProps) {
  const [activeCategory, setActiveCategory] = useState('main-dishes');
  const [cart, setCart] = useState<Record<number, number>>({});
  const [showSummary, setShowSummary] = useState(false);
  const [guestCount, setGuestCount] = useState(2);

  const categories = [
    { id: 'main-dishes', label: 'Dishes' },
    { id: 'drinks', label: 'Drinks' },
    { id: 'appetizers', label: 'Appetizers' },
    { id: 'desserts', label: 'Desserts' },
  ];

  const filteredItems = menuItems.filter(item => item.category === activeCategory);

  const updateCart = (itemId: number, delta: number) => {
    setCart(prev => {
      const current = prev[itemId] || 0;
      const newValue = Math.max(0, current + delta);
      if (newValue === 0) {
        const { [itemId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [itemId]: newValue };
    });
  };

  const removeFromCart = (itemId: number) => {
    setCart(prev => {
      const { [itemId]: _, ...rest } = prev;
      return rest;
    });
  };

  const getCartItems = (): CartItem[] => {
    return Object.entries(cart).map(([itemId, quantity]) => {
      const item = menuItems.find(i => i.id === parseInt(itemId))!;
      return {
        id: item.id,
        name: item.name,
        price: item.price,
        quantity,
      };
    });
  };

  const getTotalItems = () => {
    return Object.values(cart).reduce((sum, qty) => sum + qty, 0);
  };

  const getTotalPrice = () => {
    return getCartItems().reduce((sum, item) => sum + (item.price * item.quantity), 0);
  };

  const handleConfirmOrder = () => {
    const orderItems = getCartItems().map(item => ({
      item: item.name,
      quantity: item.quantity,
      price: item.price,
    }));
    onSendOrder(orderItems);
    setCart({});
    setShowSummary(false);
  };

  if (showSummary) {
    const cartItems = getCartItems();

    return (
      <div className="flex-1 flex flex-col bg-[#121827]">
        <div className="sticky top-0 z-10 bg-[#0F172A] border-b border-gray-700 px-4 py-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowSummary(false)} className="p-2 hover:bg-gray-800 rounded-lg">
              <ArrowLeft className="w-5 h-5 text-white" />
            </button>
            <div>
              <h3 className="text-lg font-semibold text-white">Order Summary</h3>
              <p className="text-xs text-gray-400">Table {tableNumber} • {guestCount} guests</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4 bg-[#0F172A] border border-gray-700 rounded-lg p-4">
            <label className="block text-xs font-medium text-gray-400 mb-2">Number of Guests</label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setGuestCount(Math.max(1, guestCount - 1))}
                className="w-10 h-10 rounded-lg bg-gray-700 hover:bg-gray-600 flex items-center justify-center"
              >
                <Minus className="w-5 h-5 text-white" />
              </button>
              <span className="flex-1 text-center text-xl font-semibold text-white">{guestCount}</span>
              <button
                onClick={() => setGuestCount(guestCount + 1)}
                className="w-10 h-10 rounded-lg bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center"
              >
                <Plus className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {cartItems.map((item) => (
              <div key={item.id} className="bg-[#0F172A] border border-gray-700 rounded-lg p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h4 className="text-sm font-medium text-white">{item.name}</h4>
                    <p className="text-xs text-gray-400 mt-1">Qty: {item.quantity} × ${item.price.toFixed(2)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-white">${(item.price * item.quantity).toFixed(2)}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateCart(item.id, -1)}
                    className="w-8 h-8 rounded-lg bg-gray-700 hover:bg-gray-600 flex items-center justify-center"
                  >
                    <Minus className="w-4 h-4 text-white" />
                  </button>
                  <button
                    onClick={() => updateCart(item.id, 1)}
                    className="w-8 h-8 rounded-lg bg-gray-700 hover:bg-gray-600 flex items-center justify-center"
                  >
                    <Plus className="w-4 h-4 text-white" />
                  </button>
                  <button
                    onClick={() => removeFromCart(item.id)}
                    className="ml-auto w-8 h-8 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 flex items-center justify-center"
                  >
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 bg-[#0F172A] border border-emerald-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">Subtotal</span>
              <span className="text-sm text-white">${getTotalPrice().toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">Tax (10%)</span>
              <span className="text-sm text-white">${(getTotalPrice() * 0.1).toFixed(2)}</span>
            </div>
            <div className="pt-2 border-t border-gray-700 flex items-center justify-between">
              <span className="text-base font-semibold text-white">Total</span>
              <span className="text-xl font-bold text-emerald-500">${(getTotalPrice() * 1.1).toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="p-4 bg-[#0F172A] border-t border-gray-700">
          <button
            onClick={handleConfirmOrder}
            className="w-full flex items-center justify-center gap-2 px-4 py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors"
          >
            <Check className="w-5 h-5" />
            <span className="font-semibold">Confirm & Send to Kitchen</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#121827]">
      <div className="sticky top-0 z-10 bg-[#0F172A] border-b border-gray-700 px-4 py-4">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={onBack} className="p-2 hover:bg-gray-800 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <div>
            <h3 className="text-lg font-semibold text-white">Table {tableNumber}</h3>
            <p className="text-xs text-gray-400">Select items to order</p>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setActiveCategory(category.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                activeCategory === category.id
                  ? 'bg-emerald-500 text-white'
                  : 'bg-gray-800 text-gray-400'
              }`}
            >
              {category.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-24">
        {filteredItems.map((item) => (
          <div key={item.id} className="bg-[#0F172A] rounded-lg border border-gray-700 p-4">
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <h4 className="text-sm font-medium text-white">{item.name}</h4>
                <p className="text-xs text-gray-400 mt-1">{item.description}</p>
                <p className="text-sm font-semibold text-emerald-500 mt-2">${item.price.toFixed(2)}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={() => updateCart(item.id, -1)}
                disabled={!cart[item.id]}
                className="w-10 h-10 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:hover:bg-gray-700 flex items-center justify-center transition-colors"
              >
                <Minus className="w-5 h-5 text-white" />
              </button>
              <span className="flex-1 text-center text-lg font-semibold text-white">
                {cart[item.id] || 0}
              </span>
              <button
                onClick={() => updateCart(item.id, 1)}
                className="w-10 h-10 rounded-lg bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center transition-colors"
              >
                <Plus className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {getTotalItems() > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-[#121827] via-[#121827] to-transparent">
          <button
            onClick={() => setShowSummary(true)}
            className="w-full flex items-center justify-between px-4 py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors shadow-lg"
          >
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5" />
              <span className="font-semibold">{getTotalItems()} items</span>
            </div>
            <span className="font-bold">${getTotalPrice().toFixed(2)}</span>
          </button>
        </div>
      )}
    </div>
  );
}
