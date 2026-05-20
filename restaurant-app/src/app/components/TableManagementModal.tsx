import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import type { Table } from '../lib/api';

interface Props {
  table?: Table;
  loading?: boolean;
  onClose: () => void;
  onSave: (data: Partial<Table> & { id?: number }) => void;
}

export function TableManagementModal({ table, loading = false, onClose, onSave }: Props) {
  const [form, setForm] = useState({
    number: table?.number ?? 1,
    status: table?.status ?? 'available' as Table['status'],
  });

  const handleClose = useCallback(() => !loading && onClose(), [loading, onClose]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [handleClose]);

  const field = 'w-full px-3 py-2.5 bg-[#0F172A] border border-gray-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div className="bg-[#1E293B] rounded-2xl border border-gray-700/80 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-700/60 flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">{table ? 'Editar mesa' : 'Agregar mesa'}</h3>
          <button onClick={handleClose} className="p-1.5 hover:bg-gray-700 rounded-xl transition-colors"><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); onSave({ ...form, ...(table?.id && { id: table.id }) }); }} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Número de mesa</label>
            <input required type="number" min="1" value={form.number} onChange={e => setForm({...form, number: parseInt(e.target.value) || 1})} className={field} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Estado inicial</label>
            <div className="grid grid-cols-3 gap-2">
              {([['available','Libre','border-emerald-500/50 bg-emerald-500/10 text-emerald-400'],['occupied','Ocupada','border-red-500/50 bg-red-500/10 text-red-400'],['bill-requested','Cuenta','border-amber-500/50 bg-amber-500/10 text-amber-400']] as const).map(([val,label,cls]) => (
                <button key={val} type="button" onClick={() => setForm({...form, status: val})}
                  className={`py-2 text-xs font-semibold rounded-xl border-2 transition-colors ${form.status === val ? cls : 'border-gray-700 text-gray-500 hover:border-gray-600'}`}>{label}</button>
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={handleClose} disabled={loading} className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={loading} className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {table ? 'Guardar' : 'Crear mesa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
