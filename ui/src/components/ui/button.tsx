import { ComponentChildren, JSX } from 'preact';

type Variant = 'primary' | 'danger' | 'ghost' | 'secondary';

interface ButtonProps {
  variant?: Variant;
  loading?: boolean;
  size?: 'sm' | 'md';
  children?: ComponentChildren;
  class?: string;
  disabled?: boolean;
  [key: string]: unknown;
}

const variants: Record<Variant, string> = {
  primary: 'bg-blue-600 hover:bg-blue-700 text-white',
  danger: 'bg-red-600 hover:bg-red-700 text-white',
  ghost: 'bg-transparent hover:bg-slate-700 text-slate-300',
  secondary: 'bg-slate-700 hover:bg-slate-600 text-slate-200',
};

const sizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
};

export function Button({ variant = 'primary', loading, size = 'md', children, disabled, class: cls, ...props }: ButtonProps) {
  return (
    <button
      class={`inline-flex items-center justify-center rounded-lg font-medium transition-colors
        ${variants[variant]} ${sizes[size]}
        ${disabled || loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${cls || ''}`}
      disabled={disabled || loading}
      {...(props as JSX.HTMLAttributes<HTMLButtonElement>)}
    >
      {loading && <span class="mr-2 animate-spin">&#9696;</span>}
      {children}
    </button>
  );
}
