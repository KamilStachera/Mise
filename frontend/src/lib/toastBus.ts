// Tiny bridge for global toasts (same pattern as chatBus): anyone calls
// showToast(), the single <ToastHost/> in App registers the consumer.
// A toast fired before the host mounts is held until it does.

let consumer: ((message: string) => void) | null = null
let pending: string | null = null

export function registerToastConsumer(fn: (message: string) => void): () => void {
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

export function showToast(message: string): void {
  if (consumer) consumer(message)
  else pending = message
}
