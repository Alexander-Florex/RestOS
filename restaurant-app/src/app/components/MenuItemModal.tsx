import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import type { MenuItem } from '../lib/api';

interface Props {
  item?: MenuItem;
  loading?: boolean;
  onClose: () => void;
  onSave: (data: Omit<MenuItem, 'id'> & { id?: number }) => void;
}

export function MenuItemModal({ item, loading = false, onClose, onSave }: Props) {
  const [form, setForm] = useState({
    name: item?.name ?? '',
    category: item?.category ?? 'main-dishes',
    price: item?.price ?? 0,
    description: item?.description ?? '',
    stock: item?.stock ?? 'in-stock' as MenuItem['stock'],
  });

  const handleClose = useCallback(() => !loading && onClose(), [loading, onClose]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [handleClose]);

  const field = 'w-full px-3 py-2.5 bg-[#0F172A] border border-gray-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent placeholder-gray-600';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div className="bg-[#1E293B] rounded-2xl border border-gray-700/80 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-700/60 flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">{item ? 'Editar ítem del menú' : 'Agregar ítem al menú'}</h3>
          <button onClick={handleClose} className="p-1.5 hover:bg-gray-700 rounded-xl transition-colors"><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); onSave({ ...form, ...(item?.id && { id: item.id }) }); }} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Nombre del ítem</label>
            <input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="ej. Pizza Margherita" className={field} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">Categoría</label>
              <select value={form.category} onChange={e => setForm({...form, category: e.target.value})} className={field}>
                <option value="main-dishes">Platos</option>
                <option value="drinks">Bebidas</option>
                <option value="appetizers">Entradas</option>
                <option value="desserts">Postres</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">Precio ($)</label>
              <input required type="number" step="0.01" min="0" value={form.price} onChange={e => setForm({...form, price: parseFloat(e.target.value) || 0})} placeholder="0.00" className={field} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Descripción</label>
            <textarea required value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={2} placeholder="Breve descripción del plato..." className={`${field} resize-none`} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Stock</label>
            <div className="grid grid-cols-3 gap-2">
              {([['in-stock','Disponible','border-emerald-500/50 bg-emerald-500/10 text-emerald-400'],['low-stock','Stock bajo','border-amber-500/50 bg-amber-500/10 text-amber-400'],['out-of-stock','Sin stock','border-red-500/50 bg-red-500/10 text-red-400']] as const).map(([val, label, cls]) => (
                <button key={val} type="button" onClick={() => setForm({...form, stock: val})}
                  className={`py-2 text-xs font-semibold rounded-xl border-2 transition-colors ${form.stock === val ? cls : 'border-gray-700 text-gray-500 hover:border-gray-600'}`}>{label}</button>
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={handleClose} disabled={loading} className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={loading} className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {item ? 'Guardar cambios' : 'Crear ítem'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
