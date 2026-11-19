// ──────────────────────────────────────────────
// TicketPaper.tsx — Dibuja un ticket como sale de la comandera (tarea 1.1)
//
// Recibe el mismo ticket armado que se manda a imprimir (@shared/ticket), así que
// lo que se ve acá es lo que sale en papel: mismo ancho en caracteres, mismos
// cortes de línea, negrita y letra doble. Siempre en blanco y negro, como el papel.
// ──────────────────────────────────────────────
import type { TicketDoc, TicketLine } from '@shared/ticket';
import { cn } from '../lib/utils';

const MONO = 'ui-monospace, "Cascadia Mono", Consolas, "Liberation Mono", "Courier New", monospace';
// Alto de cada renglón en la impresora (en em de la letra normal)
const ROW = 1.3;

function Line({ line }: { line: TicketLine }) {
  const text = line.text === '' ? ' ' : line.text;
  const align = line.align ?? 'left';
  const common = cn('whitespace-pre', line.bold ? 'font-bold' : 'font-normal');
  if (line.size === 'double') {
    return (
      <div className={common} style={{ textAlign: align, fontSize: '2em', lineHeight: ROW }}>{text}</div>
    );
  }
  if (line.size === 'tall') {
    // Alto doble, mismo ancho: se estira la letra hacia abajo
    return (
      <div style={{ textAlign: align, height: `${ROW * 2}em` }}>
        <span className={cn(common, 'inline-block')} style={{ lineHeight: ROW, transform: 'scaleY(2)', transformOrigin: 'top' }}>{text}</span>
      </div>
    );
  }
  return <div className={common} style={{ textAlign: align, lineHeight: ROW }}>{text}</div>;
}

export function TicketPaper({ doc, className }: { doc: TicketDoc; className?: string }) {
  return (
    <div className={cn('mx-auto w-fit max-w-full', className)}>
      <div
        className="overflow-hidden rounded-t-sm bg-white text-black shadow-lg ring-1 ring-black/10"
        style={{
          fontFamily: MONO,
          // 48 o 32 caracteres; en pantallas angostas la letra se achica para que entre entero
          fontSize: `min(13px, calc((100vw - 80px) / ${doc.columns * 0.62}))`,
          padding: '1.5em 1.2em 1em',
        }}
        aria-label={`Ticket de ${doc.paperWidth} mm`}
      >
        <div style={{ width: `${doc.columns}ch` }}>
          {doc.lines.map((line, i) => <Line key={i} line={line} />)}
        </div>
      </div>
      {/* Borde cortado y marca de corte */}
      <div
        aria-hidden
        className="h-2.5 w-full"
        style={{
          background: 'linear-gradient(-45deg, transparent 50%, white 50%) 0 0 / 10px 10px repeat-x, linear-gradient(45deg, transparent 50%, white 50%) 0 0 / 10px 10px repeat-x',
        }}
      />
      <p className="mt-1 text-center text-[11px] text-muted-foreground">✂ corte · papel de {doc.paperWidth} mm ({doc.columns} caracteres por línea)</p>
    </div>
  );
}
