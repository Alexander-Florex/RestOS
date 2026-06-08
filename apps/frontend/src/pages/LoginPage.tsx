// ──────────────────────────────────────────────
// LoginPage.tsx — Pantalla de inicio de sesión
// ──────────────────────────────────────────────
import { useState, type FormEvent } from 'react';
import { ChefHat, Eye, EyeOff, Loader2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { ApiError } from '../lib/api';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Completá usuario y contraseña.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await login(username.trim(), password);
      toast.success('Sesión iniciada', { description: `Bienvenido, ${username}` });
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message :
        err instanceof Error ? err.message :
        'Error desconocido al iniciar sesión.';
      setError(msg);
      setSubmitting(false);
    }
  }

  function fillDemo(user: string, pass: string) {
    setUsername(user);
    setPassword(pass);
    setError(null);
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-background flex items-center justify-center p-4">
      {/* Fondo decorativo: grid sutil + glow emerald */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -right-40 h-[480px] w-[480px] rounded-full bg-emerald-500/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -left-40 h-[480px] w-[480px] rounded-full bg-emerald-500/5 blur-3xl"
      />

      <div className="relative z-10 w-full max-w-md animate-fade-in">
        {/* Logo + marca */}
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-500/30">
            <ChefHat className="h-6 w-6 text-emerald-400" strokeWidth={2.25} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">RestOS</h1>
            <p className="text-xs text-muted-foreground">Gestión de restaurante</p>
          </div>
        </div>

        <Card>
          <CardHeader className="space-y-1.5 text-center">
            <CardTitle className="text-2xl">Iniciar sesión</CardTitle>
            <CardDescription>Ingresá con tu usuario y contraseña</CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Usuario</Label>
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  placeholder="admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={submitting}
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                    className="pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Ingresando...
                  </>
                ) : (
                  <>
                    Ingresar
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>

            {/* Cuentas demo */}
            <div className="mt-6 border-t border-border pt-5">
              <p className="mb-3 text-center text-xs uppercase tracking-wider text-muted-foreground">
                Cuentas demo (tap para autocompletar)
              </p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { user: 'admin',     pass: 'admin123',  label: 'Admin'   },
                  { user: 'mesero1',   pass: 'waiter123', label: 'Mesero'  },
                  { user: 'personal1', pass: 'staff123',  label: 'Personal'},
                ].map(d => (
                  <button
                    key={d.user}
                    type="button"
                    disabled={submitting}
                    onClick={() => fillDemo(d.user, d.pass)}
                    className="rounded-lg border border-border bg-secondary/50 px-2 py-2 text-xs text-foreground/80 hover:bg-secondary hover:text-foreground hover:border-emerald-500/40 transition-colors disabled:opacity-50"
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          ¿Problemas para ingresar? Hablá con el administrador.
        </p>
      </div>
    </div>
  );
}
