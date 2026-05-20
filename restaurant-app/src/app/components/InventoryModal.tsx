import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import type { InventoryItem } from '../lib/api';

interface Props {
  item?: InventoryItem;
  loading?: boolean;
  onClose: () => void;
  onSave: (data: Omit<InventoryItem, 'id'> & { id?: number }) => void;
}

export function InventoryModal({ item, loading = false, onClose, onSave }: Props) {
  const [form, setForm] = useState({
    name: item?.name ?? '',
    category: item?.category ?? 'food' as InventoryItem['category'],
    quantity: item?.quantity ?? 0,
    unit: item?.unit ?? 'kg',
    minStock: item?.minStock ?? 0,
    supplier: item?.supplier ?? '',
    lastRestocked: item?.lastRestocked ?? new Date().toISOString().split('T')[0],
  });

  const handleClose = useCallback(() => !loading && onClose(), [loading, onClose]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [handleClose]);

  const field = 'w-full px-3 py-2.5 bg-[#0F172A] border border-gray-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent placeholder-gray-600';
  const cats: InventoryItem['category'][] = ['food','beverage','supplies','equipment'];
  const catLabel = { food: 'Comida', beverage: 'Bebida', supplies: 'Suministros', equipment: 'Equipamiento' };
  const units = ['kg','g','L','ml','pcs','box','bottle','lata'];

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div className="bg-[#1E293B] rounded-2xl border border-gray-700/80 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-[#1E293B] px-6 py-4 border-b border-gray-700/60 flex items-center justify-between z-10">
          <h3 className="text-base font-semibold text-white">{item ? 'Editar ítem' : 'Agregar al inventario'}</h3>
          <button onClick={handleClose} className="p-1.5 hover:bg-gray-700 rounded-xl transition-colors"><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); onSave({ ...form, ...(item?.id && { id: item.id }) }); }} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Nombre del ítem</label>
            <input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="ej. Tomates" className={field} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Categoría</label>
            <div className="grid grid-cols-4 gap-2">
              {cats.map(cat => (
                <button key={cat} type="button" onClick={() => setForm({...form, category: cat})}
                  className={`py-2 text-xs font-semibold rounded-xl border-2 transition-colors ${form.category === cat ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400' : 'border-gray-700 text-gray-500 hover:border-gray-600'}`}>{catLabel[cat]}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">Cantidad</label>
              <input required type="number" min="0" step="0.1" value={form.quantity} onChange={e => setForm({...form, quantity: parseFloat(e.target.value) || 0})} className={field} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">Unidad</label>
              <select value={form.unit} onChange={e => setForm({...form, unit: e.target.value})} className={field}>
                {units.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Stock mínimo</label>
            <input required type="number" min="0" step="0.1" value={form.minStock} onChange={e => setForm({...form, minStock: parseFloat(e.target.value) || 0})} className={field} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Proveedor</label>
            <input required value={form.supplier} onChange={e => setForm({...form, supplier: e.target.value})} placeholder="Nombre del proveedor" className={field} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Último restock</label>
            <input required type="date" value={form.lastRestocked} onChange={e => setForm({...form, lastRestocked: e.target.value})} className={field} />
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
