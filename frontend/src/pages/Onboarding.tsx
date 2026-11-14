import { useState, type FormEvent, type ReactNode } from 'react'
import { errorText, loginUrl } from '../api/client'
import { useAuth, useLogout, useRedeemInvite } from '../api/hooks'
import { Button, Eyebrow, Wordmark, inputStyle, mono, sans } from '../components/ui'

/** Full-page frame for the two screens shown before someone belongs to a household. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100%', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px', background: 'var(--bg)', overflowY: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 22 }}>
        <Wordmark size={36} />
        {children}
      </div>
    </div>
  )
}

/** Anonymous visitor on a server without a public household: the only thing to do is sign in. */
export function Welcome() {
  return (
    <Frame>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--rule)', paddingTop: 18 }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 34, lineHeight: 1.05, letterSpacing: '-0.02em' }}>
          Wasza wspólna kuchnia
        </h1>
        <span style={{ font: sans(15), lineHeight: 1.55, color: 'var(--text-2)' }}>
          Przepisy, spiżarnia, zakupy i plan posiłków dla całego domu. Zaloguj się kontem Google —
          jeśli dostałeś kod zaproszenia, wpiszesz go zaraz potem.
        </span>
      </div>
      <Button onClick={() => { window.location.href = loginUrl('/') }}>Zaloguj się przez Google</Button>
    </Frame>
  )
}

/** Blocked by an admin (the person or their whole household). Data is kept; only an admin can lift it. */
export function Blocked() {
  const { data: auth } = useAuth()
  const logout = useLogout()
  return (
    <Frame>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--rule)', paddingTop: 18 }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 34, lineHeight: 1.05, letterSpacing: '-0.02em' }}>
          Konto zablokowane
        </h1>
        <span style={{ font: sans(15), lineHeight: 1.55, color: 'var(--text-2)' }}>
          {auth?.email ? <>Konto <b style={{ fontWeight: 600, color: 'var(--text)' }}>{auth.email}</b> zostało</> : 'To konto zostało'} zablokowane
          przez administratora Pichci. Twoje dane są zachowane — skontaktuj się z administratorem, żeby odzyskać dostęp.
        </span>
      </div>
      <Button variant="outline" onClick={() => logout.mutate()}>Zaloguj innym kontem</Button>
    </Frame>
  )
}

/** Signed in with Google but in no household yet: redeem an invite code (new household or join one). */
export function Onboarding() {
  const { data: auth } = useAuth()
  const logout = useLogout()
  const redeem = useRedeemInvite()
  const [code, setCode] = useState('')
  const [name, setName] = useState(() => (auth?.name ?? '').split(' ')[0] ?? '')

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!code.trim() || !name.trim()) return
    redeem.mutate({ code: code.trim(), name: name.trim() })
  }

  return (
    <Frame>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--rule)', paddingTop: 18 }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 34, lineHeight: 1.05, letterSpacing: '-0.02em' }}>
          Masz kod zaproszenia?
        </h1>
        <span style={{ font: sans(15), lineHeight: 1.55, color: 'var(--text-2)' }}>
          Konto <b style={{ fontWeight: 600, color: 'var(--text)' }}>{auth?.email}</b> nie należy jeszcze do żadnego domu.
          Wpisz kod od osoby, która cię zaprasza — założy ci nową kuchnię albo dołączy cię do istniejącej.
        </span>
      </div>

      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <Eyebrow>Kod</Eyebrow>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXXX-XXXXX"
            autoFocus
            autoComplete="one-time-code"
            spellCheck={false}
            style={{ ...inputStyle, font: mono(18, 500), letterSpacing: '0.12em', textAlign: 'center' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <Eyebrow>Jak cię nazywać</Eyebrow>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Imię" style={inputStyle} />
        </label>
        {redeem.isError && (
          <span role="alert" style={{ font: sans(14), color: 'var(--accent-text)' }}>
            {(redeem.error as { status?: number })?.status === 429
              ? 'Za dużo prób — odczekaj kilka minut.'
              : errorText(redeem.error, 'Nie udało się użyć kodu.')}
          </span>
        )}
        <Button type="submit" disabled={redeem.isPending || !code.trim() || !name.trim()}>
          {redeem.isPending ? 'Przygotowuję kuchnię…' : 'Dołącz'}
        </Button>
      </form>

      <span style={{ font: sans(13.5), lineHeight: 1.5, color: 'var(--text-3)' }}>
        Nie masz kodu? Poproś domownika o zaproszenie (Profil → Domownicy).{' '}
        <button type="button" onClick={() => logout.mutate()} style={{ border: 0, padding: 0, background: 'transparent', color: 'var(--text-2)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>
          Zaloguj innym kontem
        </button>
      </span>
    </Frame>
  )
}
