import { useState } from 'react';
import { Plus, Minus, ShoppingCart } from 'lucide-react';

interface MenuItem {
  id: number;
  name: string;
  category: string;
  price: number;
  description: string;
}

interface MobileMenuScreenProps {
  onSendOrder: (items: Array<{ item: string; quantity: number; price: number }>) => void;
}

export function MobileMenuScreen({ onSendOrder }: MobileMenuScreenProps) {
  const [activeCategory, setActiveCategory] = useState('main-dishes');
  const [cart, setCart] = useState<Record<number, number>>({});

  const categories = [
    { id: 'main-dishes', label: 'Dishes' },
    { id: 'drinks', label: 'Drinks' },
    { id: 'appetizers', label: 'Appetizers' },
    { id: 'desserts', label: 'Desserts' },
  ];

  const menuItems: MenuItem[] = [
    { id: 1, name: 'Margherita Pizza', category: 'main-dishes', price: 18.50, description: 'Fresh mozzarella and basil' },
    { id: 2, name: 'Pasta Carbonara', category: 'main-dishes', price: 16.99, description: 'Creamy pasta with bacon' },
    { id: 3, name: 'Grilled Salmon', category: 'main-dishes', price: 24.99, description: 'Atlantic salmon with herbs' },
    { id: 4, name: 'Steak Medium Rare', category: 'main-dishes', price: 32.99, description: 'Premium beef cut' },
    { id: 5, name: 'House Wine', category: 'drinks', price: 8.50, description: 'Red or white' },
    { id: 6, name: 'Sparkling Water', category: 'drinks', price: 3.99, description: 'San Pellegrino' },
    { id: 7, name: 'Iced Tea', category: 'drinks', price: 3.50, description: 'Freshly brewed' },
    { id: 8, name: 'Caesar Salad', category: 'appetizers', price: 12.99, description: 'Romaine lettuce with parmesan' },
    { id: 9, name: 'French Fries', category: 'appetizers', price: 5.99, description: 'Crispy golden fries' },
    { id: 10, name: 'Tiramisu', category: 'desserts', price: 7.99, description: 'Classic Italian dessert' },
    { id: 11, name: 'Chocolate Cake', category: 'desserts', price: 8.50, description: 'Rich chocolate layers' },
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

  const getTotalItems = () => {
    return Object.values(cart).reduce((sum, qty) => sum + qty, 0);
  };

  const handleSendOrder = () => {
    const orderItems = Object.entries(cart).map(([itemId, quantity]) => {
      const item = menuItems.find(i => i.id === parseInt(itemId))!;
      return {
        item: item.name,
        quantity,
        price: item.price,
      };
    });
    onSendOrder(orderItems);
    setCart({});
  };

  return (
    <div className="flex-1 flex flex-col pb-20">
      <div className="sticky top-[57px] z-10 bg-[#121827] border-b border-gray-700 px-4 py-3">
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

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
        <div className="fixed bottom-16 left-0 right-0 p-4 bg-gradient-to-t from-[#121827] via-[#121827] to-transparent">
          <button
            onClick={handleSendOrder}
            className="w-full flex items-center justify-center gap-2 px-4 py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors shadow-lg"
          >
            <ShoppingCart className="w-5 h-5" />
            <span className="font-semibold">Send to Kitchen ({getTotalItems()} items)</span>
          </button>
        </div>
      )}
    </div>
  );
}
