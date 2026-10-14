import * as React from 'react';
import { cn } from '../../lib/utils';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm',
        'ring-offset-background placeholder:text-muted-foreground resize-none',
        'hover:border-white/15 focus-visible:outline-none focus-visible:border-brand-400/60 focus-visible:bg-white/[0.05] focus-visible:ring-4 focus-visible:ring-brand-500/15',
        'disabled:cursor-not-allowed disabled:opacity-50 transition-colors',
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';
