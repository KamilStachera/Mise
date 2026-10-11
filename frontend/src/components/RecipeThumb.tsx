import type { CSSProperties } from 'react'
import { gradient } from '../lib/colors'
import { recipeCardImage } from '../lib/images'

/**
 * Recipe photo with the card thumbnail (falls back to the original on error)
 * or, without a photo, the tint gradient with the title's first letter.
 */
export function RecipeThumb({ r, style, full = false, letterSize = 40 }: {
  r: { imageUrl: string | null; tint: string; title: string }
  style?: CSSProperties
  /** Use the original image instead of the 400px card thumbnail (heroes). */
  full?: boolean
  letterSize?: number
}) {
  const box: CSSProperties = { position: 'relative', overflow: 'hidden', background: gradient(r.tint), flexShrink: 0, ...style }
  if (!r.imageUrl)
    return (
      <div style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: 'var(--serif)', fontSize: letterSize, fontWeight: 500, color: 'rgba(255,255,255,.9)', lineHeight: 1 }}>{r.title[0]}</span>
      </div>
    )
  return (
    <div style={box}>
      <img
        src={full ? r.imageUrl : recipeCardImage(r.imageUrl)}
        alt=""
        loading="lazy"
        decoding="async"
        onError={(e) => { if (e.currentTarget.getAttribute('src') !== r.imageUrl) e.currentTarget.src = r.imageUrl! }}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    </div>
  )
}

/** "masz wszystko" (sage) / "N do kupienia" (accent). */
export function StockNote({ toBuy, short = false }: { toBuy: number; short?: boolean }) {
  return toBuy === 0 ? (
    <span style={{ color: 'var(--sage-text)', whiteSpace: 'nowrap' }}>● masz wszystko</span>
  ) : (
    <span style={{ color: 'var(--accent-text)', whiteSpace: 'nowrap' }}>{short ? `brakuje ${toBuy}` : `${toBuy} do kupienia`}</span>
  )
}
