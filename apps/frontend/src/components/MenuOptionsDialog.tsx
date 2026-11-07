// ──────────────────────────────────────────────
// MenuOptionsDialog.tsx — Opciones de un plato (las carga el Administrador)
//
// Tres tipos de grupo:
//   - Ingredientes para sacar: lo que el cliente puede pedir "SIN" (no cambia el precio)
//   - Elegir uno: por ejemplo el término de cocción; puede ser obligatorio
//   - Agregados: extras opcionales con recargo
// Lo que ya se pidió no cambia al editar esto: cada pedido guarda su copia.
// ──────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Loader2, ArrowUp, ArrowDown, MinusCircle, ListChecks, PlusCircle } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { menuApi, ApiError, type MenuItem, type MenuOptionGroupType } from '../lib/api';
import { formatMoney } from '../lib/format';

interface DraftOption { id?: number; name: string; priceDelta: string; isDefault: boolean }
interface DraftGroup { id?: number; name: string; type: MenuOptionGroupType; required: boolean; options: DraftOption[] }

const TYPE_INFO: Record<MenuOptionGroupType, { label: string; hint: string; icon: typeof ListChecks }> = {
  REMOVE: { label: 'Ingredientes para sacar', hint: 'El mozo destilda lo que el cliente no quiere. No cambia el precio.', icon: MinusCircle },
  SINGLE: { label: 'Elegir uno', hint: 'Por ejemplo el término. Si es obligatorio, no se puede pedir sin elegir.', icon: ListChecks },
  MULTI:  { label: 'Agregados', hint: 'Extras opcionales; el recargo se suma al precio.', icon: PlusCircle },
};

const TEMPLATES: Array<{ label: string; group: DraftGroup }> = [
  { label: 'Ingredientes para sacar', group: { name: 'Ingredientes', type: 'REMOVE', required: false, options: [{ name: '', priceDelta: '0', isDefault: false }] } },
  { label: 'Término de cocción', group: { name: 'Término', type: 'SINGLE', required: true, options: [
    { name: 'Jugoso', priceDelta: '0', isDefault: false },
    { name: 'A punto', priceDelta: '0', isDefault: false },
    { name: 'Bien cocido', priceDelta: '0', isDefault: false },
  ] } },
  { label: 'Agregados', group: { name: 'Agregados', type: 'MULTI', required: false, options: [{ name: '', priceDelta: '0', isDefault: false }] } },
];

function toDraft(item: MenuItem): DraftGroup[] {
  return (item.optionGroups ?? []).map(g => ({
    id: g.id, name: g.name, type: g.type, required: g.required,
    options: g.options.map(o => ({ id: o.id, name: o.name, priceDelta: String(Number(o.priceDelta)), isDefault: o.isDefault })),
  }));
}

/** Mismas reglas que el servidor, para avisar antes de guardar. */
function validate(groups: DraftGroup[]): string | null {
  for (const g of groups) {
    if (!g.name.trim()) return 'Hay un grupo sin nombre';
    if (g.options.length === 0) return `"${g.name}" necesita al menos una opción`;
    if (g.options.some(o => !o.name.trim())) return `Hay opciones sin nombre en "${g.name}"`;
    const names = g.options.map(o => o.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) return `Hay opciones repetidas en "${g.name}"`;
    if (g.options.some(o => !(Number(o.priceDelta) >= 0))) return `Revisá los recargos de "${g.name}" (no pueden ser negativos)`;
    if (g.type === 'SINGLE' && g.options.filter(o => o.isDefault).length > 1) return `En "${g.name}" solo una opción puede venir elegida`;
  }
  return null;
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

export function MenuOptionsDialog({ item, onClose }: { item: MenuItem | null; onClose: () => void }) {
  const [groups, setGroups] = useState<DraftGroup[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (item) setGroups(toDraft(item)); }, [item]);

  const updateGroup = (gi: number, patch: Partial<DraftGroup>) =>
    setGroups(prev => prev.map((g, i) => {
      if (i !== gi) return g;
      const next = { ...g, ...patch };
      // "Sacar" nunca es obligatorio ni tiene recargo/opción por defecto
      if (next.type === 'REMOVE') {
        next.required = false;
        next.options = next.options.map(o => ({ ...o, priceDelta: '0', isDefault: false }));
      }
      return next;
    }));

  const updateOption = (gi: number, oi: number, patch: Partial<DraftOption>) =>
    setGroups(prev => prev.map((g, i) => {
      if (i !== gi) return g;
      let options = g.options.map((o, j) => (j === oi ? { ...o, ...patch } : o));
      // En "elegir uno" solo puede haber una por defecto
      if (patch.isDefault && g.type === 'SINGLE') options = options.map((o, j) => ({ ...o, isDefault: j === oi }));
      return { ...g, options };
    }));

  async function save() {
    if (!item) return;
    const error = validate(groups);
    if (error) { toast.error(error); return; }
    setSaving(true);
    try {
      await menuApi.saveOptions(item.id, groups.map(g => ({
        id: g.id, name: g.name.trim(), type: g.type, required: g.required,
        options: g.options.map(o => ({ id: o.id, name: o.name.trim(), priceDelta: Number(o.priceDelta) || 0, isDefault: o.isDefault })),
      })));
      toast.success(`Opciones de "${item.name}" guardadas`);
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudieron guardar las opciones');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={item !== null} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Opciones · {item?.name}</DialogTitle>
          <DialogDescription>
            Lo que el mozo puede personalizar al tomar el pedido. Los pedidos ya hechos no cambian.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {groups.length === 0 && (
            <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-muted-foreground">
              Este plato no tiene opciones. Igual se le puede agregar una nota al pedirlo.
            </p>
          )}

          {groups.map((g, gi) => {
            const info = TYPE_INFO[g.type];
            const Icon = info.icon;
            return (
              <section key={gi} className="space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0 text-brand-400" />
                  <Input className="h-9 min-w-[140px] flex-1" value={g.name} maxLength={60}
                    onChange={e => updateGroup(gi, { name: e.target.value })} placeholder="Nombre del grupo" aria-label="Nombre del grupo" />
                  <select value={g.type} onChange={e => updateGroup(gi, { type: e.target.value as MenuOptionGroupType })}
                    aria-label="Tipo de grupo"
                    className="h-9 rounded-xl border border-input bg-background px-2 text-sm">
                    {(Object.keys(TYPE_INFO) as MenuOptionGroupType[]).map(t => (
                      <option key={t} value={t}>{TYPE_INFO[t].label}</option>
                    ))}
                  </select>
                  <div className="flex items-center">
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Subir grupo" disabled={gi === 0}
                      onClick={() => setGroups(prev => move(prev, gi, gi - 1))}><ArrowUp className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Bajar grupo" disabled={gi === groups.length - 1}
                      onClick={() => setGroups(prev => move(prev, gi, gi + 1))}><ArrowDown className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-400 hover:text-rose-300" aria-label="Borrar grupo"
                      onClick={() => setGroups(prev => prev.filter((_, i) => i !== gi))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{info.hint}</p>
                {g.type !== 'REMOVE' && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={g.required} className="h-4 w-4 accent-orange-500"
                      onChange={e => updateGroup(gi, { required: e.target.checked })} />
                    Obligatorio {g.type === 'SINGLE' ? '(hay que elegir uno)' : '(al menos uno)'}
                  </label>
                )}

                <div className="space-y-2">
                  {g.options.map((o, oi) => (
                    <div key={oi} className="flex flex-wrap items-center gap-2">
                      <Input className="h-9 min-w-[140px] flex-1" value={o.name} maxLength={60}
                        // Fila recién agregada (vacía y última): el cursor va directo ahí
                        autoFocus={!o.name && o.id === undefined && oi === g.options.length - 1 && oi > 0}
                        placeholder={g.type === 'REMOVE' ? 'Ej.: Croutones' : g.type === 'SINGLE' ? 'Ej.: A punto' : 'Ej.: Extra queso'}
                        onChange={e => updateOption(gi, oi, { name: e.target.value })} aria-label="Nombre de la opción" />
                      {g.type !== 'REMOVE' && (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">+$</span>
                          <Input className="h-9 w-24 text-right tabular-nums" type="number" min={0} step="0.01" inputMode="decimal"
                            value={o.priceDelta} aria-label="Recargo"
                            onChange={e => updateOption(gi, oi, { priceDelta: e.target.value })} />
                        </div>
                      )}
                      {g.type !== 'REMOVE' && (
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Viene elegida de entrada">
                          <input type={g.type === 'SINGLE' ? 'radio' : 'checkbox'} name={`default-${gi}`}
                            checked={o.isDefault} className="h-4 w-4 accent-orange-500"
                            onChange={e => updateOption(gi, oi, { isDefault: e.target.checked })}
                            onClick={() => { if (g.type === 'SINGLE' && o.isDefault) updateOption(gi, oi, { isDefault: false }); }} />
                          Por defecto
                        </label>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-rose-400" aria-label="Borrar opción"
                        onClick={() => setGroups(prev => prev.map((gg, i) => i === gi ? { ...gg, options: gg.options.filter((_, j) => j !== oi) } : gg))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" className="h-8"
                    onClick={() => setGroups(prev => prev.map((gg, i) => i === gi
                      ? { ...gg, options: [...gg.options, { name: '', priceDelta: '0', isDefault: false }] } : gg))}>
                    <Plus className="h-3.5 w-3.5" /> Opción
                  </Button>
                </div>

                {g.type === 'MULTI' && g.options.some(o => Number(o.priceDelta) > 0) && item && (
                  <p className="text-xs text-muted-foreground">
                    Ej.: {item.name} + {g.options.find(o => Number(o.priceDelta) > 0)!.name || 'agregado'} ={' '}
                    {formatMoney(Number(item.price) + Number(g.options.find(o => Number(o.priceDelta) > 0)!.priceDelta))}
                  </p>
                )}
              </section>
            );
          })}

          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map(t => (
              <Button key={t.label} variant="outline" size="sm"
                onClick={() => setGroups(prev => [...prev, structuredClone(t.group)])}>
                <Plus className="h-3.5 w-3.5" /> {t.label}
              </Button>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar opciones
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
