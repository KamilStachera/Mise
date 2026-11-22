import { useSyncExternalStore } from 'react'

/**
 * Look of the app, chosen per device on the Profile screen (Wygląd). Themes are pure CSS: tokens.css
 * re-points the colour/font variables under `html[data-theme]` (and `data-rose-bg` for the rose
 * theme's three grounds). index.html applies the saved choice before first paint — keep its inline
 * script in sync with STORAGE_KEY and the attribute names here.
 */
export type ThemeId = 'paper' | 'night' | 'rose'
export type RoseBg = 'blush' | 'lavender' | 'sage'
export type ThemeChoice = { theme: ThemeId; roseBg: RoseBg }

export const STORAGE_KEY = 'pichci:theme'
const DEFAULT: ThemeChoice = { theme: 'paper', roseBg: 'blush' }

export const THEMES: { id: ThemeId; label: string; sub: string }[] = [
  { id: 'paper', label: 'Domyślny', sub: 'Papier, atrament, jeden akcent' },
  { id: 'night', label: 'Ciemny', sub: 'Kuchnia po zmroku' },
  { id: 'rose', label: 'Róż i śliwka', sub: 'Dusty rose, śliwka, szałwia' },
]

export const ROSE_BGS: { id: RoseBg; label: string; hex: string }[] = [
  { id: 'blush', label: 'Blush Pink', hex: '#F5E8EA' },
  { id: 'lavender', label: 'Lavender Mist', hex: '#EFEBF4' },
  { id: 'sage', label: 'Soft Sage Grey', hex: '#EEF0EB' },
]

/** Browser chrome colour (Android status bar, installed PWA) per theme. */
function chromeColor(c: ThemeChoice): string {
  if (c.theme === 'night') return '#16120e'
  if (c.theme === 'rose') return ROSE_BGS.find((b) => b.id === c.roseBg)!.hex
  return '#f5f0e6'
}

const ROSE_FONTS =
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Manrope:wght@300;400;500;600;700&family=DM+Mono:ital,wght@0,400;0,500;1,400&display=swap'

/** The rose theme's fonts are only fetched by people who pick it (or open the picker's previews). */
export function ensureRoseFonts() {
  if (document.getElementById('pichci-rose-fonts')) return
  const link = document.createElement('link')
  link.id = 'pichci-rose-fonts'
  link.rel = 'stylesheet'
  link.href = ROSE_FONTS
  document.head.appendChild(link)
}

function read(): ThemeChoice {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<ThemeChoice> | null
    return {
      theme: THEMES.some((t) => t.id === raw?.theme) ? raw!.theme! : DEFAULT.theme,
      roseBg: ROSE_BGS.some((b) => b.id === raw?.roseBg) ? raw!.roseBg! : DEFAULT.roseBg,
    }
  } catch {
    return DEFAULT
  }
}

let current = read()
const listeners = new Set<() => void>()

export function applyTheme(c: ThemeChoice) {
  const root = document.documentElement
  root.setAttribute('data-theme', c.theme)
  root.setAttribute('data-rose-bg', c.roseBg)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', chromeColor(c))
  if (c.theme === 'rose') ensureRoseFonts()
}

/** Called once from main.tsx (index.html already set the attributes; this adds fonts + chrome colour). */
export function initTheme() {
  applyTheme(current)
}

export function setTheme(patch: Partial<ThemeChoice>) {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    /* private mode: the choice lasts for this tab only */
  }
  applyTheme(current)
  listeners.forEach((l) => l())
}

export function useTheme(): ThemeChoice {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}
