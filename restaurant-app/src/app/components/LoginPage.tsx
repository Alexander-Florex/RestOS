import { useState } from 'react';
import { UtensilsCrossed, Eye, EyeOff, Lock, User, Wifi } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  const demoAccounts = [
    { role: 'Administrador', username: 'admin',    password: 'admin123',  color: 'emerald', desc: 'Acceso total' },
    { role: 'Mesero',        username: 'mesero1',  password: 'waiter123', color: 'blue',    desc: 'Toma de pedidos' },
    { role: 'Personal',      username: 'personal1',password: 'staff123',  color: 'purple',  desc: 'Mesas · Menú · Ventas' },
  ];

  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    blue:    'bg-blue-500/10 border-blue-500/30 text-blue-400',
    purple:  'bg-purple-500/10 border-purple-500/30 text-purple-400',
  };
  const dotMap: Record<string, string> = {
    emerald: 'bg-emerald-400',
    blue:    'bg-blue-400',
    purple:  'bg-purple-400',
  };

  return (
    <div className="min-h-screen bg-[#0B1120] flex items-center justify-center p-4">
      {/* BG gradient */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500 mb-4 shadow-lg shadow-emerald-500/30">
            <UtensilsCrossed className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">RestOS</h1>
          <p className="text-gray-400 mt-2 text-sm">Sistema de gestión de restaurante</p>
          <div className="flex items-center justify-center gap-1.5 mt-2">
            <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs text-emerald-400">Conectividad en tiempo real</span>
          </div>
        </div>

        {/* Login card */}
        <div className="bg-[#111827] border border-gray-800 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-lg font-semibold text-white mb-6">Iniciar sesión</h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Usuario</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="Ingresá tu usuario"
                  className="w-full bg-[#1E293B] border border-gray-700 rounded-xl pl-10 pr-4 py-3 text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-emerald-500 transition-colors"
                  required
                  autoComplete="username"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-[#1E293B] border border-gray-700 rounded-xl pl-10 pr-11 py-3 text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-emerald-500 transition-colors"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 mt-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Ingresando...
                </>
              ) : 'Ingresar'}
            </button>
          </form>
        </div>

        {/* Demo accounts */}
        <div className="mt-6">
          <p className="text-center text-xs text-gray-500 mb-3">Cuentas de demostración</p>
          <div className="space-y-2">
            {demoAccounts.map(acc => (
              <button
                key={acc.username}
                onClick={() => { setUsername(acc.username); setPassword(acc.password); }}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all hover:scale-[1.01] active:scale-[0.99] ${colorMap[acc.color]}`}
              >
                <div className={`w-2 h-2 rounded-full ${dotMap[acc.color]}`} />
                <div className="flex-1 text-left">
                  <span className="text-sm font-medium">{acc.role}</span>
                  <span className="text-xs ml-2 opacity-60">{acc.desc}</span>
                </div>
                <code className="text-xs opacity-60">{acc.username}</code>
              </button>
            ))}
          </div>
          <p className="text-center text-xs text-gray-600 mt-3">
            Hacé clic en un rol para auto-completar · contraseña = user + "123" / "waiter123" / "staff123"
          </p>
        </div>
      </div>
    </div>
  );
}
