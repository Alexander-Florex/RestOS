// ──────────────────────────────────────────────
// ConnectionBanner.tsx — Aviso visible cuando se corta la conexión (tarea 1.5)
// Espera unos segundos antes de mostrarse para no parpadear en cortes cortos.
// Al volver, avisa y las pantallas recargan sus datos (useResync).
// ──────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { WifiOff, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useConnectionStatus } from '../hooks/useConnection';

const SHOW_AFTER_MS = 3000;

export function ConnectionBanner() {
  const status = useConnectionStatus();
  const [visible, setVisible] = useState(false);
  const shownRef = useRef(false);

  useEffect(() => {
    if (status === 'disconnected') {
      const t = window.setTimeout(() => { setVisible(true); shownRef.current = true; }, SHOW_AFTER_MS);
      return () => window.clearTimeout(t);
    }
    setVisible(false);
    if (status === 'connected' && shownRef.current) {
      shownRef.current = false;
      toast.success('Conexión restablecida. Datos actualizados.');
    }
  }, [status]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role="alert"
          initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -40, opacity: 0 }}
          className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 border-b border-amber-400/30 bg-amber-950/95 px-4 py-2 text-sm text-amber-100 backdrop-blur"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
        >
          <WifiOff className="h-4 w-4 shrink-0" />
          <span className="font-medium">Sin conexión con el servidor.</span>
          <span className="hidden text-amber-200/80 sm:inline">Lo que envíes ahora puede no guardarse.</span>
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin opacity-70" aria-label="Reintentando" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
