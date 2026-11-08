import type { CSSProperties } from 'react'
import type { Muscle } from '../../api/training'
import { muscleLabel } from '../../lib/labels'
import { mono } from '../ui'
import { anteriorData, posteriorData, type BodyRegion } from './bodyMapData'

/** Catalog muscle groups (free-exercise-db) → drawn regions. */
const REGIONS: Record<Muscle, BodyRegion[]> = {
  abdominals: ['abs', 'obliques'],
  abductors: ['abductors'],
  adductors: ['adductor'],
  biceps: ['biceps'],
  calves: ['calves', 'left-soleus', 'right-soleus'],
  chest: ['chest'],
  forearms: ['forearm'],
  glutes: ['gluteal'],
  hamstrings: ['hamstring'],
  lats: ['upper-back'],
  'lower-back': ['lower-back'],
  'middle-back': ['upper-back'],
  neck: ['neck'],
  quadriceps: ['quadriceps'],
  shoulders: ['front-deltoids', 'back-deltoids'],
  traps: ['trapezius'],
  triceps: ['triceps'],
}

/** A tapped region → the muscle filter it stands for (upper back reads as lats). */
const REGION_TO_MUSCLE: Partial<Record<BodyRegion, Muscle>> = {
  abs: 'abdominals', obliques: 'abdominals', abductors: 'abductors', adductor: 'adductors',
  biceps: 'biceps', calves: 'calves', 'left-soleus': 'calves', 'right-soleus': 'calves', chest: 'chest',
  forearm: 'forearms', gluteal: 'glutes', hamstring: 'hamstrings', 'upper-back': 'lats',
  'lower-back': 'lower-back', neck: 'neck', quadriceps: 'quadriceps', 'front-deltoids': 'shoulders',
  'back-deltoids': 'shoulders', trapezius: 'traps', triceps: 'triceps',
}

const BASE = 'var(--border)'
const INERT = 'var(--seg-bg)' // head, knees — not muscles

/**
 * Front and back silhouettes with the exercise's primary muscles in accent and the secondary
 * ones in a lighter accent. With `onPick`, regions are buttons (the catalog's muscle filter).
 */
export function BodyMap({ primary, secondary = [], onPick, height = 220, legend = true, style }: {
  primary: Muscle[]
  secondary?: Muscle[]
  onPick?: (m: Muscle) => void
  height?: number
  legend?: boolean
  style?: CSSProperties
}) {
  const primaryRegions = new Set(primary.flatMap((m) => REGIONS[m]))
  const secondaryRegions = new Set(secondary.flatMap((m) => REGIONS[m]))

  const fill = (r: BodyRegion) =>
    primaryRegions.has(r) ? 'var(--accent)'
      : secondaryRegions.has(r) ? 'var(--accent-warm)'
      : r === 'head' || r === 'knees' ? INERT : BASE

  const figure = (data: typeof anteriorData, label: string) => (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg viewBox="0 0 1000 2200" style={{ height, width: 'auto', display: 'block' }} role="img" aria-label={label}>
        {data.flatMap((d) => d.svgPoints.map((points, i) => {
          const muscle = REGION_TO_MUSCLE[d.muscle]
          const clickable = !!onPick && !!muscle
          return (
            <polygon
              key={`${d.muscle}-${i}`}
              points={points}
              fill={fill(d.muscle)}
              stroke="var(--bg)"
              strokeWidth={6}
              onClick={clickable ? () => onPick!(muscle!) : undefined}
              style={{ cursor: clickable ? 'pointer' : undefined, transition: 'fill .15s' }}
            >
              {muscle && <title>{muscleLabel[muscle]}</title>}
            </polygon>
          )
        }))}
      </svg>
      <figcaption style={{ font: mono(10, 500), letterSpacing: '.1em', color: 'var(--text-3)' }}>{label.toUpperCase()}</figcaption>
    </figure>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, ...style }}>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 18 }}>
        {figure(anteriorData, 'Przód')}
        {figure(posteriorData, 'Tył')}
      </div>
      {legend && (primary.length > 0 || secondary.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px 14px', font: mono(11, 500), color: 'var(--text-2)' }}>
          {primary.length > 0 && <Swatch color="var(--accent)" label={`Główne: ${primary.map((m) => muscleLabel[m]).join(', ')}`} />}
          {secondary.length > 0 && <Swatch color="var(--accent-warm)" label={`Pomocnicze: ${secondary.map((m) => muscleLabel[m]).join(', ')}`} />}
        </div>
      )}
    </div>
  )
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, flex: '0 0 10px' }} />
      {label}
    </span>
  )
}
