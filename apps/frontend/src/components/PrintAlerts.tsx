// ──────────────────────────────────────────────
// PrintAlerts.tsx — Aviso visible cuando un ticket no salió por la comandera (tarea 1.1)
//
// Arriba de todas las pantallas, para quien cobra (Caja y Administrador): qué ticket
// no salió y por qué, con "Reintentar" y "Ya está" (se resolvió de otra forma, por
// ejemplo se le avisó a cocina de palabra). Mientras la comandera reintenta sola no
// molesta: aparece cuando se rindió (3 intentos).
// ──────────────────────────────────────────────
import { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronUp, Printer, RotateCcw } from 'lucide-react';
import { usePrinterStatus } from '../hooks/usePrinterStatus';
import { Button } from './ui/button';

const timeFmt = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false });

export function PrintAlerts({ onOpen }: { onOpen?: () => void }) {
  const { status, retry, discard } = usePrinterStatus(true);
  const [open, setOpen] = useState(true);
  const failed = status?.failed ?? [];
  if (failed.length === 0) return null;

  const first = failed[0];
  return (
    <div role="alert" className="mb-4 rounded-2xl border border-red-400/40 bg-red-500/15 p-3 text-sm text-red-100 shadow-lg">
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle className="h-5 w-5 shrink-0 text-red-300" />
        <p className="min-w-0 flex-1 font-semibold">
          {failed.length === 1 ? 'Un ticket no salió por la comandera' : `${failed.length} tickets no salieron por la comandera`}
        </p>
        {failed.length > 1 && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(o => !o)} aria-expanded={open}>
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />} {open ? 'Ocultar' : 'Ver'}
          </Button>
        )}
        {onOpen && (
          <Button size="sm" variant="ghost" onClick={onOpen}><Printer className="h-4 w-4" /> Comandera</Button>
        )}
      </div>
      {first.error && <p className="mt-1 pl-7 text-red-200/90">{first.error}</p>}
      {open && (
        <ul className="mt-2 space-y-1.5 pl-7">
          {failed.map(j => (
            <li key={j.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-black/20 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{j.title}</span>
                <span className="text-xs text-red-200/70">{timeFmt.format(new Date(j.createdAt))}</span>
              </span>
              <Button size="sm" onClick={() => retry(j.id)}><RotateCcw className="h-4 w-4" /> Reintentar</Button>
              <Button size="sm" variant="outline" onClick={() => discard(j.id)} title="Ya se resolvió sin imprimir (por ejemplo, se avisó a cocina)">
                <Check className="h-4 w-4" /> Ya está
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
