// ──────────────────────────────────────────────
// confirm-dialog.tsx — Confirmación imperativa (reemplaza window.confirm)
// Uso: const confirm = useConfirm(); const ok = await confirm({ title: '...' });
// ──────────────────────────────────────────────
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './dialog';
import { Button } from './button';

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'destructive' resalta el botón de confirmar en rojo y muestra un ícono de alerta — usar para borrados y acciones irreversibles. */
  variant?: 'default' | 'destructive';
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...opts, resolve });
    });
  }, []);

  function settle(result: boolean) {
    state?.resolve(result);
    setState(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={state !== null} onOpenChange={(v) => !v && settle(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {state?.variant === 'destructive' && (
                <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
              )}
              {state?.title}
            </DialogTitle>
            {state?.description && <DialogDescription>{state.description}</DialogDescription>}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => settle(false)}>
              {state?.cancelLabel ?? 'Cancelar'}
            </Button>
            <Button
              variant={state?.variant === 'destructive' ? 'destructive' : 'default'}
              onClick={() => settle(true)}
            >
              {state?.confirmLabel ?? 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

/** Devuelve una función `confirm(opts)` que resuelve `true`/`false` según lo que elija el usuario. */
export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm debe usarse dentro de <ConfirmDialogProvider>');
  return ctx;
}
