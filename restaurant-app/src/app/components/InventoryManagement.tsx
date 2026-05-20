import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, AlertTriangle, Search, Package, TrendingUp, TrendingDown } from 'lucide-react';
import { InventoryModal } from './InventoryModal';
import { ConfirmDialog } from './ConfirmDialog';
import { useToast } from '../lib/toast';
import { inventoryApi } from '../lib/api';
import type { InventoryItem } from '../lib/api';

export function InventoryManagement() {
  const toast = useToast();
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'ok' | 'low' | 'critical'>('all');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    inventoryApi.getAll().then(setInventory).catch(() => toast.error('Error al cargar inventario')).finally(() => setLoading(false));
  }, []);

  const getStatus = (item: InventoryItem): 'critical' | 'low' | 'ok' => {
    if (item.quantity <= item.minStock / 2) return 'critical';
    if (item.quantity <= item.minStock) return 'low';
    return 'ok';
  };

  const statusBadge = (item: InventoryItem) => {
    const s = getStatus(item);
    if (s === 'critical') return <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/30 rounded-full"><AlertTriangle className="w-3 h-3" />Crítico</span>;
    if (s === 'low')      return <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-full"><TrendingDown className="w-3 h-3" />Stock bajo</span>;
    return <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-full"><TrendingUp className="w-3 h-3" />OK</span>;
  };

  const stats = {
    ok:       inventory.filter(i => getStatus(i) === 'ok').length,
    low:      inventory.filter(i => getStatus(i) === 'low').length,
    critical: inventory.filter(i => getStatus(i) === 'critical').length,
  };

  const filtered = inventory
    .filter(i => filterStatus === 'all' || getStatus(i) === filterStatus)
    .filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()) || i.supplier.toLowerCase().includes(search.toLowerCase()));

  const handleSave = async (data: Omit<InventoryItem, 'id'> & { id?: number }) => {
    setSaving(true);
    try {
      if (data.id) {
        const updated = await inventoryApi.update(data.id, data);
        setInventory(prev => prev.map(i => i.id === updated.id ? updated : i));
        toast.success('Ítem actualizado', data.name);
      } else {
        const created = await inventoryApi.create(data as Omit<InventoryItem, 'id'>);
        setInventory(prev => [...prev, created]);
        toast.success('Ítem creado', data.name);
      }
      setShowModal(false); setEditingItem(undefined);
    } catch { toast.error('Error al guardar'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await inventoryApi.remove(deleteTarget.id);
      setInventory(prev => prev.filter(i => i.id !== deleteTarget.id));
      toast.success('Ítem eliminado', deleteTarget.name);
      setDeleteTarget(null);
    } catch { toast.error('Error al eliminar'); }
    finally { setDeleting(false); }
  };

  if (loading) return (
    <div className="p-8 flex items-center justify-center h-64">
      <div className="flex items-center gap-3 text-gray-500">
        <span className="w-5 h-5 border-2 border-gray-600 border-t-emerald-500 rounded-full animate-spin" />
        Cargando inventario...
      </div>
    </div>
  );

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xl font-semibold text-white">Inventario</h3>
          <p className="text-sm text-gray-400 mt-0.5">{inventory.length} ítems · {stats.critical + stats.low} requieren atención</p>
        </div>
        <button onClick={() => { setEditingItem(undefined); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl transition-colors">
          <Plus className="w-4 h-4" />Agregar ítem
        </button>
      </div>

      {/* Stats mini */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { key: 'ok',       label: 'En stock',   color: 'border-emerald-500/20 text-emerald-400', count: stats.ok },
          { key: 'low',      label: 'Stock bajo',  color: 'border-amber-500/20 text-amber-400',   count: stats.low },
          { key: 'critical', label: 'Crítico',     color: 'border-red-500/20 text-red-400',       count: stats.critical },
        ].map(s => (
          <button key={s.key} onClick={() => setFilterStatus(filterStatus === s.key as any ? 'all' : s.key as any)}
            className={`bg-[#0F172A] border rounded-xl p-3 flex items-center gap-3 text-left transition-colors hover:border-gray-600 ${filterStatus === s.key ? 'ring-1 ring-emerald-500' : ''} ${s.color}`}>
            <span className="text-2xl font-black">{s.count}</span>
            <span className="text-xs font-medium text-gray-400">{s.label}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar ítem o proveedor..."
          className="w-full pl-9 pr-4 py-2 bg-[#0F172A] border border-gray-700 text-white text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-gray-600" />
      </div>

      {/* Table */}
      <div className="bg-[#0F172A] rounded-xl border border-gray-700/60 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-600">
            <Package className="w-10 h-10" />
            <p className="text-sm">No se encontraron ítems</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700/60">
                {['Ítem','Categoría','Cantidad','Mínimo','Estado','Proveedor','Acciones'].map(h => (
                  <th key={h} className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider ${h === 'Acciones' ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/40">
              {filtered.map(item => (
                <tr key={item.id} className="hover:bg-white/[0.02] transition-colors group">
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      {getStatus(item) !== 'ok' && <AlertTriangle className={`w-3.5 h-3.5 flex-shrink-0 ${getStatus(item) === 'critical' ? 'text-red-400' : 'text-amber-400'}`} />}
                      <span className="text-sm font-medium text-white">{item.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5"><span className="text-xs text-gray-400 capitalize">{item.category}</span></td>
                  <td className="px-4 py-3.5">
                    <span className={`text-sm font-bold ${getStatus(item) === 'critical' ? 'text-red-400' : getStatus(item) === 'low' ? 'text-amber-400' : 'text-white'}`}>
                      {item.quantity} <span className="text-xs font-normal text-gray-500">{item.unit}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3.5"><span className="text-xs text-gray-500">{item.minStock} {item.unit}</span></td>
                  <td className="px-4 py-3.5">{statusBadge(item)}</td>
                  <td className="px-4 py-3.5"><span className="text-xs text-gray-400">{item.supplier}</span></td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setEditingItem(item); setShowModal(true); }}
                        className="p-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"><Edit className="w-3.5 h-3.5" /></button>
                      <button onClick={() => setDeleteTarget(item)}
                        className="p-1.5 bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 rounded-lg transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <InventoryModal item={editingItem} loading={saving} onClose={() => { setShowModal(false); setEditingItem(undefined); }} onSave={handleSave} />
      )}
      {deleteTarget && (
        <ConfirmDialog title="¿Eliminar ítem?" message={`"${deleteTarget.name}" será eliminado permanentemente.`}
          confirmLabel="Sí, eliminar" loading={deleting} onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
      )}
    </div>
  );
}
