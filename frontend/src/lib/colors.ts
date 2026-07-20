// Ported from the Pichci design: derive gradient shades/tints from a recipe's tint.
function hexToRgb(h: string): [number, number, number] {
  h = h.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function toHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')
  return '#' + c(r) + c(g) + c(b)
}

export function shade(h: string, a: number): string {
  const [r, g, b] = hexToRgb(h)
  return toHex(r * (1 - a), g * (1 - a), b * (1 - a))
}

export function tint(h: string, a: number): string {
  const [r, g, b] = hexToRgb(h)
  return toHex(r + (255 - r) * a, g + (255 - g) * a, b + (255 - b) * a)
}

export function gradient(t: string): string {
  return `linear-gradient(140deg, ${t}, ${shade(t, 0.18)})`
}
