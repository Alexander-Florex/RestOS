import { useState } from 'react';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { TableManagementModal } from './TableManagementModal';
import { ConfirmDialog } from './ConfirmDialog';
import { useToast } from '../lib/toast';
import { tablesApi } from '../lib/api';
import type { Table } from '../lib/api';

interface Props {
  tables: Table[];
  onUpdate: (tables: Table[]) => void;
}

export function TableManagement({ tables, onUpdate }: Props) {
  const toast = useToast();
  const [showModal, setShowModal] = useState(false);
  const [editingTable, setEditingTable] = useState<Table | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<Table | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);

  const statusMeta = {
    available:     { label: 'Libre',        dot: 'bg-emerald-400' },
    occupied:      { label: 'Ocupada',      dot: 'bg-red-400' },
    'bill-requested': { label: 'Cuenta',    dot: 'bg-amber-400' },
  };

  const handleSave = async (data: Partial<Table> & { id?: number }) => {
    setSaving(true);
    try {
      if (data.id) {
        const updated = await tablesApi.update(data.id, data);
        onUpdate(tables.map(t => t.id === updated.id ? updated : t));
        toast.success('Mesa actualizada', `Mesa ${updated.number}`);
      } else {
        const created = await tablesApi.create({ ...data, orders: [], guestCount: null, occupiedTime: null } as any);
        onUpdate([...tables, created]);
        toast.success('Mesa creada', `Mesa ${created.number}`);
      }
      setShowModal(false); setEditingTable(undefined);
    } catch { toast.error('Error al guardar la mesa'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await tablesApi.remove(deleteTarget.id);
      onUpdate(tables.filter(t => t.id !== deleteTarget.id));
      toast.success('Mesa eliminada', `Mesa ${deleteTarget.number}`);
      setDeleteTarget(null);
    } catch { toast.error('Error al eliminar la mesa'); }
    finally { setDeleting(false); }
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xl font-semibold text-white">Configuración de mesas</h3>
          <p className="text-sm text-gray-400 mt-0.5">{tables.length} mesas configuradas</p>
        </div>
        <button onClick={() => { setEditingTable(undefined); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl transition-colors">
          <Plus className="w-4 h-4" />Agregar mesa
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {tables.map(table => {
          const meta = statusMeta[table.status] || statusMeta.available;
          return (
            <div key={table.id} className="bg-[#0F172A] rounded-xl border border-gray-700/60 p-4 hover:border-gray-600 transition-colors group">
              <div className="flex items-center justify-between mb-2">
                <div className={`w-2 h-2 rounded-full ${meta.dot}`} />
                <span className="text-[10px] text-gray-600">{meta.label}</span>
              </div>
              <div className="text-center my-3">
                <p className="text-3xl font-black text-white">{table.number}</p>
              </div>
              <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => { setEditingTable(table); setShowModal(true); }}
                  className="flex-1 p-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors flex items-center justify-center">
                  <Edit className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setDeleteTarget(table)}
                  className="p-1.5 bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 rounded-lg transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showModal && (
        <TableManagementModal table={editingTable} loading={saving}
          onClose={() => { setShowModal(false); setEditingTable(undefined); }}
          onSave={handleSave} />
      )}
      {deleteTarget && (
        <ConfirmDialog title="¿Eliminar mesa?" message={`Mesa ${deleteTarget.number} será eliminada permanentemente.`}
          confirmLabel="Sí, eliminar" loading={deleting} onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
      )}
    </div>
  );
}
