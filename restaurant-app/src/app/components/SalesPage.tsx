import { useState, useEffect, useRef } from 'react';
import {
  DollarSign, CreditCard, Smartphone, Receipt, Clock, Hash,
  Upload, X, Trash2, Search, ChevronDown, ImageIcon, CheckCircle2,
  TrendingUp, Users, ShoppingBag
} from 'lucide-react';
import { useToast } from '../lib/toast';

// ── Types ───────────────────────────────────────────
interface Sale {
  id: number;
  tableNumber: number;
  paymentMethod: 'cash' | 'card' | 'transfer';
  amount: number;
  total: number;
  closedAt: string;
  notes?: string;
  imageBase64?: string;
  imageName?: string;
  registeredBy?: string;
  createdAt: string;
}

const PAYMENT_LABELS: Record<Sale['paymentMethod'], string> = {
  cash:     'Efectivo',
  card:     'Tarjeta',
  transfer: 'Transferencia',
};

const PAYMENT_COLORS: Record<Sale['paymentMethod'], string> = {
  cash:     'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  card:     'bg-blue-500/15 text-blue-400 border-blue-500/30',
  transfer: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
};

const PAYMENT_ICONS: Record<Sale['paymentMethod'], React.ElementType> = {
  cash:     DollarSign,
  card:     CreditCard,
  transfer: Smartphone,
};

// ── Helper ──────────────────────────────────────────
function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Component ────────────────────────────────────────
export function SalesPage({
  registeredBy,
  preFill,
  onPreFillUsed,
}: {
  registeredBy?: string;
  preFill?: { tableNumber: number; total: number };
  onPreFillUsed?: () => void;
}) {
  const toast = useToast();

  // State
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filterMethod, setFilterMethod] = useState<Sale['paymentMethod'] | 'all'>('all');
  const [showForm, setShowForm] = useState(!!preFill);
  const fileRef = useRef<HTMLInputElement>(null);

  // Form state — pre-cargado si viene de cerrar mesa
  const [form, setForm] = useState({
    tableNumber: preFill ? String(preFill.tableNumber) : '',
    paymentMethod: 'cash' as Sale['paymentMethod'],
    amount: preFill ? String(preFill.total) : '',
    total: preFill ? String(preFill.total) : '',
    closedAt: new Date().toISOString().slice(0, 16),
    notes: '',
  });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string>('');

  // Load
  useEffect(() => {
    fetch('/api/sales')
      .then(r => r.json())
      .then(setSales)
      .catch(() => toast.error('Error al cargar ventas'))
      .finally(() => setLoading(false));
  }, []);

  // Image handler
  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('La imagen no puede superar 5 MB'); return; }
    const b64 = await fileToBase64(file);
    setImageBase64(b64);
    setImagePreview(b64);
    setImageName(file.name);
  };

  const clearImage = () => {
    setImageBase64(null);
    setImagePreview(null);
    setImageName('');
    if (fileRef.current) fileRef.current.value = '';
  };

  // Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.tableNumber || !form.amount || !form.total) {
      toast.error('Completá todos los campos obligatorios');
      return;
    }
    setSaving(true);
    try {
      const body = {
        tableNumber: Number(form.tableNumber),
        paymentMethod: form.paymentMethod,
        amount: Number(form.amount),
        total: Number(form.total),
        closedAt: new Date(form.closedAt).toISOString(),
        notes: form.notes || undefined,
        imageBase64: imageBase64 || undefined,
        imageName: imageName || undefined,
        registeredBy,
      };
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Error al guardar');
      const newSale = await res.json();
      setSales(prev => [newSale, ...prev]);
      toast.success('Venta registrada', `Mesa ${form.tableNumber}`);
      setForm({ tableNumber: '', paymentMethod: 'cash', amount: '', total: '', closedAt: new Date().toISOString().slice(0, 16), notes: '' });
      clearImage();
      setShowForm(false);
      onPreFillUsed?.();
    } catch {
      toast.error('Error al registrar la venta');
    } finally {
      setSaving(false);
    }
  };

  // Delete
  const handleDelete = async (id: number) => {
    if (!confirm('¿Eliminar esta venta?')) return;
    await fetch(`/api/sales/${id}`, { method: 'DELETE' });
    setSales(prev => prev.filter(s => s.id !== id));
    toast.info('Venta eliminada');
  };

  // Filter
  const filtered = sales
    .filter(s => filterMethod === 'all' || s.paymentMethod === filterMethod)
    .filter(s => !search || String(s.tableNumber).includes(search) || (s.notes || '').toLowerCase().includes(search.toLowerCase()));

  // Stats
  const totalRevenue = filtered.reduce((sum, s) => sum + s.total, 0);
  const avgTicket = filtered.length ? totalRevenue / filtered.length : 0;
  const byMethod = (m: Sale['paymentMethod']) => filtered.filter(s => s.paymentMethod === m).length;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Registro de Ventas</h2>
          <p className="text-sm text-gray-400 mt-0.5">Historial de cuentas cerradas</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          <Receipt className="w-4 h-4" />
          {showForm ? 'Cancelar' : 'Nueva venta'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total recaudado', value: `$${totalRevenue.toFixed(2)}`, icon: TrendingUp, color: 'emerald' },
          { label: 'Ticket promedio',  value: `$${avgTicket.toFixed(2)}`,   icon: ShoppingBag, color: 'blue' },
          { label: 'Ventas',          value: String(filtered.length),        icon: Receipt,     color: 'purple' },
          { label: 'Mesas atendidas', value: String(new Set(filtered.map(s => s.tableNumber)).size), icon: Users, color: 'amber' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-[#0F172A] border border-gray-800 rounded-xl p-4">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-3 ${
              color === 'emerald' ? 'bg-emerald-500/15' : color === 'blue' ? 'bg-blue-500/15' : color === 'purple' ? 'bg-purple-500/15' : 'bg-amber-500/15'
            }`}>
              <Icon className={`w-4 h-4 ${
                color === 'emerald' ? 'text-emerald-400' : color === 'blue' ? 'text-blue-400' : color === 'purple' ? 'text-purple-400' : 'text-amber-400'
              }`} />
            </div>
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-xl font-bold text-white mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-[#0F172A] border border-emerald-500/30 rounded-2xl p-6">
          <h3 className="text-base font-semibold text-white mb-5 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            Registrar cierre de cuenta
          </h3>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              {/* Table # */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  <Hash className="inline w-3 h-3 mr-1" />Número de mesa *
                </label>
                <input
                  type="number" min="1"
                  value={form.tableNumber}
                  onChange={e => setForm(f => ({ ...f, tableNumber: e.target.value }))}
                  placeholder="Ej: 5"
                  className="w-full bg-[#1E293B] border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                  required
                />
              </div>

              {/* Payment method */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  <CreditCard className="inline w-3 h-3 mr-1" />Método de pago *
                </label>
                <div className="relative">
                  <select
                    value={form.paymentMethod}
                    onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value as Sale['paymentMethod'] }))}
                    className="w-full bg-[#1E293B] border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors appearance-none"
                  >
                    <option value="cash">Efectivo</option>
                    <option value="card">Tarjeta</option>
                    <option value="transfer">Transferencia</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  <DollarSign className="inline w-3 h-3 mr-1" />Monto pagado *
                </label>
                <input
                  type="number" min="0" step="0.01"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                  className="w-full bg-[#1E293B] border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                  required
                />
              </div>

              {/* Total */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  <Receipt className="inline w-3 h-3 mr-1" />Total de la cuenta *
                </label>
                <input
                  type="number" min="0" step="0.01"
                  value={form.total}
                  onChange={e => setForm(f => ({ ...f, total: e.target.value }))}
                  placeholder="0.00"
                  className="w-full bg-[#1E293B] border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                  required
                />
              </div>

              {/* Closed at */}
              <div className="col-span-2 md:col-span-1">
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  <Clock className="inline w-3 h-3 mr-1" />Hora y fecha de cierre *
                </label>
                <input
                  type="datetime-local"
                  value={form.closedAt}
                  onChange={e => setForm(f => ({ ...f, closedAt: e.target.value }))}
                  className="w-full bg-[#1E293B] border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                  required
                />
              </div>

              {/* Notes */}
              <div className="col-span-2 md:col-span-1">
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Notas (opcional)</label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Observaciones..."
                  className="w-full bg-[#1E293B] border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            </div>

            {/* Image upload */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                <ImageIcon className="inline w-3 h-3 mr-1" />Imagen adjunta (ticket, comprobante, etc.)
              </label>
              {imagePreview ? (
                <div className="relative w-full bg-[#1E293B] border border-gray-700 rounded-xl overflow-hidden">
                  <img src={imagePreview} alt="preview" className="max-h-48 w-auto mx-auto object-contain p-2" />
                  <div className="flex items-center justify-between px-4 py-2 border-t border-gray-700">
                    <span className="text-xs text-gray-400 truncate">{imageName}</span>
                    <button type="button" onClick={clearImage} className="text-red-400 hover:text-red-300 transition-colors ml-2 flex-shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => fileRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-2 p-6 bg-[#1E293B] border-2 border-dashed border-gray-700 rounded-xl cursor-pointer hover:border-emerald-500/50 transition-colors group"
                >
                  <Upload className="w-8 h-8 text-gray-600 group-hover:text-emerald-400 transition-colors" />
                  <p className="text-sm text-gray-500 group-hover:text-gray-400 transition-colors">
                    Hacé clic para subir una imagen
                  </p>
                  <p className="text-xs text-gray-600">PNG, JPG, JPEG, WEBP — máx. 5 MB</p>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                onChange={handleImageChange}
                className="hidden"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {saving ? (
                <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Guardando...</>
              ) : (
                <><CheckCircle2 className="w-4 h-4" /> Registrar venta</>
              )}
            </button>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por mesa o notas..."
            className="w-full bg-[#0F172A] border border-gray-800 rounded-xl pl-10 pr-4 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
          />
        </div>
        <div className="flex gap-2">
          {(['all', 'cash', 'card', 'transfer'] as const).map(m => (
            <button
              key={m}
              onClick={() => setFilterMethod(m)}
              className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                filterMethod === m
                  ? 'bg-emerald-500 text-white'
                  : 'bg-[#0F172A] border border-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {m === 'all' ? 'Todos' : PAYMENT_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {/* Sales list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <Receipt className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-base font-medium">No hay ventas registradas</p>
          <p className="text-sm mt-1">Las ventas aparecerán aquí al registrarlas</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(sale => {
            const PayIcon = PAYMENT_ICONS[sale.paymentMethod];
            const change = sale.amount - sale.total;
            return (
              <div key={sale.id} className="bg-[#0F172A] border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors">
                <div className="flex items-start gap-4">
                  {/* Image thumbnail */}
                  {sale.imageBase64 && (
                    <a href={sale.imageBase64} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                      <img
                        src={sale.imageBase64}
                        alt="comprobante"
                        className="w-14 h-14 object-cover rounded-lg border border-gray-700 hover:border-emerald-500 transition-colors cursor-zoom-in"
                      />
                    </a>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-semibold">Mesa {sale.tableNumber}</span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${PAYMENT_COLORS[sale.paymentMethod]}`}>
                        <PayIcon className="w-3 h-3" />
                        {PAYMENT_LABELS[sale.paymentMethod]}
                      </span>
                      {sale.registeredBy && (
                        <span className="text-xs text-gray-600">por {sale.registeredBy}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-1">
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDateTime(sale.closedAt)}
                      </span>
                    </div>
                    {sale.notes && <p className="text-xs text-gray-500 mt-1 truncate">{sale.notes}</p>}
                  </div>

                  <div className="text-right flex-shrink-0">
                    <p className="text-lg font-bold text-emerald-400">${sale.total.toFixed(2)}</p>
                    <p className="text-xs text-gray-500">Pagó ${sale.amount.toFixed(2)}</p>
                    {change > 0 && <p className="text-xs text-amber-400">Vuelto ${change.toFixed(2)}</p>}
                  </div>

                  <button
                    onClick={() => handleDelete(sale.id)}
                    className="flex-shrink-0 p-2 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Payment method breakdown */}
      {filtered.length > 0 && (
        <div className="bg-[#0F172A] border border-gray-800 rounded-xl p-4">
          <p className="text-xs font-medium text-gray-500 mb-3">Desglose por método de pago</p>
          <div className="flex gap-4 flex-wrap">
            {(['cash', 'card', 'transfer'] as const).map(m => {
              const count = byMethod(m);
              const rev = filtered.filter(s => s.paymentMethod === m).reduce((sum, s) => sum + s.total, 0);
              const PayIcon = PAYMENT_ICONS[m];
              return (
                <div key={m} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${PAYMENT_COLORS[m]}`}>
                  <PayIcon className="w-4 h-4" />
                  <div>
                    <p className="text-xs font-medium">{PAYMENT_LABELS[m]}</p>
                    <p className="text-xs opacity-70">{count} ventas · ${rev.toFixed(2)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}