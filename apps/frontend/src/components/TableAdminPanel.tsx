// ──────────────────────────────────────────────
// TableAdminPanel.tsx — CRUD de mesas y secciones
// Solo visible para ADMIN desde el TableMap.
// ──────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus, Edit, Trash2, Loader2, ToggleLeft, ToggleRight, Palette,
  Settings2, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { useTables } from '../hooks/useTables';
import { useSections } from '../hooks/useSections';
import { tablesApi, sectionsApi, type Table, type Section, ApiError } from '../lib/api';
import { TABLE_STATUS_LABEL } from '../lib/table-helpers';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select } from './ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog';
import { cn } from '../lib/utils';

// ── Paleta de colores de sección ──
const SECTION_COLORS = [
  { hex: '#10b981', label: 'Esmeralda' },
  { hex: '#3b82f6', label: 'Azul' },
  { hex: '#a855f7', label: 'Violeta' },
  { hex: '#f59e0b', label: 'Ámbar' },
  { hex: '#ef4444', label: 'Rojo' },
  { hex: '#ec4899', label: 'Rosa' },
  { hex: '#06b6d4', label: 'Cian' },
  { hex: '#64748b', label: 'Gris' },
];

// ── Modal de mesa (crear / editar) ──
interface TableFormState {
  number: string;
  capacity: string;
  sectionId: string;
}
const EMPTY_TABLE_FORM: TableFormState = { number: '', capacity: '4', sectionId: '' };

function TableFormDialog({
  open, onClose, editing, sections,
}: {
  open: boolean;
  onClose: () => void;
  editing: Table | null;
  sections: Section[];
}) {
  const [form, setForm] = useState<TableFormState>(EMPTY_TABLE_FORM);
  const [submitting, setSubmitting] = useState(false);

  // Sync con la mesa en edición
  const resetForm = (t: Table | null) => setForm(
    t ? { number: String(t.number), capacity: String(t.capacity), sectionId: t.sectionId ? String(t.sectionId) : '' }
      : EMPTY_TABLE_FORM
  );

  // Cuando el dialog se abre con una mesa, cargar sus datos
  if (open && editing && form.number !== String(editing.number) && form.number === '') {
    resetForm(editing);
  }

  async function handleSubmit() {
    const num = Number(form.number);
    const cap = Number(form.capacity);
    if (!form.number || isNaN(num) || num < 1) { toast.error('Ingresá un número de mesa válido'); return; }
    if (!form.capacity || isNaN(cap) || cap < 1) { toast.error('La capacidad debe ser al menos 1'); return; }

    setSubmitting(true);
    try {
      const data = {
        number: num,
        capacity: cap,
        sectionId: form.sectionId ? Number(form.sectionId) : null,
      };
      if (editing) {
        await tablesApi.update(editing.id, data);
        toast.success(`Mesa N° ${num} actualizada`);
      } else {
        await tablesApi.create(data);
        toast.success(`Mesa N° ${num} creada`);
      }
      resetForm(null);
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    resetForm(null);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Editar mesa N° ${editing.number}` : 'Nueva mesa'}</DialogTitle>
          <DialogDescription>
            {editing ? 'Modificá número, capacidad o sección.' : 'Creá una nueva mesa y asignala a una sección.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="tNumber">Número de mesa *</Label>
              <Input
                id="tNumber" type="number" min="1" inputMode="numeric" autoFocus
                value={form.number}
                onChange={(e) => setForm(f => ({ ...f, number: e.target.value }))}
                disabled={submitting} placeholder="1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tCapacity">Capacidad (comensales) *</Label>
              <Input
                id="tCapacity" type="number" min="1" max="500" inputMode="numeric"
                value={form.capacity}
                onChange={(e) => setForm(f => ({ ...f, capacity: e.target.value }))}
                disabled={submitting} placeholder="4"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tSection">Sección</Label>
            <Select
              id="tSection"
              value={form.sectionId}
              onChange={(e) => setForm(f => ({ ...f, sectionId: e.target.value }))}
              disabled={submitting}
            >
              <option value="">Sin sección</option>
              {sections.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            {sections.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No hay secciones creadas. Podés crearlas desde "Gestionar secciones".
              </p>
            )}
          </div>

          {form.capacity && Number(form.capacity) > 20 && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              Capacidad alta ({form.capacity} personas). Verificá que sea correcto.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={submitting}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? 'Guardar cambios' : <>
              <Plus className="h-4 w-4" />
              Crear mesa
            </>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Modal de sección (crear / editar) ──
function SectionFormDialog({
  open, onClose, editing,
}: { open: boolean; onClose: () => void; editing: Section | null }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(SECTION_COLORS[0].hex);
  const [submitting, setSubmitting] = useState(false);

  if (open && editing && name !== editing.name && name === '') {
    setName(editing.name);
    setColor(editing.color);
  }

  async function handleSubmit() {
    if (!name.trim()) { toast.error('El nombre es obligatorio'); return; }
    setSubmitting(true);
    try {
      if (editing) {
        await sectionsApi.update(editing.id, { name: name.trim(), color });
        toast.success(`Sección "${name}" actualizada`);
      } else {
        await sectionsApi.create({ name: name.trim(), color });
        toast.success(`Sección "${name}" creada`);
      }
      setName(''); setColor(SECTION_COLORS[0].hex);
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setName(''); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Editar sección "${editing.name}"` : 'Nueva sección'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sName">Nombre *</Label>
            <Input
              id="sName" autoFocus value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting} placeholder="Salón principal"
            />
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Palette className="h-3.5 w-3.5" />
              Color identificador
            </Label>
            <div className="flex flex-wrap gap-2">
              {SECTION_COLORS.map(c => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => setColor(c.hex)}
                  title={c.label}
                  className={cn(
                    'h-8 w-8 rounded-full border-2 transition-transform hover:scale-110',
                    color === c.hex ? 'border-white scale-110' : 'border-transparent'
                  )}
                  style={{ background: c.hex }}
                >
                  {color === c.hex && (
                    <CheckCircle2 className="mx-auto h-4 w-4 text-white drop-shadow" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setName(''); onClose(); }} disabled={submitting}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? 'Guardar' : 'Crear sección'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Componente principal ──
export function TableAdminPanel() {
  const { tables, loading: loadingTables } = useTables();
  const { sections, loading: loadingSections } = useSections();

  const [sectionFilter, setSectionFilter] = useState<number | 'ALL'>('ALL');
  const [tableFormOpen, setTableFormOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<Table | null>(null);
  const [sectionFormOpen, setSectionFormOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<Section | null>(null);

  const filteredTables = useMemo(() =>
    sectionFilter === 'ALL'
      ? tables
      : tables.filter(t => t.sectionId === sectionFilter),
    [tables, sectionFilter]
  );

  const sectionMap = useMemo(() =>
    new Map(sections.map(s => [s.id, s])),
    [sections]
  );

  async function handleDeleteTable(t: Table) {
    if (t.status !== 'AVAILABLE') {
      toast.error('Solo se puede eliminar una mesa libre'); return;
    }
    if (!window.confirm(`¿Eliminar mesa N° ${t.number}? Esta acción no se puede deshacer.`)) return;
    try {
      await tablesApi.remove(t.id);
      toast.success(`Mesa N° ${t.number} eliminada`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error');
    }
  }

  async function handleToggleTable(t: Table) {
    try {
      await tablesApi.toggleEnabled(t.id);
      toast.success(`Mesa N° ${t.number} ${t.enabled ? 'deshabilitada' : 'habilitada'}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error');
    }
  }

  async function handleDeleteSection(s: Section) {
    const count = tables.filter(t => t.sectionId === s.id).length;
    if (count > 0) {
      toast.error(`La sección tiene ${count} ${count === 1 ? 'mesa asignada' : 'mesas asignadas'}. Reasignales primero.`);
      return;
    }
    if (!window.confirm(`¿Eliminar la sección "${s.name}"?`)) return;
    try {
      await sectionsApi.remove(s.id);
      toast.success(`Sección "${s.name}" eliminada`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error');
    }
  }

  if (loadingTables || loadingSections) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Secciones */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Settings2 className="h-4 w-4 text-emerald-400" />
            Secciones
          </h3>
          <Button size="sm" onClick={() => { setEditingSection(null); setSectionFormOpen(true); }}>
            <Plus className="h-3.5 w-3.5" />
            Nueva sección
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {sections.length === 0 && (
            <p className="col-span-full rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Sin secciones. Creá la primera para organizar las mesas.
            </p>
          )}
          {sections.map(s => {
            const count = tables.filter(t => t.sectionId === s.id).length;
            return (
              <div key={s.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{count} {count === 1 ? 'mesa' : 'mesas'}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => { setEditingSection(s); setSectionFormOpen(true); }} title="Editar">
                  <Edit className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => handleDeleteSection(s)} title="Eliminar" className="text-rose-400 hover:text-rose-300">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mesas */}
      <div>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-semibold">Mesas ({tables.length})</h3>
          <div className="flex items-center gap-2">
            {/* Filtro por sección */}
            {sections.length > 0 && (
              <Select
                value={String(sectionFilter)}
                onChange={(e) => setSectionFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
                className="h-9 w-44 text-xs"
              >
                <option value="ALL">Todas las secciones</option>
                {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            )}
            <Button size="sm" onClick={() => { setEditingTable(null); setTableFormOpen(true); }}>
              <Plus className="h-3.5 w-3.5" />
              Nueva mesa
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/30 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">Nº</th>
                <th className="px-3 py-2.5 text-left font-medium">Sección</th>
                <th className="px-3 py-2.5 text-center font-medium">Capacidad</th>
                <th className="px-3 py-2.5 text-left font-medium">Estado</th>
                <th className="px-3 py-2.5 text-center font-medium">Activa</th>
                <th className="px-3 py-2.5 text-center font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredTables.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted-foreground">
                    No hay mesas en esta sección
                  </td>
                </tr>
              ) : (
                filteredTables.map(t => {
                  const section = t.sectionId ? sectionMap.get(t.sectionId) : null;
                  return (
                    <tr key={t.id} className={cn('hover:bg-secondary/20', !t.enabled && 'opacity-50')}>
                      <td className="px-3 py-3 font-bold tabular-nums text-emerald-400">
                        N° {t.number}
                      </td>
                      <td className="px-3 py-3">
                        {section ? (
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <span className="h-2 w-2 rounded-full" style={{ background: section.color }} />
                            {section.name}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center tabular-nums">
                        <span className="font-medium">{t.capacity}</span>
                        <span className="ml-1 text-xs text-muted-foreground">pax</span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-xs text-muted-foreground">
                          {TABLE_STATUS_LABEL[t.status]}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <button onClick={() => handleToggleTable(t)} title={t.enabled ? 'Deshabilitar' : 'Habilitar'}>
                          {t.enabled
                            ? <ToggleRight className="mx-auto h-5 w-5 text-emerald-400" />
                            : <ToggleLeft className="mx-auto h-5 w-5 text-muted-foreground" />
                          }
                        </button>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" onClick={() => { setEditingTable(t); setTableFormOpen(true); }} title="Editar">
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost" size="icon"
                            onClick={() => handleDeleteTable(t)}
                            title="Eliminar"
                            className="text-rose-400 hover:text-rose-300"
                            disabled={t.status !== 'AVAILABLE'}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modales */}
      <TableFormDialog
        open={tableFormOpen}
        onClose={() => { setTableFormOpen(false); setEditingTable(null); }}
        editing={editingTable}
        sections={sections}
      />
      <SectionFormDialog
        open={sectionFormOpen}
        onClose={() => { setSectionFormOpen(false); setEditingSection(null); }}
        editing={editingSection}
      />
    </div>
  );
}
