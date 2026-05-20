import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Mail, Phone, Search, Users } from 'lucide-react';
import { StaffModal } from './StaffModal';
import { ConfirmDialog } from './ConfirmDialog';
import { useToast } from '../lib/toast';
import { staffApi } from '../lib/api';
import type { StaffMember } from '../lib/api';

const ROLE_META: Record<StaffMember['role'], { label: string; color: string }> = {
  waiter:  { label: 'Mozo',     color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  chef:    { label: 'Chef',     color: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  manager: { label: 'Manager',  color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  cashier: { label: 'Cajero',   color: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
};

export function StaffManagement() {
  const toast = useToast();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<StaffMember | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    staffApi.getAll().then(setStaff).catch(() => toast.error('Error al cargar el personal')).finally(() => setLoading(false));
  }, []);

  const filtered = staff
    .filter(s => filterRole === 'all' || s.role === filterRole)
    .filter(s => !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.email.toLowerCase().includes(search.toLowerCase()));

  const handleSave = async (data: Omit<StaffMember, 'id'> & { id?: number }) => {
    setSaving(true);
    try {
      if (data.id) {
        const updated = await staffApi.update(data.id, data);
        setStaff(prev => prev.map(s => s.id === updated.id ? updated : s));
        toast.success('Empleado actualizado', data.name);
      } else {
        const created = await staffApi.create(data as Omit<StaffMember, 'id'>);
        setStaff(prev => [...prev, created]);
        toast.success('Empleado creado', data.name);
      }
      setShowModal(false); setEditingStaff(undefined);
    } catch { toast.error('Error al guardar'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await staffApi.remove(deleteTarget.id);
      setStaff(prev => prev.filter(s => s.id !== deleteTarget.id));
      toast.success('Empleado eliminado', deleteTarget.name);
      setDeleteTarget(null);
    } catch { toast.error('Error al eliminar'); }
    finally { setDeleting(false); }
  };

  const handleToggleStatus = async (member: StaffMember) => {
    try {
      const updated = await staffApi.update(member.id, { status: member.status === 'active' ? 'inactive' : 'active' });
      setStaff(prev => prev.map(s => s.id === updated.id ? updated : s));
      toast.info('Estado actualizado', member.name);
    } catch { toast.error('Error al actualizar estado'); }
  };

  if (loading) return (
    <div className="p-8 flex items-center justify-center h-64">
      <div className="flex items-center gap-3 text-gray-500">
        <span className="w-5 h-5 border-2 border-gray-600 border-t-emerald-500 rounded-full animate-spin" />
        Cargando personal...
      </div>
    </div>
  );

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xl font-semibold text-white">Personal</h3>
          <p className="text-sm text-gray-400 mt-0.5">
            {staff.filter(s => s.status === 'active').length} activos · {staff.filter(s => s.status === 'inactive').length} inactivos
          </p>
        </div>
        <button onClick={() => { setEditingStaff(undefined); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl transition-colors">
          <Plus className="w-4 h-4" />Agregar empleado
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..."
            className="pl-9 pr-4 py-2 bg-[#0F172A] border border-gray-700 text-white text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-gray-600 w-52" />
        </div>
        <div className="flex gap-1">
          {[{ id: 'all', label: 'Todos' }, ...Object.entries(ROLE_META).map(([id, m]) => ({ id, label: m.label }))].map(opt => (
            <button key={opt.id} onClick={() => setFilterRole(opt.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${filterRole === opt.id ? 'bg-emerald-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'}`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3 bg-[#0F172A] rounded-xl border border-gray-700/60 text-gray-600">
          <Users className="w-10 h-10" />
          <p className="text-sm">No se encontraron empleados</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(member => {
            const meta = ROLE_META[member.role];
            return (
              <div key={member.id} className="bg-[#0F172A] rounded-xl border border-gray-700/60 p-5 hover:border-gray-600 transition-colors group">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-white">{member.name.split(' ').map(n => n[0]).join('').slice(0,2)}</span>
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-white leading-tight">{member.name}</h4>
                      <span className={`inline-block mt-1 px-2 py-0.5 text-[11px] font-semibold border rounded-full ${meta.color}`}>{meta.label}</span>
                    </div>
                  </div>
                  <button onClick={() => handleToggleStatus(member)}
                    className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 cursor-pointer transition-colors ${member.status === 'active' ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]' : 'bg-gray-600'}`}
                    title={member.status === 'active' ? 'Activo — clic para desactivar' : 'Inactivo — clic para activar'} />
                </div>

                <div className="space-y-1.5 mb-4">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Mail className="w-3.5 h-3.5 flex-shrink-0" /><span className="truncate">{member.email}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Phone className="w-3.5 h-3.5 flex-shrink-0" /><span>{member.phone}</span>
                  </div>
                </div>

                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setEditingStaff(member); setShowModal(true); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium rounded-lg transition-colors">
                    <Edit className="w-3.5 h-3.5" />Editar
                  </button>
                  <button onClick={() => setDeleteTarget(member)}
                    className="p-1.5 bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 rounded-lg transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <StaffModal staff={editingStaff} loading={saving} onClose={() => { setShowModal(false); setEditingStaff(undefined); }} onSave={handleSave} />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title="¿Eliminar empleado?"
          message={`${deleteTarget.name} será eliminado permanentemente.`}
          confirmLabel="Sí, eliminar"
          loading={deleting}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
