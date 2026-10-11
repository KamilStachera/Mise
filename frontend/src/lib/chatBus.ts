// Tiny bridge so pages can open the chat sidebar with a prompt (e.g. the
// random view's "ask Sous" link). App registers the opener; ChatSidebar
// registers the consumer. A prompt requested while the sidebar is closed is
// held until the sidebar mounts and consumes it.

let openChat: (() => void) | null = null
let consumer: ((prompt: string) => void) | null = null
let pending: string | null = null

export function registerChatOpener(fn: () => void): () => void {
  openChat = fn
  return () => {
    if (openChat === fn) openChat = null
  }
}

export function registerPromptConsumer(fn: (prompt: string) => void): () => void {
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

/** Open Sous; with a prompt, send it as soon as the panel is ready. */
export function requestChat(prompt?: string): void {
  if (prompt) {
    if (consumer) consumer(prompt)
    else pending = prompt
  }
  openChat?.()
}
