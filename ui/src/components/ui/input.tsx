import { JSX } from 'preact';

interface InputProps {
  label?: string;
  error?: string;
  class?: string;
  [key: string]: unknown;
}

export function Input({ label, error, class: cls, id, ...props }: InputProps) {
  const inputId = (id as string) || label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div class={`flex flex-col gap-1 ${cls || ''}`}>
      {label && (
        <label for={inputId} class="text-sm font-medium text-slate-300">
          {label}
        </label>
      )}
      <input
        id={inputId}
        class={`w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200
          placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
          ${error ? 'border-red-500' : ''}`}
        {...(props as JSX.HTMLAttributes<HTMLInputElement>)}
      />
      {error && <span class="text-xs text-red-400">{error}</span>}
    </div>
  );
}
