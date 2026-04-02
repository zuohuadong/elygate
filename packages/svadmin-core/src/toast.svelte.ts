export type ToastType = 'success' | 'error' | 'info' | 'warning' | 'undoable';

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  duration?: number;
  onUndo?: () => void;
  onTimeout?: () => void;
}

let nextId = 0;

// Queue for simple toasts (consumed by UI Toast bridge)
let queue = $state<ToastItem[]>([]);
export function getToastQueue() { return queue; }
export function consumeToastQueue() { queue = []; }

// Promise Queue
let promiseQueue = $state<{ id: number; promise: Promise<any>; opts: { loading: string; success: string; error: string } }[]>([]);
export function getPromiseQueue() { return promiseQueue; }
export function consumePromiseQueue() { promiseQueue = []; }

// Legacy compatibility — kept for existing consumers (Undoable)
let toasts = $state<ToastItem[]>([]);
export function getToasts(): ToastItem[] { return toasts; }

export function addToast(
  type: ToastType, 
  message: string, 
  duration = 3000, 
  options?: { onUndo?: () => void, onTimeout?: () => void }
): void {
  if (type !== 'undoable') {
    queue.push({ id: nextId++, type, message, duration });
    return;
  }
  const id = nextId++;
  toasts = [...toasts, { id, type, message, duration, ...options }];
}

export function removeToast(id: number): void {
  toasts = toasts.filter(t => t.id !== id);
}

// Convenience methods — backward compatible
export const toast = {
  success: (msg: string, duration?: number) => addToast('success', msg, duration),
  error: (msg: string, duration?: number) => addToast('error', msg, duration ?? 5000),
  info: (msg: string, duration?: number) => addToast('info', msg, duration),
  warning: (msg: string, duration?: number) => addToast('warning', msg, duration ?? 4000),
  undoable: (msg: string, duration: number, onUndo: () => void, onTimeout: () => void) =>
    addToast('undoable', msg, duration, { onUndo, onTimeout }),
  /** Promise toast — shows loading → success/error automatically */
  promise: <T>(promise: Promise<T>, opts: { loading: string; success: string; error: string }) => {
    promiseQueue.push({ id: nextId++, promise, opts });
    return promise;
  },
};
