import { createContext } from 'preact';
import { useCallback, useContext, useState } from 'preact/hooks';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  remove: (id: number) => void;
}

export const ToastContext = createContext<ToastState>({
  toasts: [],
  success: () => {},
  error: () => {},
  info: () => {},
  remove: () => {},
});

export function useToast(): ToastState {
  return useContext(ToastContext);
}

let nextId = 1;

export function useToastProvider(): ToastState {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const add = useCallback((type: ToastType, message: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return {
    toasts,
    success: (msg: string) => add('success', msg),
    error: (msg: string) => add('error', msg),
    info: (msg: string) => add('info', msg),
    remove,
  };
}
