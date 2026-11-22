import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { useRecipes } from '../api/hooks'
import { recipeCardImage } from '../lib/images'
import { useIsMobile } from '../lib/useIsMobile'
import { ROSE_BGS, THEMES, ensureRoseFonts, setTheme, useTheme, type RoseBg, type ThemeId } from '../lib/theme'
import { Eyebrow, SectionHead, sans } from './ui'

/**
 * Profil → Wygląd. Each option is a miniature of the Przepisy screen rendered in its own theme
 * (the theme blocks in tokens.css apply to any element with data-theme), so the choice is made by
 * looking, not by reading names. The rose theme adds a second row comparing its three grounds.
 * Saved per device (localStorage), like a browser setting — no account involved.
 */
export function AppearanceSettings() {
  const isMobile = useIsMobile()
  const choice = useTheme()
  const { data: recipes } = useRecipes('all', '')
  const photo = recipes?.find((r) => r.imageUrl)?.imageUrl
  const photoUrl = photo ? recipeCardImage(photo) : null

  // The previews need the rose fonts even before anyone picks the theme.
  useEffect(ensureRoseFonts, [])

  const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: isMobile ? 8 : 14 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SectionHead title="Motyw" meta="na tym urządzeniu" size={20} />
      <div role="radiogroup" aria-label="Motyw" style={grid}>
        {THEMES.map((t) => (
          <Option
            key={t.id}
            selected={choice.theme === t.id}
            onPick={() => setTheme({ theme: t.id })}
            label={t.label}
            sub={isMobile ? undefined : t.sub}
          >
            <MiniScreen theme={t.id} roseBg={choice.roseBg} photoUrl={photoUrl} />
          </Option>
        ))}
      </div>

      {choice.theme === 'rose' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6 }}>
          <Eyebrow>Tło — porównaj i wybierz</Eyebrow>
          <div role="radiogroup" aria-label="Tło" style={grid}>
            {ROSE_BGS.map((b) => (
              <Option
                key={b.id}
                selected={choice.roseBg === b.id}
                onPick={() => setTheme({ roseBg: b.id })}
                label={b.label}
                sub={b.hex}
                mono
              >
                <MiniScreen theme="rose" roseBg={b.id} photoUrl={photoUrl} />
              </Option>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Option({ selected, onPick, label, sub, mono, children }: {
  selected: boolean
  onPick: () => void
  label: string
  sub?: string
  mono?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onPick}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, padding: 0, border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
    >
      <span
        style={{
          display: 'block',
          borderRadius: 12,
          outline: selected ? '2px solid var(--ink)' : '1px solid var(--border)',
          outlineOffset: selected ? 2 : 0,
          transition: 'outline-color .15s',
        }}
      >
        {children}
      </span>
      <span style={{ display: 'flex', alignItems: 'flex-start', gap: 6, minWidth: 0 }}>
        <span
          aria-hidden
          style={{
            width: 14,
            height: 14,
            flex: '0 0 14px',
            borderRadius: '50%',
            boxSizing: 'border-box',
            border: selected ? '4px solid var(--ink)' : '1px solid var(--border-2)',
          }}
        />
        <span style={{ font: sans(13.5, selected ? 600 : 500), lineHeight: 1.2, minWidth: 0 }}>{label}</span>
      </span>
      {sub && (
        <span style={{ font: mono ? '400 11.5px var(--mono)' : sans(12.5), color: 'var(--text-3)', lineHeight: 1.35, marginTop: -4, paddingLeft: 20 }}>{sub}</span>
      )}
    </button>
  )
}

/** A tiny Przepisy screen: title, filter chips, photo card, action, tab bar — all on theme tokens. */
function MiniScreen({ theme, roseBg, photoUrl }: { theme: ThemeId; roseBg: RoseBg; photoUrl: string | null }) {
  return (
    <span
      data-theme={theme}
      data-rose-bg={roseBg}
      aria-hidden
      style={{
        display: 'flex',
        flexDirection: 'column',
        aspectRatio: '9 / 14',
        overflow: 'hidden',
        borderRadius: 12,
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'var(--sans)',
      }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10% 9% 0', flex: 1, minHeight: 0 }}>
        <span style={{ font: '500 6.5px var(--mono)', letterSpacing: '.1em', color: 'var(--text-3)' }}>KSIĄŻKA · 64</span>
        <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 21, lineHeight: 0.95, letterSpacing: '-0.03em', color: 'var(--title)' }}>Przepisy</span>
        <span style={{ display: 'flex', gap: 3, paddingBottom: 5, borderBottom: '1px solid var(--rule)' }}>
          <MiniChip on>Wszystkie</MiniChip>
          <MiniChip>Obiad</MiniChip>
        </span>
        <span
          style={{
            display: 'block',
            flex: '1 1 0',
            minHeight: 24,
            borderRadius: 6,
            background: photoUrl ? `center / cover no-repeat url("${photoUrl}")` : 'var(--accent-soft)',
          }}
        />
        <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 4 }}>
          <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 11, lineHeight: 1.05, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Leczo z cukinią</span>
          <span style={{ font: '500 7px var(--mono)', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>540 kcal</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, font: '500 6.5px var(--sans)', color: 'var(--sage-text)' }}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--sage)' }} />
          masz wszystko
        </span>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 15, borderRadius: 4, background: 'var(--accent)', color: 'var(--on-accent)', font: '600 7px var(--sans)', marginBottom: 7 }}>
          Ugotuj
        </span>
      </span>
      <span style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderTop: '1px solid var(--rule)', background: 'var(--bg)' }}>
        {['Przepisy', 'Plan', 'Zakupy', 'Ja'].map((l, i) => (
          <span
            key={l}
            style={{
              height: 15,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              font: '600 5.5px var(--sans)',
              color: i === 0 ? 'var(--nav-active-text)' : 'var(--text-3)',
              background: i === 0 ? 'linear-gradient(var(--nav-active), var(--nav-active)) top / 100% 1.5px no-repeat' : 'transparent',
            }}
          >
            {l}
          </span>
        ))}
      </span>
    </span>
  )
}

function MiniChip({ on, children }: { on?: boolean; children: string }) {
  return (
    <span
      style={{
        padding: '2px 5px',
        borderRadius: 999,
        border: `1px solid ${on ? 'var(--ink)' : 'var(--border)'}`,
        background: on ? 'var(--ink)' : 'transparent',
        color: on ? 'var(--on-ink)' : 'var(--text)',
        font: '500 6px var(--sans)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}
