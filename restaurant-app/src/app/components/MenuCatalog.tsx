import { useState, useEffect } from 'react';
import { Edit, Trash2, Plus, Search, UtensilsCrossed } from 'lucide-react';
import { MenuItemModal } from './MenuItemModal';
import { ConfirmDialog } from './ConfirmDialog';
import { useToast } from '../lib/toast';
import { menuApi } from '../lib/api';
import type { MenuItem } from '../lib/api';

export function MenuCatalog() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<MenuItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    menuApi.getAll().then(setMenuItems).catch(() => toast.error('Error al cargar el menú')).finally(() => setLoading(false));
  }, []);

  const tabs = [
    { id: 'all', label: 'Todos' },
    { id: 'main-dishes', label: 'Platos' },
    { id: 'drinks', label: 'Bebidas' },
    { id: 'appetizers', label: 'Entradas' },
    { id: 'desserts', label: 'Postres' },
  ];

  const stockBadge = (stock: MenuItem['stock']) => {
    if (stock === 'in-stock')   return <span className="px-2 py-0.5 text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-full">Disponible</span>;
    if (stock === 'low-stock')  return <span className="px-2 py-0.5 text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-full">Stock bajo</span>;
    return <span className="px-2 py-0.5 text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/30 rounded-full">Sin stock</span>;
  };

  const catLabel = (c: string) => ({ 'main-dishes': 'Plato', drinks: 'Bebida', appetizers: 'Entrada', desserts: 'Postre' }[c] || c);

  const filtered = menuItems
    .filter(i => activeTab === 'all' || i.category === activeTab)
    .filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()) || i.description.toLowerCase().includes(search.toLowerCase()));

  const handleSave = async (data: Omit<MenuItem, 'id'> & { id?: number }) => {
    setSaving(true);
    try {
      if (data.id) {
        const updated = await menuApi.update(data.id, data);
        setMenuItems(prev => prev.map(i => i.id === updated.id ? updated : i));
        toast.success('Ítem actualizado', data.name);
      } else {
        const created = await menuApi.create(data as Omit<MenuItem, 'id'>);
        setMenuItems(prev => [...prev, created]);
        toast.success('Ítem creado', data.name);
      }
      setShowModal(false);
      setEditingItem(undefined);
    } catch { toast.error('Error al guardar el ítem'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await menuApi.remove(deleteTarget.id);
      setMenuItems(prev => prev.filter(i => i.id !== deleteTarget.id));
      toast.success('Ítem eliminado', deleteTarget.name);
      setDeleteTarget(null);
    } catch { toast.error('Error al eliminar'); }
    finally { setDeleting(false); }
  };

  const handleToggleStock = async (item: MenuItem) => {
    const next = item.stock === 'in-stock' ? 'out-of-stock' : 'in-stock';
    try {
      const updated = await menuApi.update(item.id, { stock: next });
      setMenuItems(prev => prev.map(i => i.id === updated.id ? updated : i));
      toast.info('Stock actualizado', item.name);
    } catch { toast.error('Error al actualizar stock'); }
  };

  const handleToggleEnabled = async (item: MenuItem) => {
    try {
      const updated = await menuApi.update(item.id, { enabled: !item.enabled });
      setMenuItems(prev => prev.map(i => i.id === updated.id ? updated : i));
      toast.info(updated.enabled ? 'Habilitado en carta' : 'Deshabilitado de carta', item.name);
    } catch { toast.error('Error al actualizar'); }
  };

  if (loading) return (
    <div className="p-8 flex items-center justify-center h-64">
      <div className="flex items-center gap-3 text-gray-500">
        <span className="w-5 h-5 border-2 border-gray-600 border-t-emerald-500 rounded-full animate-spin" />
        Cargando menú...
      </div>
    </div>
  );

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xl font-semibold text-white">Catálogo de menú</h3>
          <p className="text-sm text-gray-400 mt-0.5">{menuItems.length} ítems · {menuItems.filter(i => i.stock === 'out-of-stock').length} sin stock</p>
        </div>
        <button onClick={() => { setEditingItem(undefined); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl transition-colors">
          <Plus className="w-4 h-4" />Agregar ítem
        </button>
      </div>

      {/* Search + Tabs */}
      <div className="flex items-center gap-4 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar ítem..."
            className="w-full pl-9 pr-4 py-2 bg-[#0F172A] border border-gray-700 text-white text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent placeholder-gray-600" />
        </div>
        <div className="flex gap-1 border-b border-gray-700/50 pb-0 flex-1 overflow-x-auto">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors relative flex-shrink-0 ${activeTab === tab.id ? 'text-emerald-400' : 'text-gray-500 hover:text-gray-300'}`}>
              {tab.label}
              {activeTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#0F172A] rounded-xl border border-gray-700/60 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-600">
            <UtensilsCrossed className="w-10 h-10" />
            <p className="text-sm">{search ? 'Sin resultados para esa búsqueda' : 'No hay ítems en esta categoría'}</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700/60">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Ítem</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Categoría</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Precio</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Stock</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">En carta</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/40">
              {filtered.map(item => (
                <tr key={item.id} className="hover:bg-white/[0.02] transition-colors group">
                  <td className="px-5 py-3.5">
                    <p className="text-sm font-medium text-white">{item.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-xs text-gray-400">{catLabel(item.category)}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-sm font-bold text-white">${item.price.toFixed(2)}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <button onClick={() => handleToggleStock(item)} className="group/badge">
                      {stockBadge(item.stock)}
                    </button>
                  </td>
                  <td className="px-5 py-3.5">
                    <button
                      onClick={() => handleToggleEnabled(item)}
                      title={item.enabled ? 'En carta · clic para deshabilitar' : 'Fuera de carta · clic para habilitar'}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${item.enabled ? 'bg-emerald-500' : 'bg-gray-600'}`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${item.enabled ? 'translate-x-4' : 'translate-x-1'}`} />
                    </button>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setEditingItem(item); setShowModal(true); }}
                        className="p-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors" title="Editar">
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeleteTarget(item)}
                        className="p-1.5 bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 rounded-lg transition-colors" title="Eliminar">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <MenuItemModal item={editingItem} loading={saving} onClose={() => { setShowModal(false); setEditingItem(undefined); }} onSave={handleSave} />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title="¿Eliminar ítem del menú?"
          message={`"${deleteTarget.name}" será eliminado permanentemente.`}
          confirmLabel="Sí, eliminar"
          loading={deleting}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
