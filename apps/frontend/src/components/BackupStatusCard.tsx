// ──────────────────────────────────────────────
// BackupStatusCard.tsx — Cómo viene el respaldo nocturno (tarea 6.3)
// En el inicio, para quien tenga el permiso system.backup (por defecto el
// Administrador). Si está todo bien es una línea discreta; si no, se destaca.
// ──────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudOff, ShieldAlert } from 'lucide-react';
import { systemApi, type BackupStatus } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { cn } from '../lib/utils';

const DEST_LABEL = { copia: 'carpeta externa', sftp: 'Hostinger' } as const;

function describe(s: BackupStatus): { tone: 'ok' | 'warn' | 'bad'; title: string; detail: string } {
  const where = s.destinations.map(d => DEST_LABEL[d]).join(' y ');
  const last = s.lastLocalAt ? formatDateTime(s.lastLocalAt) : null;
  switch (s.health) {
    case 'ok':
      return { tone: 'ok', title: 'Respaldo al día', detail: `Último: ${last} · copia en ${where}` };
    case 'solo-local':
      return { tone: 'warn', title: 'El respaldo queda solo en esta PC', detail: `Último: ${last}. Configurá una copia afuera (Hostinger, OneDrive o disco externo): si la PC se rompe, se pierde todo.` };
    case 'atrasado':
      return { tone: 'warn', title: 'Respaldo atrasado', detail: `${last ? `Último completo: ${s.lastCompleteDay ?? last}.` : ''} ${s.pending ? `${s.pending} archivo(s) esperando para subir.` : ''} ${s.lastError ?? ''}`.trim() };
    case 'falla':
      return { tone: 'bad', title: 'Hace más de dos noches que no hay respaldo', detail: `${s.lastError ?? 'Revisá el servidor.'} Último completo: ${s.lastCompleteDay ?? last ?? 'ninguno'}.` };
    case 'nunca':
      return { tone: 'warn', title: 'Todavía no se hizo ningún respaldo', detail: s.lastError ?? 'Se hace solo a la noche. También podés correrlo a mano (ver docs/restauracion.md).' };
    default:
      return { tone: 'bad', title: 'El respaldo nocturno no está configurado', detail: 'Falta BACKUP_PASSPHRASE en el servidor (ver docs/instalacion-local.md). Sin respaldo, un problema en la PC hace perder todas las ventas.' };
  }
}

export function BackupStatusCard() {
  const [status, setStatus] = useState<BackupStatus | null>(null);

  useEffect(() => {
    systemApi.backup().then(r => setStatus(r.backup)).catch(() => setStatus(null));
  }, []);

  if (!status) return null;
  const d = describe(status);
  const Icon = d.tone === 'ok' ? CheckCircle2 : d.tone === 'warn' ? (status.pending ? CloudOff : AlertTriangle) : ShieldAlert;
  return (
    <div
      role={d.tone === 'ok' ? 'status' : 'alert'}
      className={cn(
        'mb-4 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm',
        d.tone === 'ok' && 'border-white/[0.06] bg-white/[0.02] text-muted-foreground',
        d.tone === 'warn' && 'border-amber-400/30 bg-amber-500/10 text-amber-100',
        d.tone === 'bad' && 'border-rose-400/40 bg-rose-500/10 text-rose-100',
      )}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', d.tone === 'ok' ? 'text-emerald-400' : d.tone === 'warn' ? 'text-amber-300' : 'text-rose-300')} />
      <p>
        <span className={cn('font-semibold', d.tone === 'ok' && 'text-foreground/80')}>{d.title}</span>
        <span className="block text-xs opacity-80">{d.detail}</span>
      </p>
    </div>
  );
}
