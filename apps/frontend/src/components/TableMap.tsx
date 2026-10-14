// ──────────────────────────────────────────────
// TableMap.tsx — Mapa de mesas con tabs por sección + panel admin
// ──────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { RefreshCw, AlertCircle, Settings2 } from 'lucide-react';
import { PageHeader } from './ui/motion';
import { useTables } from '../hooks/useTables';
import { useSections } from '../hooks/useSections';
import { TableCard } from './TableCard';
import { TableDetailModal } from './TableDetailModal';
import { TableAdminPanel } from './TableAdminPanel';
import { Button } from './ui/button';
import { TABLE_STATUS_LABEL, TABLE_STATUS_STYLE } from '../lib/table-helpers';
import type { Table, TableStatus } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';

type FilterValue = 'ALL' | TableStatus;

const STATUS_FILTERS: { value: FilterValue; label: string }[] = [
  { value: 'ALL',            label: 'Todas' },
  { value: 'AVAILABLE',      label: TABLE_STATUS_LABEL.AVAILABLE },
  { value: 'OCCUPIED',       label: TABLE_STATUS_LABEL.OCCUPIED },
  { value: 'BILL_REQUESTED', label: TABLE_STATUS_LABEL.BILL_REQUESTED },
  { value: 'RESERVED',       label: TABLE_STATUS_LABEL.RESERVED },
];

export function TableMap() {
  const { user, can } = useAuth();
  const isAdmin = can('tables.manage');

  const { tables, loading, error, refresh } = useTables();
  const { sections } = useSections();

  const [sectionTab, setSectionTab] = useState<number | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<FilterValue>('ALL');
  const [selected, setSelected] = useState<Table | null>(null);
  const [adminMode, setAdminMode] = useState(false);

  // Mesa seleccionada sincronizada con el estado en vivo
  const liveSelected = useMemo(
    () => (selected ? tables.find(t => t.id === selected.id) ?? null : null),
    [selected, tables]
  );

  // Solo mesas habilitadas para la vista normal
  const enabledTables = useMemo(() => tables.filter(t => t.enabled), [tables]);

  // Filtrar por sección y por estado
  const filtered = useMemo(() => {
    return enabledTables.filter(t => {
      if (sectionTab !== 'ALL' && t.sectionId !== sectionTab) return false;
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
      return true;
    });
  }, [enabledTables, sectionTab, statusFilter]);

  // Contadores por estado (sobre la sección activa)
  const counts = useMemo(() => {
    const src = sectionTab === 'ALL' ? enabledTables : enabledTables.filter(t => t.sectionId === sectionTab);
    const c: Record<string, number> = { ALL: src.length, AVAILABLE: 0, OCCUPIED: 0, BILL_REQUESTED: 0, RESERVED: 0 };
    for (const t of src) c[t.status] = (c[t.status] ?? 0) + 1;
    return c;
  }, [enabledTables, sectionTab]);

  // Secciones que tienen mesas habilitadas (para no mostrar tabs vacíos)
  const visibleSections = useMemo(() => {
    const sectionIdsWithTables = new Set(enabledTables.map(t => t.sectionId).filter(Boolean));
    return sections.filter(s => sectionIdsWithTables.has(s.id));
  }, [sections, enabledTables]);

  // Resumen: mesas en sección activa
  const tablesInView = sectionTab === 'ALL' ? enabledTables : enabledTables.filter(t => t.sectionId === sectionTab);

  if (loading) {
    return (
      <div>
        <div className="skeleton mb-10 h-12 w-64" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => <div key={i} className="skeleton aspect-square rounded-3xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-rose-400/30 bg-rose-500/10 p-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
        <p className="mt-3 text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={refresh}>
          <RefreshCw className="h-4 w-4" />
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Salón en vivo"
        title="Mapa de mesas"
        description={
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            <span>{tablesInView.length} {tablesInView.length === 1 ? 'mesa' : 'mesas'}</span>
            <span className="text-emerald-300">{counts.AVAILABLE} libres</span>
            <span className="text-brand-300">{counts.OCCUPIED} ocupadas</span>
            {counts.BILL_REQUESTED > 0 && (
              <span className="font-semibold text-amber-200">{counts.BILL_REQUESTED} con cuenta pedida</span>
            )}
            {counts.RESERVED > 0 && <span className="text-violet-300">{counts.RESERVED} reservadas</span>}
          </div>
        }
        actions={
          <>
            {isAdmin && (
              <Button variant={adminMode ? 'default' : 'outline'} size="sm" onClick={() => setAdminMode(v => !v)}>
                <Settings2 className="h-4 w-4" />
                {adminMode ? 'Salir del modo admin' : 'Administrar mesas'}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={refresh} aria-label="Actualizar">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </>
        }
      />

      {/* Modo admin: panel CRUD */}
      {adminMode ? (
        <TableAdminPanel />
      ) : (
        <>
          {/* Tabs por sección */}
          {visibleSections.length > 0 && (
            <div className="mb-4 -mx-1 overflow-x-auto px-1">
              <div className="flex gap-2 whitespace-nowrap pb-1">
                <button
                  onClick={() => setSectionTab('ALL')}
                  className={cn(
                    'rounded-full border px-4 py-1.5 text-xs font-medium transition-colors',
                    sectionTab === 'ALL'
                      ? 'border-brand-400/50 bg-brand-500/15 text-brand-200'
                      : 'border-white/[0.07] bg-white/[0.03] text-muted-foreground hover:text-foreground'
                  )}
                >
                  Todas
                  <span className="ml-1.5 text-[10px] tabular-nums">({enabledTables.length})</span>
                </button>
                {visibleSections.map(s => {
                  const cnt = enabledTables.filter(t => t.sectionId === s.id).length;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSectionTab(s.id)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-medium transition-colors',
                        sectionTab === s.id
                          ? 'border-white/30 text-white'
                          : 'border-white/[0.07] bg-white/[0.03] text-muted-foreground hover:text-foreground'
                      )}
                      style={sectionTab === s.id ? { background: `${s.color}25`, borderColor: `${s.color}60`, color: s.color } : {}}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                      {s.name}
                      <span className="text-[10px] tabular-nums opacity-70">({cnt})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Filtros de estado */}
          <LayoutGroup id="status-filter">
          <div className="mb-8 inline-flex max-w-full flex-wrap gap-1 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-1">
            {STATUS_FILTERS.map(f => {
              const active = statusFilter === f.value;
              const count = counts[f.value] ?? 0;
              const style = f.value !== 'ALL' ? TABLE_STATUS_STYLE[f.value] : null;
              return (
                <button
                  key={f.value}
                  onClick={() => setStatusFilter(f.value)}
                  className={cn(
                    'relative inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors',
                    active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="status-pill"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      className="absolute inset-0 rounded-xl bg-white/[0.08] shadow-[inset_0_1px_0_0_rgb(255_255_255/0.08)] ring-1 ring-white/10"
                    />
                  )}
                  {style && <span className={cn('relative h-1.5 w-1.5 rounded-full', style.dot)} />}
                  <span className="relative">{f.label}</span>
                  <span className={cn('relative rounded-full px-1.5 text-[10px] tabular-nums', active ? 'bg-brand-500/25 text-brand-200' : 'bg-white/[0.05]')}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          </LayoutGroup>

          {/* Grilla de mesas */}
          {filtered.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/10 p-14 text-center">
              <p className="text-sm text-muted-foreground">
                {statusFilter !== 'ALL'
                  ? `No hay mesas en estado "${TABLE_STATUS_LABEL[statusFilter as TableStatus]}" en esta sección.`
                  : 'No hay mesas en esta sección todavía. Agregá mesas desde "Administrar mesas".'}
              </p>
            </div>
          ) : (
            <motion.div layout className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              <AnimatePresence mode="popLayout">
                {filtered.map(t => (
                  <TableCard key={t.id} table={t} onClick={() => setSelected(t)} />
                ))}
              </AnimatePresence>
            </motion.div>
          )}

          {/* Modal */}
          <TableDetailModal
            table={liveSelected}
            open={selected !== null}
            onClose={() => setSelected(null)}
          />
        </>
      )}
    </div>
  );
}
