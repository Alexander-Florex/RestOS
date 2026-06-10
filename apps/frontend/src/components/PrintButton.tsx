// ──────────────────────────────────────────────
// PrintButton.tsx
//
// Componente reutilizable. Al hacer click:
//  1. Si no hay impresora guardada → abre un mini-modal para elegirla de la lista
//  2. Si hay impresora guardada → imprime directamente
//     (con opción de cambiarla desde el modal)
//
// La impresora elegida se persiste en localStorage para no tener que
// seleccionarla en cada pedido.
// ──────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Printer, ChevronDown, Loader2, Check } from 'lucide-react';
import { printingApi, type PrinterInfo, ApiError } from '../lib/api';
import { Button } from './ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog';
import { cn } from '../lib/utils';

const STORAGE_KEY = 'restos_printer_name';
const RESTAURANT_KEY = 'restos_restaurant_name';

export const printerPrefs = {
  getPrinter:    () => localStorage.getItem(STORAGE_KEY) ?? '',
  setPrinter:    (v: string) => localStorage.setItem(STORAGE_KEY, v),
  getRestaurant: () => localStorage.getItem(RESTAURANT_KEY) ?? 'RestOS',
  setRestaurant: (v: string) => localStorage.setItem(RESTAURANT_KEY, v),
};

interface PrintButtonProps {
  /** Qué imprimir al confirmar */
  onPrint: (printerName: string, restaurantName: string) => Promise<void>;
  /** Variante del botón */
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'icon';
  label?: string;
  className?: string;
  /** Si true, muestra solo el ícono */
  iconOnly?: boolean;
  disabled?: boolean;
}

export function PrintButton({
  onPrint, variant = 'outline', size = 'sm',
  label = 'Imprimir comanda', className, iconOnly = false, disabled,
}: PrintButtonProps) {
  const [printing, setPrinting] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [selectedPrinter, setSelectedPrinter] = useState(printerPrefs.getPrinter);
  const [restaurantName, setRestaurantName] = useState(printerPrefs.getRestaurant);
  const [platform, setPlatform] = useState('');

  async function loadPrinters() {
    setLoadingPrinters(true);
    try {
      const { printers, platform } = await printingApi.listPrinters();
      setPrinters(printers);
      setPlatform(platform);
      // Si no hay selección previa pero hay impresoras, preseleccionar la default
      if (!selectedPrinter && printers.length > 0) {
        const def = printers.find(p => p.isDefault) ?? printers[0];
        setSelectedPrinter(def.name);
      }
    } catch {
      toast.error('No se pudo obtener la lista de impresoras del servidor');
    } finally {
      setLoadingPrinters(false);
    }
  }

  async function handleClick() {
    const saved = printerPrefs.getPrinter();
    if (!saved) {
      // Primera vez: abrir el selector
      setSelectorOpen(true);
      await loadPrinters();
      return;
    }
    // Ya tiene impresora guardada: imprimir directo
    await doPrint(saved, printerPrefs.getRestaurant());
  }

  async function doPrint(printerName: string, restaurant: string) {
    setPrinting(true);
    try {
      await onPrint(printerName, restaurant);
      toast.success(`Comanda enviada a "${printerName}"`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Error al imprimir';
      toast.error(msg);
    } finally {
      setPrinting(false);
    }
  }

  async function handleConfirmPrinter() {
    if (!selectedPrinter.trim()) {
      toast.error('Elegí una impresora');
      return;
    }
    printerPrefs.setPrinter(selectedPrinter.trim());
    printerPrefs.setRestaurant(restaurantName.trim() || 'RestOS');
    setSelectorOpen(false);
    await doPrint(selectedPrinter.trim(), restaurantName.trim() || 'RestOS');
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={cn('gap-2', className)}
        disabled={disabled || printing}
        onClick={handleClick}
        title={label}
      >
        {printing
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : <Printer className="h-4 w-4" />
        }
        {!iconOnly && (printing ? 'Imprimiendo...' : label)}
      </Button>

      {/* Modal selector de impresora */}
      <Dialog open={selectorOpen} onOpenChange={(v) => { if (!v) setSelectorOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-5 w-5 text-emerald-400" />
              Configurar impresora
            </DialogTitle>
            <DialogDescription>
              Elegí la impresora a usar. La elección se guarda y no tendrás que repetirla.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Nombre del restaurante para el ticket */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nombre del restaurante (para el ticket)</label>
              <input
                type="text"
                value={restaurantName}
                onChange={(e) => setRestaurantName(e.target.value)}
                placeholder="RestOS"
                className="flex h-10 w-full rounded-xl border border-input bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            {/* Lista de impresoras */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Impresora</label>

              {loadingPrinters ? (
                <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Buscando impresoras...
                </div>
              ) : platform !== 'win32' && printers.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-xs text-amber-400">
                    El servidor no está corriendo en Windows (plataforma: {platform || 'desconocida'}).
                    Ingresá el nombre de la impresora manualmente.
                  </p>
                  <input
                    type="text"
                    value={selectedPrinter}
                    onChange={(e) => setSelectedPrinter(e.target.value)}
                    placeholder="Xprinter POS-58"
                    className="flex h-10 w-full rounded-xl border border-input bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              ) : printers.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    No se encontraron impresoras instaladas. Verificá que la Xprinter esté conectada
                    e instalada en Windows como impresora del sistema.
                  </p>
                  <input
                    type="text"
                    value={selectedPrinter}
                    onChange={(e) => setSelectedPrinter(e.target.value)}
                    placeholder="Nombre exacto de la impresora en Windows"
                    className="flex h-10 w-full rounded-xl border border-input bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1.5">
                  {printers.map(p => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => setSelectedPrinter(p.name)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-sm text-left transition-colors',
                        selectedPrinter === p.name
                          ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                          : 'border-border bg-secondary/30 hover:bg-secondary/60'
                      )}
                    >
                      <Printer className="h-4 w-4 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{p.name}</p>
                        {p.isDefault && (
                          <p className="text-xs text-muted-foreground">Impresora predeterminada</p>
                        )}
                      </div>
                      {selectedPrinter === p.name && (
                        <Check className="h-4 w-4 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Botón para cambiar si ya hay una seleccionada */}
            {printerPrefs.getPrinter() && !loadingPrinters && (
              <p className="text-xs text-muted-foreground">
                Impresora actual: <span className="text-foreground font-medium">{printerPrefs.getPrinter()}</span>
                {' '} — al confirmar se actualizará.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectorOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmPrinter} disabled={!selectedPrinter.trim()}>
              <Printer className="h-4 w-4" />
              Guardar e imprimir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Variante compacta solo del selector de configuración (para ajustes) */
export function PrinterConfigButton() {
  const [open, setOpen] = useState(false);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(printerPrefs.getPrinter);
  const [restaurant, setRestaurant] = useState(printerPrefs.getRestaurant);

  async function openConfig() {
    setOpen(true);
    setLoading(true);
    try {
      const { printers } = await printingApi.listPrinters();
      setPrinters(printers);
    } finally {
      setLoading(false);
    }
  }

  function save() {
    printerPrefs.setPrinter(selected.trim());
    printerPrefs.setRestaurant(restaurant.trim() || 'RestOS');
    setOpen(false);
    toast.success('Configuración de impresora guardada');
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openConfig}>
        <Printer className="h-4 w-4" />
        Impresora
        <ChevronDown className="h-3 w-3" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-5 w-5 text-emerald-400" />
              Configuración de impresora
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nombre del restaurante</label>
              <input
                type="text"
                value={restaurant}
                onChange={(e) => setRestaurant(e.target.value)}
                placeholder="RestOS"
                className="flex h-10 w-full rounded-xl border border-input bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Impresora</label>
              {loading ? (
                <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Buscando...
                </div>
              ) : (
                <>
                  {printers.length > 0 ? (
                    <div className="max-h-48 space-y-1.5 overflow-y-auto">
                      {printers.map(p => (
                        <button key={p.name} type="button" onClick={() => setSelected(p.name)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors',
                            selected === p.name
                              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                              : 'border-border bg-secondary/30 hover:bg-secondary/60'
                          )}
                        >
                          <Printer className="h-4 w-4 shrink-0" />
                          <span className="flex-1 truncate text-left">{p.name}</span>
                          {p.isDefault && <span className="text-[10px] text-muted-foreground">Predeterminada</span>}
                          {selected === p.name && <Check className="h-4 w-4 shrink-0" />}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={selected}
                      onChange={(e) => setSelected(e.target.value)}
                      placeholder="Nombre de la impresora"
                      className="flex h-10 w-full rounded-xl border border-input bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  )}
                </>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save}><Check className="h-4 w-4" />Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
