// ──────────────────────────────────────────────
// motion.tsx — Piezas visuales y animadas compartidas
// Logo de marca, fondo aurora, transiciones de página,
// listas escalonadas, números animados y encabezados de sección.
// ──────────────────────────────────────────────
import { type ReactNode, type MouseEvent, useId } from 'react';
import { motion, useMotionTemplate, useMotionValue, type HTMLMotionProps, type Variants } from 'motion/react';
import NumberFlow from '@number-flow/react';
import { cn } from '../../lib/utils';

/** Curva "expo out": arranque rápido, frenado suave. Es la curva de toda la app. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

// ── Logo ──────────────────────────────────────

/** Marca de RestOS: una llama sobre un plato, en degradé brasa. */
export function BrandMark({ className, animated = false }: { className?: string; animated?: boolean }) {
  const id = useId();
  return (
    <motion.svg
      viewBox="0 0 48 48"
      className={cn('h-10 w-10', className)}
      initial={animated ? { scale: 0.6, opacity: 0, rotate: -12 } : false}
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      transition={{ duration: 0.9, ease: EASE_OUT }}
      aria-hidden
    >
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff8a4c" />
          <stop offset="55%" stopColor="#ec4f12" />
          <stop offset="100%" stopColor="#9b2f14" />
        </linearGradient>
        <linearGradient id={`${id}-fl`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#fff5ed" />
          <stop offset="100%" stopColor="#ffcda8" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="46" height="46" rx="14" fill={`url(#${id}-bg)`} />
      <rect x="1.5" y="1.5" width="45" height="45" rx="13.5" fill="none" stroke="white" strokeOpacity="0.22" />
      <motion.path
        d="M24 9c1.6 4.6 6.9 7.2 6.9 13.4a6.9 6.9 0 0 1-13.8 0c0-2.7 1.3-4.6 2.9-6 .2 2 1.1 3.4 2.6 3.9C21.7 16 23.4 12.4 24 9Z"
        fill={`url(#${id}-fl)`}
        style={{ originX: '50%', originY: '100%' }}
        animate={animated ? { scaleY: [1, 1.07, 0.97, 1.04, 1], scaleX: [1, 0.97, 1.02, 0.99, 1] } : undefined}
        transition={animated ? { duration: 2.6, repeat: Infinity, ease: 'easeInOut' } : undefined}
      />
      <path d="M11 33.5h26" stroke="#fff5ed" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M14.5 37.5h19" stroke="#fff5ed" strokeOpacity="0.55" strokeWidth="2.6" strokeLinecap="round" />
    </motion.svg>
  );
}

// ── Fondos ────────────────────────────────────

/** Fondo vivo: manchas de luz cálida que se desplazan lento, grilla tenue y ruido. */
export function AuroraBackground({ className, intensity = 1 }: { className?: string; intensity?: number }) {
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <div
        className="absolute -left-[10%] -top-[20%] h-[70vmax] w-[70vmax] animate-aurora rounded-full blur-[120px]"
        style={{ background: 'radial-gradient(circle, rgb(251 106 38 / 0.55), transparent 60%)', opacity: 0.55 * intensity }}
      />
      <div
        className="absolute -bottom-[30%] -right-[15%] h-[65vmax] w-[65vmax] animate-aurora rounded-full blur-[120px] [animation-delay:-6s]"
        style={{ background: 'radial-gradient(circle, rgb(245 158 11 / 0.45), transparent 60%)', opacity: 0.5 * intensity }}
      />
      <div
        className="absolute left-[35%] top-[30%] h-[45vmax] w-[45vmax] animate-aurora rounded-full blur-[120px] [animation-delay:-12s]"
        style={{ background: 'radial-gradient(circle, rgb(190 24 93 / 0.4), transparent 60%)', opacity: 0.35 * intensity }}
      />
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
        }}
      />
      <div className="noise absolute inset-0 opacity-[0.06] mix-blend-overlay" />
    </div>
  );
}

// ── Transiciones ──────────────────────────────

/** Entrada de página: sube y aparece, con leve desenfoque. */
export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
      transition={{ duration: 0.45, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};

const staggerChild: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: EASE_OUT } },
};

/** Contenedor cuyos hijos `StaggerItem` aparecen en cascada. */
export function Stagger({ children, className, ...props }: HTMLMotionProps<'div'>) {
  return (
    <motion.div variants={staggerParent} initial="hidden" animate="show" className={className} {...props}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className, ...props }: HTMLMotionProps<'div'>) {
  return (
    <motion.div variants={staggerChild} className={className} {...props}>
      {children}
    </motion.div>
  );
}

// ── Superficies ───────────────────────────────

/** Tarjeta de vidrio con un foco de luz que sigue al mouse. */
export function SpotlightCard({ children, className, glow = 'rgb(251 106 38 / 0.14)' }: {
  children: ReactNode; className?: string; glow?: string;
}) {
  const x = useMotionValue(-400);
  const y = useMotionValue(-400);
  const background = useMotionTemplate`radial-gradient(420px circle at ${x}px ${y}px, ${glow}, transparent 70%)`;

  function onMove(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    x.set(e.clientX - rect.left);
    y.set(e.clientY - rect.top);
  }

  return (
    <div onMouseMove={onMove} onMouseLeave={() => { x.set(-400); y.set(-400); }}
      className={cn('glass group relative overflow-hidden rounded-3xl', className)}>
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 transition-opacity duration-300" style={{ background }} />
      <div className="relative">{children}</div>
    </div>
  );
}

// ── Números ───────────────────────────────────

/** Monto en pesos que "rueda" al cambiar. Mismo formato que formatMoney. */
export function AnimatedMoney({ value, className }: { value: number; className?: string }) {
  return (
    <NumberFlow
      value={value}
      locales="es-AR"
      format={{ style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }}
      className={cn('tabular-nums', className)}
    />
  );
}

export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  return <NumberFlow value={value} locales="es-AR" className={cn('tabular-nums', className)} />;
}

// ── Encabezado de sección ─────────────────────

/** Título de página consistente: eyebrow, título display, descripción y acciones. */
export function PageHeader({ eyebrow, title, description, actions, className }: {
  eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string;
}) {
  return (
    <div className={cn('mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div>
        {eyebrow && (
          <motion.p
            initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, ease: EASE_OUT }}
            className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400"
          >
            <span className="h-px w-6 bg-gradient-to-r from-brand-400 to-transparent" />
            {eyebrow}
          </motion.p>
        )}
        <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
        {description && <div className="mt-1.5 text-sm text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
