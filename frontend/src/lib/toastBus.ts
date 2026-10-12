// Tiny bridge for global toasts (same pattern as chatBus): anyone calls
// showToast(), the single <ToastHost/> in App registers the consumer.
// A toast fired before the host mounts is held until it does.

/** Optional inline action, e.g. „Cofnij” after a one-tap diary log. */
export interface ToastAction {
  label: string
  run: () => void
}

type Toast = { message: string; action?: ToastAction }

let consumer: ((toast: Toast) => void) | null = null
let pending: Toast | null = null

export function registerToastConsumer(fn: (toast: Toast) => void): () => void {
  consumer = fn
  if (pending !== null) {
    const p = pending
    pending = null
    fn(p)
  }
  return () => {
    if (consumer === fn) consumer = null
  }
}

export function showToast(message: string, action?: ToastAction): void {
  const toast = { message, action }
  if (consumer) consumer(toast)
  else pending = toast
}
