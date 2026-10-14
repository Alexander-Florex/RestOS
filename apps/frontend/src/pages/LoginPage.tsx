// ──────────────────────────────────────────────
// LoginPage.tsx — Pantalla de inicio de sesión
// Escritorio: panel de marca animado + formulario. Celular: solo formulario sobre aurora.
// ──────────────────────────────────────────────
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useAnimationControls } from 'motion/react';
import {
  Eye, EyeOff, Loader2, ArrowRight, Store, User, Lock, AlertCircle,
  ShieldCheck, ConciergeBell, Wallet, Utensils, Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { AuroraBackground, BrandMark, EASE_OUT } from '../components/ui/motion';
import { ApiError, restaurantIdStorage } from '../lib/api';
import { cn } from '../lib/utils';

const ROTATING_WORDS = ['las mesas', 'los pedidos', 'la caja', 'el stock', 'la cocina'];

export function LoginPage() {
  const { login } = useAuth();
  const [restaurantId, setRestaurantId] = useState(() => restaurantIdStorage.get()?.toString() || '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shake = useAnimationControls();

  function fail(msg: string) {
    setError(msg);
    shake.start({ x: [0, -10, 10, -6, 6, -2, 0], transition: { duration: 0.45 } });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const restId = Number(restaurantId);
    if (!restaurantId.trim() || !Number.isInteger(restId) || restId <= 0) {
      fail('Ingresá un ID de restaurante válido.');
      return;
    }
    if (!username.trim() || !password) {
      fail('Completá usuario y contraseña.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await login(restId, username.trim(), password);
      toast.success('Sesión iniciada', { description: `Bienvenido, ${username}` });
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message :
        err instanceof Error ? err.message :
        'Error desconocido al iniciar sesión.';
      fail(msg);
      setSubmitting(false);
    }
  }

  function fillDemo(user: string, pass: string) {
    setUsername(user);
    setPassword(pass);
    setError(null);
  }

  return (
    <div className="relative min-h-[100dvh] w-full overflow-hidden bg-background lg:grid lg:grid-cols-[1.15fr_1fr]">
      {/* ── Panel de marca (escritorio) ── */}
      <section className="relative hidden overflow-hidden border-r border-white/[0.06] lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <AuroraBackground intensity={1.2} />

        <motion.div
          initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE_OUT }}
          className="relative z-10 flex items-center gap-3"
        >
          <BrandMark animated className="h-11 w-11" />
          <div>
            <p className="font-display text-lg font-bold leading-none tracking-tight">RestOS</p>
            <p className="mt-1 text-xs text-muted-foreground">Sistema de gestión gastronómica</p>
          </div>
        </motion.div>

        <div className="relative z-10 max-w-xl">
          <motion.h1
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.1, ease: EASE_OUT }}
            className="font-display text-6xl font-bold leading-[0.95] tracking-[-0.035em] xl:text-7xl"
          >
            Todo el servicio,
            <br />
            <span className="text-gradient">en tus manos.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.35 }}
            className="mt-6 flex flex-wrap items-baseline gap-x-2 text-lg text-muted-foreground"
          >
            Controlá <RotatingWord words={ROTATING_WORDS} /> desde un solo lugar, en tiempo real.
          </motion.p>
        </div>

        <FloatingPreview />
      </section>

      {/* ── Formulario ── */}
      <section className="relative flex min-h-[100dvh] items-center justify-center px-5 py-10 sm:px-8">
        <AuroraBackground className="lg:hidden" intensity={0.8} />

        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.15, ease: EASE_OUT }}
          className="relative z-10 w-full max-w-[420px]"
        >
          {/* Marca en celular */}
          <div className="mb-10 flex flex-col items-center text-center lg:hidden">
            <BrandMark animated className="h-14 w-14" />
            <p className="mt-4 font-display text-3xl font-bold tracking-tight">RestOS</p>
            <p className="mt-1 text-sm text-muted-foreground">Todo el servicio, en tus manos.</p>
          </div>

          <motion.div animate={shake} className="glass rounded-[28px] p-7 sm:p-9">
            <div className="mb-8">
              <h2 className="font-display text-3xl font-bold tracking-tight">Hola de nuevo 👋</h2>
              <p className="mt-2 text-sm text-muted-foreground">Ingresá con tu usuario para empezar el turno.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              <Field id="restaurantId" label="ID de restaurante" icon={<Store className="h-4 w-4" />} delay={0.25}>
                <input
                  id="restaurantId" type="number" inputMode="numeric" min={1} placeholder="1"
                  value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)} disabled={submitting}
                  className={FIELD_CLASS}
                />
              </Field>

              <Field id="username" label="Usuario" icon={<User className="h-4 w-4" />} delay={0.32}>
                <input
                  id="username" type="text" autoComplete="username" autoCapitalize="none" placeholder="tu.usuario"
                  value={username} onChange={(e) => setUsername(e.target.value)} disabled={submitting} autoFocus
                  className={FIELD_CLASS}
                />
              </Field>

              <Field id="password" label="Contraseña" icon={<Lock className="h-4 w-4" />} delay={0.39}
                trailing={
                  <button
                    type="button" tabIndex={-1} onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span key={String(showPassword)} initial={{ opacity: 0, rotate: -45 }} animate={{ opacity: 1, rotate: 0 }} exit={{ opacity: 0, rotate: 45 }} transition={{ duration: 0.15 }}>
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </motion.span>
                    </AnimatePresence>
                  </button>
                }
              >
                <input
                  id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••"
                  value={password} onChange={(e) => setPassword(e.target.value)} disabled={submitting}
                  className={cn(FIELD_CLASS, 'pr-12')}
                />
              </Field>

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: EASE_OUT }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-start gap-2.5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                      {error}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.46, duration: 0.5, ease: EASE_OUT }}>
                <Button type="submit" size="lg" disabled={submitting} className="group w-full overflow-hidden">
                  {/* Brillo que cruza el botón */}
                  <span aria-hidden className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                  {submitting ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Ingresando...</>
                  ) : (
                    <>Ingresar <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></>
                  )}
                </Button>
              </motion.div>
            </form>

            {/* Cuentas demo: solo en desarrollo (Vite elimina el bloque en el build de producción) */}
            {import.meta.env.DEV && (
              <div className="mt-8">
                <div className="mb-3 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  <span className="h-px flex-1 bg-white/10" /> Cuentas demo <span className="h-px flex-1 bg-white/10" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { user: 'admin',     pass: 'admin123',  label: 'Administrador', icon: ShieldCheck },
                    { user: 'mesero1',   pass: 'waiter123', label: 'Mesero',        icon: ConciergeBell },
                    { user: 'personal1', pass: 'staff123',  label: 'Cajero',        icon: Wallet },
                  ].map(d => (
                    <motion.button
                      key={d.user} type="button" disabled={submitting} onClick={() => fillDemo(d.user, d.pass)}
                      whileHover={{ y: -2 }} whileTap={{ scale: 0.96 }}
                      className={cn(
                        'flex flex-col items-center gap-1.5 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-2 py-3 text-[11px] font-medium text-muted-foreground transition-colors',
                        'hover:border-brand-400/40 hover:bg-brand-500/10 hover:text-brand-200 disabled:opacity-50',
                        username === d.user && 'border-brand-400/50 bg-brand-500/10 text-brand-200'
                      )}
                    >
                      <d.icon className="h-4 w-4" />
                      {d.label}
                    </motion.button>
                  ))}
                </div>
              </div>
            )}
          </motion.div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            ¿Problemas para ingresar? Hablá con el administrador.
          </p>
        </motion.div>
      </section>
    </div>
  );
}

const FIELD_CLASS = cn(
  'h-12 w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] pl-11 pr-4 text-[15px] text-foreground',
  'placeholder:text-muted-foreground/50 transition-all duration-200',
  'hover:border-white/15 focus:border-brand-400/60 focus:bg-white/[0.05] focus:outline-none focus:ring-4 focus:ring-brand-500/15',
  'disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
);

function Field({ id, label, icon, trailing, delay, children }: {
  id: string; label: string; icon: ReactNode; trailing?: ReactNode; delay: number; children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.5, ease: EASE_OUT }}
      className="space-y-2"
    >
      <Label htmlFor={id}>{label}</Label>
      <div className="group relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-brand-400">
          {icon}
        </span>
        {children}
        {trailing && <span className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</span>}
      </div>
    </motion.div>
  );
}

/** Palabra que rota con efecto de cortina. */
function RotatingWord({ words }: { words: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI(v => (v + 1) % words.length), 2200);
    return () => clearInterval(t);
  }, [words.length]);

  return (
    <span className="relative inline-flex h-[1.4em] overflow-hidden align-bottom">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={words[i]}
          initial={{ y: '100%', opacity: 0 }} animate={{ y: '0%', opacity: 1 }} exit={{ y: '-100%', opacity: 0 }}
          transition={{ duration: 0.55, ease: EASE_OUT }}
          className="font-semibold text-foreground"
        >
          {words[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Vista previa flotante del producto: mesas que cambian de estado y un ticket. */
function FloatingPreview() {
  const STATES = [
    { cls: 'border-emerald-400/30 from-emerald-500/10 text-emerald-300', dot: 'bg-emerald-400' },
    { cls: 'border-brand-400/40 from-brand-500/20 text-brand-300',       dot: 'bg-brand-400' },
    { cls: 'border-amber-300/50 from-amber-400/20 text-amber-200',       dot: 'bg-amber-300' },
    { cls: 'border-violet-400/30 from-violet-500/15 text-violet-300',    dot: 'bg-violet-400' },
  ];
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(v => v + 1), 1600);
    return () => clearInterval(t);
  }, []);

  const tables = [1, 2, 3, 4, 5, 6, 7, 8];

  return (
    <div className="relative z-10 flex items-end gap-5">
      <motion.div
        initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 0.5, ease: EASE_OUT }}
        className="glass w-[340px] rounded-3xl p-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground">Salón principal</p>
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-emerald-400" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            En vivo
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {tables.map(n => {
            const s = STATES[(n * 7 + Math.floor((tick + n) / 3) * (n % 3 + 1)) % STATES.length];
            return (
              <div
                key={n}
                className={cn('flex aspect-square flex-col items-center justify-center rounded-xl border bg-gradient-to-br to-transparent transition-colors duration-700', s.cls)}
              >
                <span className="font-display text-lg font-bold tabular-nums">{String(n).padStart(2, '0')}</span>
                <span className={cn('mt-1 h-1.5 w-1.5 rounded-full transition-colors duration-700', s.dot)} />
              </div>
            );
          })}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 60, rotate: 6 }} animate={{ opacity: 1, y: [0, -8, 0], rotate: 3 }}
        transition={{ opacity: { duration: 1, delay: 0.7 }, rotate: { duration: 1, delay: 0.7, ease: EASE_OUT }, y: { duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1.7 } }}
        className="glass mb-6 w-52 rounded-3xl p-4"
      >
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Utensils className="h-3.5 w-3.5 text-brand-400" /> Mesa 04
          <span className="ml-auto flex items-center gap-1"><Clock className="h-3 w-3" />42m</span>
        </div>
        {[['Bife de chorizo', '2'], ['Ñoquis de papa', '1'], ['Malbec copa', '3']].map(([n, q]) => (
          <div key={n} className="flex justify-between py-1 text-xs">
            <span className="text-foreground/80">{n}</span>
            <span className="tabular-nums text-muted-foreground">×{q}</span>
          </div>
        ))}
        <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</span>
          <span className="font-display text-lg font-bold text-gradient">$ 68.400</span>
        </div>
      </motion.div>
    </div>
  );
}
