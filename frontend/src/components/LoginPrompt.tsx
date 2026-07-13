import { useLocation } from 'react-router-dom'
import { loginUrl } from '../api/client'
import { LoginIcon } from './icons'

/** Full-page card shown instead of edit-only routes (add recipe, questionnaire) when anonymous. */
export function LoginPrompt({ title }: { title: string }) {
  const { pathname } = useLocation()
  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '80px 24px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', padding: '52px 28px', border: '1.5px dashed var(--border-2)', borderRadius: 18, background: 'var(--surface)' }}>
        <div style={{ width: 58, height: 58, borderRadius: 16, background: 'var(--card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', marginBottom: 4 }}>
          <LoginIcon size={27} />
        </div>
        <div style={{ fontFamily: "'Spectral', serif", fontSize: 21, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
        <div style={{ fontSize: 13.5, color: 'var(--text-2)', maxWidth: '42ch' }}>
          Przeglądanie jest otwarte dla wszystkich, ale zmiany wymagają zalogowania kontem Google z listy domowników.
        </div>
        <button
          onClick={() => { window.location.href = loginUrl(pathname) }}
          style={{ marginTop: 10, border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 10, padding: '10px 18px', font: "600 13.5px 'Hanken Grotesk'", cursor: 'pointer' }}
        >
          Zaloguj się przez Google
        </button>
      </div>
    </div>
  )
}
