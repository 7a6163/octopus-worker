import { JSX } from 'preact';

interface SelectProps {
  label?: string;
  options: { value: string | number; label: string }[];
  class?: string;
  [key: string]: unknown;
}

export function Select({ label, options, class: cls, id, ...props }: SelectProps) {
  const selectId = (id as string) || label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div class="flex flex-col gap-1">
      {label && (
        <label for={selectId} class="text-sm font-medium text-slate-300">
          {label}
        </label>
      )}
      <select
        id={selectId}
        class={`rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200
          focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${cls || ''}`}
        {...(props as JSX.HTMLAttributes<HTMLSelectElement>)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
