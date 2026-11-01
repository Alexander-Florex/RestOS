// ──────────────────────────────────────────────
// PrintButton.tsx — Botón de imprimir comanda
//
// Imprime el agente local del restaurante (recibe el pedido por socket y
// sabe cuál es su impresora). Por eso el botón no pide elegir impresora:
// funciona igual desde la PC de caja que desde el celular de un mozo.
// ──────────────────────────────────────────────
import { useState } from 'react';
import { toast } from 'sonner';
import { Printer, Loader2 } from 'lucide-react';
import { ApiError } from '../lib/api';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

interface PrintButtonProps {
  /** Qué imprimir */
  onPrint: () => Promise<void>;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'icon';
  label?: string;
  className?: string;
  /** Si true, muestra solo el ícono */
  iconOnly?: boolean;
  disabled?: boolean;
}

export function PrintButton({
  onPrint, variant = 'outline', size = 'sm',
  label = 'Imprimir comanda', className, iconOnly = false, disabled,
}: PrintButtonProps) {
  const [printing, setPrinting] = useState(false);

  async function handleClick() {
    setPrinting(true);
    try {
      await onPrint();
      toast.success('Comanda enviada a imprimir');
    } catch (err) {
      toast.error(`No se pudo imprimir: ${err instanceof ApiError ? err.message : 'revisá la impresora'}`);
    } finally {
      setPrinting(false);
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      className={cn('gap-2', className)}
      disabled={disabled || printing}
      onClick={handleClick}
      title={label}
    >
      {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
      {!iconOnly && (printing ? 'Imprimiendo...' : label)}
    </Button>
  );
}
