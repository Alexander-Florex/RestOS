// ──────────────────────────────────────────────
// NotificationToggle.tsx — Botón en el topbar para activar/desactivar notificaciones
// ──────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { toast } from 'sonner';
import { notificationPrefs, browserNotifications } from '../lib/notifications';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

export function NotificationToggle() {
  const [enabled, setEnabled] = useState(notificationPrefs.enabled());

  // Pedir permiso de browser notifications al montar (si todavía no se decidió)
  useEffect(() => {
    if (enabled && browserNotifications.isSupported() && browserNotifications.permission() === 'default') {
      browserNotifications.requestPermission().catch(() => {});
    }
  }, [enabled]);

  function toggle() {
    const next = !enabled;
    notificationPrefs.setEnabled(next);
    setEnabled(next);
    if (next) {
      toast.success('Notificaciones activadas', {
        description: 'Vas a escuchar un sonido cuando llegue un pedido o pidan la cuenta',
      });
      // Pedir permiso si todavía no se hizo
      if (browserNotifications.isSupported() && browserNotifications.permission() === 'default') {
        browserNotifications.requestPermission().catch(() => {});
      }
    } else {
      toast.info('Notificaciones silenciadas');
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      title={enabled ? 'Silenciar notificaciones' : 'Activar notificaciones'}
      aria-label={enabled ? 'Silenciar notificaciones' : 'Activar notificaciones'}
      className={cn(enabled && 'text-emerald-400')}
    >
      {enabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
    </Button>
  );
}
