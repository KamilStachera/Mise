/**
 * Sub-pages of the sections that have them — one list for the desktop sidebar (indented links)
 * and the phone section strip (`SectionNav`), so the two can't drift apart.
 */
export type SubPage = {
  key: string
  label: string
  to: string
  match: (pathname: string) => boolean
  /** Carry `?d=` across (Dzień ↔ Tydzień stay on the same date). */
  keepDay?: boolean
}

export const PLAN_PAGES: SubPage[] = [
  { key: 'dzien', label: 'Dzień', to: '/plan/dzien', match: (p) => p.startsWith('/plan/dzien'), keepDay: true },
  { key: 'tydzien', label: 'Tydzień', to: '/plan/tydzien', match: (p) => p.startsWith('/plan/tydzien'), keepDay: true },
  { key: 'postepy', label: 'Postępy', to: '/plan/postepy', match: (p) => p.startsWith('/plan/postepy') },
  { key: 'aktywnosc', label: 'Aktywność', to: '/plan/aktywnosc', match: (p) => p.startsWith('/plan/aktywnosc') },
]

export const TRAINING_PAGES: SubPage[] = [
  { key: 'dzis', label: 'Dziś', to: '/trening/dzis', match: (p) => p.startsWith('/trening/dzis') },
  { key: 'plan', label: 'Plan', to: '/trening/plan', match: (p) => p.startsWith('/trening/plan') || p.startsWith('/trening/ankieta') },
  { key: 'cwiczenia', label: 'Ćwiczenia', to: '/trening/cwiczenia', match: (p) => p.startsWith('/trening/cwiczenia') },
]

/** The phone's „Ja” tab — the desktop sidebar's „Twoja kuchnia” group, minus the admin panel. */
function mePages(canEdit: boolean): SubPage[] {
  return [
    { key: 'profil', label: 'Profil', to: '/profile', match: (p) => p === '/profile' || p.startsWith('/profile/ankieta') },
    ...(canEdit ? [{ key: 'cel', label: 'Cel', to: '/profile/cel', match: (p: string) => p.startsWith('/profile/cel') }] : []),
    { key: 'historia', label: 'Historia', to: '/history', match: (p) => p.startsWith('/history') },
  ]
}

/**
 * The phone strip for the current path, or null when the section has no sub-pages. Like the
 * sidebar, Plan and Trening sub-pages are for signed-in people only — anonymous visitors get
 * the week and the catalog, nothing to switch between.
 */
export function phoneSubPages(pathname: string, canEdit: boolean): SubPage[] | null {
  if (pathname.startsWith('/plan')) return canEdit ? PLAN_PAGES : null
  if (pathname.startsWith('/trening')) return canEdit ? TRAINING_PAGES : null
  if (pathname.startsWith('/profile') || pathname.startsWith('/history')) return mePages(canEdit)
  return null
}
