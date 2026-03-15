import { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ComponentChildren;
  wide?: boolean;
}

export function Modal({ open, onClose, title, children, wide }: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/60" onClick={onClose} />
      <div class={`relative z-10 rounded-xl bg-slate-800 border border-slate-700 shadow-2xl
        ${wide ? 'w-full max-w-3xl' : 'w-full max-w-lg'} max-h-[90vh] overflow-y-auto mx-4`}>
        <div class="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <h2 class="text-lg font-semibold text-slate-100">{title}</h2>
          <button onClick={onClose} class="text-slate-400 hover:text-slate-200 text-xl cursor-pointer">&times;</button>
        </div>
        <div class="p-6">{children}</div>
      </div>
    </div>
  );
}
