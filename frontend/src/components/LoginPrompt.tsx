import { useLocation } from 'react-router-dom'
import { loginUrl } from '../api/client'
import { Button, sans, usePagePad } from './ui'

/** Shown instead of edit-only routes (add recipe, questionnaire) when anonymous. */
export function LoginPrompt({ title }: { title: string }) {
  const { pathname } = useLocation()
  const pad = usePagePad()
  return (
    <div style={{ ...pad, maxWidth: 640, margin: '0 auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 14, padding: '28px 0', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 32, lineHeight: 1.1 }}>{title}</span>
        <span style={{ font: sans(15), lineHeight: 1.5, color: 'var(--text-2)', maxWidth: '46ch' }}>
          Przeglądanie jest otwarte dla wszystkich, ale zmiany wymagają zalogowania kontem Google z listy domowników.
        </span>
        <Button onClick={() => { window.location.href = loginUrl(pathname) }}>Zaloguj się przez Google</Button>
      </div>
    </div>
  )
}
