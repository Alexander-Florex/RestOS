import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import type { StaffMember } from '../lib/api';

interface Props {
  staff?: StaffMember;
  loading?: boolean;
  onClose: () => void;
  onSave: (data: Omit<StaffMember, 'id'> & { id?: number }) => void;
}

export function StaffModal({ staff, loading = false, onClose, onSave }: Props) {
  const [form, setForm] = useState({
    name: staff?.name ?? '',
    email: staff?.email ?? '',
    role: staff?.role ?? 'waiter' as StaffMember['role'],
    phone: staff?.phone ?? '',
    status: staff?.status ?? 'active' as StaffMember['status'],
  });

  const handleClose = useCallback(() => !loading && onClose(), [loading, onClose]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [handleClose]);

  const field = 'w-full px-3 py-2.5 bg-[#0F172A] border border-gray-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent placeholder-gray-600';
  const roles: StaffMember['role'][] = ['waiter', 'chef', 'manager', 'cashier'];
  const roleLabel = { waiter: 'Mozo', chef: 'Chef', manager: 'Manager', cashier: 'Cajero' };
  const roleColor = { waiter: 'border-blue-500/50 bg-blue-500/10 text-blue-400', chef: 'border-purple-500/50 bg-purple-500/10 text-purple-400', manager: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400', cashier: 'border-amber-500/50 bg-amber-500/10 text-amber-400' };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div className="bg-[#1E293B] rounded-2xl border border-gray-700/80 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-700/60 flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">{staff ? 'Editar empleado' : 'Agregar empleado'}</h3>
          <button onClick={handleClose} className="p-1.5 hover:bg-gray-700 rounded-xl transition-colors"><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); onSave({ ...form, ...(staff?.id && { id: staff.id }) }); }} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Nombre completo</label>
            <input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Juan García" className={field} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">Email</label>
              <input required type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="juan@resto.com" className={field} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">Teléfono</label>
              <input required value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="+54 11 0000-0000" className={field} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Rol</label>
            <div className="grid grid-cols-4 gap-2">
              {roles.map(role => (
                <button key={role} type="button" onClick={() => setForm({...form, role})}
                  className={`py-2 text-xs font-semibold rounded-xl border-2 transition-colors ${form.role === role ? roleColor[role] : 'border-gray-700 text-gray-500 hover:border-gray-600'}`}>{roleLabel[role]}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Estado</label>
            <div className="grid grid-cols-2 gap-2">
              {(['active','inactive'] as const).map(s => (
                <button key={s} type="button" onClick={() => setForm({...form, status: s})}
                  className={`py-2 text-xs font-semibold rounded-xl border-2 transition-colors ${form.status === s ? (s === 'active' ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400' : 'border-gray-500/50 bg-gray-500/10 text-gray-400') : 'border-gray-700 text-gray-500 hover:border-gray-600'}`}>
                  {s === 'active' ? 'Activo' : 'Inactivo'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={handleClose} disabled={loading} className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={loading} className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {staff ? 'Guardar cambios' : 'Crear empleado'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
