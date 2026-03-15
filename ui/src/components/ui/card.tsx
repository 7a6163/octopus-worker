import { ComponentChildren } from 'preact';

interface CardProps {
  title?: string;
  children: ComponentChildren;
  class?: string;
}

export function Card({ title, children, class: cls }: CardProps) {
  return (
    <div class={`rounded-xl border border-slate-700 bg-slate-800/50 ${cls || ''}`}>
      {title && (
        <div class="border-b border-slate-700 px-5 py-3">
          <h3 class="font-medium text-slate-200">{title}</h3>
        </div>
      )}
      <div class="p-5">{children}</div>
    </div>
  );
}
