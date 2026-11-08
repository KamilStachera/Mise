import { useState } from 'react'
import { mono, sans } from '../ui'

/**
 * Click-to-load YouTube player: a thumbnail first, the youtube-nocookie iframe only after a tap,
 * so a list of exercises never loads a dozen players (or YouTube cookies) up front.
 */
export function YouTubeEmbed({ id, start, title, channel }: {
  id: string
  start?: number | null
  title?: string | null
  channel?: string | null
}) {
  const [playing, setPlaying] = useState(false)
  const params = new URLSearchParams({ autoplay: '1', rel: '0', playsinline: '1', modestbranding: '1' })
  if (start) params.set('start', String(start))

  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ position: 'relative', aspectRatio: '16 / 9', borderRadius: 12, overflow: 'hidden', background: 'var(--text)' }}>
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${id}?${params}`}
            title={title ?? 'Film instruktażowy'}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label="Odtwórz film"
            style={{ position: 'absolute', inset: 0, border: 0, padding: 0, cursor: 'pointer', background: 'transparent' }}
          >
            <img
              src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
              alt=""
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
            <span
              aria-hidden
              style={{
                position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
                width: 64, height: 46, borderRadius: 12, background: 'rgba(29,24,19,.82)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <span style={{ width: 0, height: 0, borderTop: '10px solid transparent', borderBottom: '10px solid transparent', borderLeft: '17px solid #f5f0e6', marginLeft: 4 }} />
            </span>
          </button>
        )}
      </div>
      {(title || channel) && (
        <figcaption style={{ font: sans(12.5), color: 'var(--text-3)', lineHeight: 1.35 }}>
          {title}
          {channel && <span style={{ font: mono(11, 500) }}>{title ? ' · ' : ''}{channel}</span>}
        </figcaption>
      )}
    </figure>
  )
}

/** Until a demo is picked: a YouTube search for the exercise (Polish name first). */
export function youtubeSearchUrl(namePl: string | null, nameEn: string): string {
  const q = namePl ? `${namePl} jak wykonać ćwiczenie` : `${nameEn} exercise proper form`
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`
}
