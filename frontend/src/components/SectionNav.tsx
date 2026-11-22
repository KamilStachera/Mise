import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth, useShopping, useSupplies } from '../api/hooks'
import { phoneSubPages } from '../lib/navModel'
import { mono, sans } from './ui'

/** Height of the strip below the safe area. */
export const SECTION_NAV_HEIGHT = 44

/**
 * Phones: the second level of navigation, pinned to the top of <main> — what the desktop
 * sidebar shows as indented links under Plan and Trening (plus Jedzenie · Dom · Spiżarnia under
 * Zakupy and the „Twoja kuchnia” group under „Ja”). Equal cells like the tab bar below it; the tab bar marks its active cell on the top
 * edge, this strip on the bottom edge, under the label.
 */
export function SectionNav() {
  const { pathname, search } = useLocation()
  const nav = useNavigate()
  const { canEdit, isLoading } = useAuth()
  const pages = isLoading ? null : phoneSubPages(pathname, canEdit)
  const { data: food } = useShopping()
  const { data: home } = useSupplies()
  if (!pages) return null
  const counts = {
    food: food ? food.total - food.checkedCount : 0,
    home: home ? home.total - home.checkedCount : 0,
  }
  const day = new URLSearchParams(search).get('d')

  return (
    <nav
      aria-label="Podstrony"
      style={{
        position: 'sticky',
        top: 0,
        // Over page content, under sheets and the pinned bars' layer (20).
        zIndex: 15,
        background: 'var(--bg)',
        // The page gutter (usePagePad), so the rule lines up with the rules below it.
        padding: '0 20px',
        paddingTop: 'env(safe-area-inset-top)',
      }}
    >
      <div
        style={{
          display: 'grid',
          // At least the label's width („Historia gotowania”), then the rest shared equally.
          gridTemplateColumns: `repeat(${pages.length}, minmax(max-content, 1fr))`,
          columnGap: 8,
          borderBottom: '1px solid var(--rule)',
        }}
      >
        {pages.map((p) => {
          const on = p.match(pathname)
          return (
            <button
              key={p.key}
              type="button"
              aria-current={on ? 'page' : undefined}
              onClick={() => { if (!on) nav(p.keepDay && day ? `${p.to}?d=${day}` : p.to) }}
              style={{
                height: SECTION_NAV_HEIGHT,
                display: 'flex',
                alignItems: 'stretch',
                justifyContent: 'center',
                padding: 0,
                border: 0,
                background: 'transparent',
                cursor: on ? 'default' : 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '3px 2px 0',
                  whiteSpace: 'nowrap',
                  font: sans(14, 600),
                  color: on ? 'var(--nav-active-text)' : 'var(--text-3)',
                  boxShadow: on ? 'inset 0 -3px 0 var(--nav-active)' : undefined,
                }}
              >
                {p.label}
                {p.count && counts[p.count] > 0 && (
                  <span style={{ font: mono(11, 600), color: 'var(--accent-text)', marginLeft: 5 }}>{counts[p.count]}</span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
