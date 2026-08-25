import type { CSSProperties } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { FoodShoppingList } from '../components/FoodShoppingList'
import { SupplyShoppingList } from '../components/SupplyShoppingList'
import { useIsMobile } from '../lib/useIsMobile'

function tabStyle(active: boolean): CSSProperties {
  return {
    border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
    background: active ? 'var(--accent)' : 'var(--card)',
    color: active ? '#fff' : 'var(--text-2)',
    borderRadius: 20,
    padding: '8px 16px',
    font: "500 13px 'Hanken Grotesk'",
    cursor: 'pointer',
    transition: 'all .14s',
  }
}

/**
 * Two independent lists behind one nav entry: groceries and household supplies. The tab
 * lives in the path (not just state) so it survives a reload and can be linked to; the
 * nav rail matches on the /shopping prefix, so both paths keep it highlighted.
 */
export function Shopping() {
  const isMobile = useIsMobile()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const home = pathname.startsWith('/shopping/dom')

  return (
    <div style={{ maxWidth: 660, margin: '0 auto', padding: isMobile ? '22px 14px 28px' : '38px 42px 60px' }}>
      <div style={{ font: "600 11px 'Hanken Grotesk'", letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 7 }}>
        Do kupienia
      </div>
      <h1 style={{ fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: isMobile ? 30 : 38, margin: '0 0 14px' }}>
        {home ? 'Dom i chemia' : 'Lista zakupów'}
      </h1>

      <div style={{ display: 'flex', gap: 7, marginBottom: 18 }}>
        <button onClick={() => nav('/shopping')} style={tabStyle(!home)}>Jedzenie</button>
        <button onClick={() => nav('/shopping/dom')} style={tabStyle(home)}>Dom</button>
      </div>

      {home ? <SupplyShoppingList /> : <FoodShoppingList />}
    </div>
  )
}
