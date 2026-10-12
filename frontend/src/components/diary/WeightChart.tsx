import { useEffect, useRef, useState } from 'react'
import type { WeightPoint } from '../../api/client'
import { MONTHS_SHORT, addDays, parseISODate, toISO } from '../../lib/dates'
import { mono } from '../ui'

const kgText = (kg: number) => kg.toFixed(1).replace('.', ',')

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/**
 * Weight over the last `days`: weigh-ins as small muted dots (they jump around), the 7-day
 * trend as the one accent line with an end dot + value, the goal as a dashed reference.
 * A crosshair snaps to the nearest weigh-in and shows date, weight and trend.
 */
export function WeightChart({ points, goalKg, days, height }: {
  points: WeightPoint[]
  goalKg: number | null
  days: number
  height: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  const today = new Date()
  const start = addDays(today, -days + 1)
  const pad = { l: 30, r: 46, t: 10, b: 26 }
  const w = Math.max(0, width - pad.l - pad.r)
  const h = height - pad.t - pad.b

  const values = [...points.flatMap((p) => [p.kg, p.trend]), ...(goalKg ? [goalKg] : [])]
  const lo = values.length ? Math.floor((Math.min(...values) - 0.5) / 2) * 2 : 60
  const hi = values.length ? Math.ceil((Math.max(...values) + 0.5) / 2) * 2 : 70
  const span = Math.max(hi - lo, 2)
  const dayIndex = (iso: string) => Math.round((parseISODate(iso).getTime() - start.getTime()) / 86_400_000)
  const x = (iso: string) => pad.l + (dayIndex(iso) / Math.max(1, days - 1)) * w
  const y = (kg: number) => pad.t + (1 - (kg - lo) / span) * h

  const step = span > 8 ? 4 : 2
  const grid = Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => lo + i * step)
  const tickEvery = width < 520 ? 14 : 7
  const ticks = Array.from({ length: Math.ceil(days / tickEvery) }, (_, i) => toISO(addDays(start, i * tickEvery)))

  const trendPath = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.trend).toFixed(1)}`).join('')
  const last = points[points.length - 1]
  const hovered = hover != null ? points[hover] : null

  function onMove(clientX: number) {
    if (!ref.current || points.length === 0) return
    const px = clientX - ref.current.getBoundingClientRect().left
    let best = 0
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(x(points[i].date) - px) < Math.abs(x(points[best].date) - px)) best = i
    }
    setHover(best)
  }

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={last ? `Waga: ostatnio ${kgText(last.kg)} kg, trend ${kgText(last.trend)} kg` : 'Brak ważeń'}
          onPointerMove={(e) => onMove(e.clientX)}
          onPointerLeave={() => setHover(null)}
          style={{ display: 'block', touchAction: 'pan-y' }}
        >
          {grid.map((g) => (
            <g key={g}>
              <line x1={pad.l} x2={pad.l + w} y1={y(g)} y2={y(g)} stroke="var(--border)" strokeWidth={1} />
              <text x={pad.l - 8} y={y(g) + 3.5} textAnchor="end" style={{ font: mono(10.5), fill: 'var(--text-3)' }}>{g}</text>
            </g>
          ))}
          {ticks.map((t) => {
            const d = parseISODate(t)
            return (
              <text key={t} x={x(t)} y={height - 6} textAnchor="middle" style={{ font: mono(10.5), fill: 'var(--text-3)' }}>
                {d.getDate()} {MONTHS_SHORT[d.getMonth()]}
              </text>
            )
          })}
          {goalKg != null && goalKg >= lo && goalKg <= hi && (
            <g>
              <line x1={pad.l} x2={pad.l + w} y1={y(goalKg)} y2={y(goalKg)} stroke="var(--text)" strokeWidth={1} strokeDasharray="4 4" />
              <text x={pad.l + w + 6} y={y(goalKg) + 3.5} style={{ font: mono(10.5), fill: 'var(--text-2)' }}>cel {String(goalKg).replace('.', ',')}</text>
            </g>
          )}
          {hovered && <line x1={x(hovered.date)} x2={x(hovered.date)} y1={pad.t} y2={pad.t + h} stroke="var(--text-3)" strokeWidth={1} />}
          {points.map((p, i) => (
            <circle key={p.date} cx={x(p.date)} cy={y(p.kg)} r={hover === i ? 4 : 2.6} fill="var(--text-3)" opacity={hover === i ? 1 : 0.75} stroke={hover === i ? 'var(--bg)' : 'none'} strokeWidth={2} />
          ))}
          {points.length > 1 && <path d={trendPath} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {last && (
            <g>
              <circle cx={x(last.date)} cy={y(last.trend)} r={4.5} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2} />
              <text x={x(last.date) + 9} y={y(last.trend) + 4} style={{ font: mono(11.5, 500), fill: 'var(--text)' }}>{kgText(last.trend)}</text>
            </g>
          )}
        </svg>
      )}
      {hovered && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: Math.min(Math.max(0, x(hovered.date) - 90), Math.max(0, width - 180)),
            width: 180,
            padding: '7px 10px',
            borderRadius: 10,
            background: 'var(--text)',
            color: 'var(--bg)',
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <span style={{ font: mono(15, 600) }}>{kgText(hovered.kg)} kg</span>
          <span style={{ font: mono(11), color: 'var(--on-dark-muted)' }}>
            {parseISODate(hovered.date).getDate()} {MONTHS_SHORT[parseISODate(hovered.date).getMonth()]} · trend {kgText(hovered.trend)}
          </span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 18, paddingTop: 8, font: mono(11.5), color: 'var(--text-2)', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-3)' }} />ważenie</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 16, height: 2, background: 'var(--accent)' }} />trend 7 dni</span>
        {goalKg != null && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 16, borderTop: '1px dashed var(--text)' }} />cel</span>}
      </div>
    </div>
  )
}
