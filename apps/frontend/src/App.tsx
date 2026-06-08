// ──────────────────────────────────────────────
// App.tsx — Root component
// Routea por rol: WAITER → vista móvil; ADMIN/STAFF → dashboard.
// ──────────────────────────────────────────────
import { Toaster } from 'sonner';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { WaiterMobileView } from './components/WaiterMobileView';

function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
          <p className="text-sm">Cargando sesión...</p>
        </div>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  // Los meseros van directo a su vista móvil
  if (user.role === 'WAITER') return <WaiterMobileView />;

  // Admin y staff comparten el mismo dashboard (los permisos finos viven en cada componente)
  return <DashboardPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
      <Toaster
        theme="dark"
        position="top-right"
        toastOptions={{
          style: {
            background: 'hsl(222 47% 9%)',
            border: '1px solid hsl(217 33% 22%)',
            color: 'white',
          },
        }}
      />
    </AuthProvider>
  );
}
