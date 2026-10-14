import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold',
    'transition-[transform,background-color,border-color,color,box-shadow,opacity] duration-200 ease-out',
    'active:scale-[0.97] select-none',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-45',
  ].join(' '),
  {
    variants: {
      variant: {
        // Degradé brasa con brillo superior y resplandor
        default: [
          'text-white bg-gradient-to-b from-brand-400 to-brand-600',
          'shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_24px_-10px_rgb(251_106_38/0.8)]',
          'hover:from-brand-300 hover:to-brand-500 hover:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.3),0_10px_32px_-8px_rgb(251_106_38/0.9)]',
        ].join(' '),
        destructive: [
          'text-white bg-gradient-to-b from-rose-500 to-rose-600',
          'shadow-[inset_0_1px_0_0_rgb(255_255_255/0.2),0_8px_24px_-10px_rgb(244_63_94/0.7)]',
          'hover:from-rose-400 hover:to-rose-500',
        ].join(' '),
        outline: 'border border-white/10 bg-white/[0.03] text-foreground hover:bg-white/[0.07] hover:border-white/20',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent',
        ghost: 'text-muted-foreground hover:bg-white/[0.06] hover:text-foreground',
        link: 'text-brand-400 underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-11 px-5',
        sm: 'h-9 rounded-lg px-3 text-xs',
        lg: 'h-12 rounded-2xl px-7 text-[15px]',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = 'Button';

export { buttonVariants };
