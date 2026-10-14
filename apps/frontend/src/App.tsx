// ──────────────────────────────────────────────
// App.tsx — Root component
// Routea por permisos: sin "app.dashboard" → vista móvil; con él → panel.
// ──────────────────────────────────────────────
import { Toaster } from 'sonner';
import { BrandMark } from './components/ui/motion';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { WaiterMobileView } from './components/WaiterMobileView';
import { ConfirmDialogProvider } from './components/ui/confirm-dialog';

function AuthGate() {
  const { user, loading, can } = useAuth();

  if (loading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <BrandMark animated className="h-14 w-14" />
          <div className="h-1 w-24 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-full animate-shimmer bg-[linear-gradient(90deg,transparent,#fb6a26,transparent)] bg-[length:200%_100%]" />
          </div>
          <p className="text-sm">Cargando sesión...</p>
        </div>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  // Sin acceso al panel (por ejemplo, Mesero): vista móvil de toma de pedidos
  if (!can('app.dashboard')) return <WaiterMobileView />;

  // El resto usa el panel; cada sección se muestra según los permisos del rol
  return <DashboardPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <ConfirmDialogProvider>
        <AuthGate />
        <Toaster
          theme="dark"
          position="top-center"
          toastOptions={{
            style: {
              background: 'hsl(20 12% 9% / 0.92)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgb(255 255 255 / 0.08)',
              borderRadius: '18px',
              color: 'hsl(36 33% 96%)',
              fontFamily: 'inherit',
              boxShadow: '0 20px 40px -16px rgb(0 0 0 / 0.8)',
            },
          }}
        />
      </ConfirmDialogProvider>
    </AuthProvider>
  );
}
