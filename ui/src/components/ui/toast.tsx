import type { Toast as ToastItem } from '@ui/hooks/use-toast';

const typeStyles = {
  success: 'bg-green-600/90 border-green-500',
  error: 'bg-red-600/90 border-red-500',
  info: 'bg-blue-600/90 border-blue-500',
};

interface ToastContainerProps {
  toasts: ToastItem[];
  onRemove: (id: number) => void;
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div class="fixed top-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          class={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm text-white shadow-lg
            animate-[slideIn_0.2s_ease-out] ${typeStyles[t.type]}`}
        >
          <span class="flex-1">{t.message}</span>
          <button onClick={() => onRemove(t.id)} class="text-white/70 hover:text-white cursor-pointer">&times;</button>
        </div>
      ))}
    </div>
  );
}
