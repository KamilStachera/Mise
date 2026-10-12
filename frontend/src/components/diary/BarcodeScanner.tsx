import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { sans } from '../ui'

// BarcodeDetector is in Chrome on Android (her phone) but not in TS's DOM lib yet.
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike

function detectorCtor(): BarcodeDetectorCtor | null {
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector ?? null
}

export const canScanBarcodes = () => detectorCtor() != null && !!navigator.mediaDevices?.getUserMedia

/**
 * „Skanuj kod” (P11): full-screen rear camera with a frame and a scan line. Calls onCode once
 * with the first EAN/UPC it reads. Without camera or detector it says so and offers typing.
 */
export function BarcodeScanner({ onCode, onManual, onClose }: {
  onCode: (code: string) => void
  onManual: () => void
  onClose: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(canScanBarcodes() ? null : 'Ta przeglądarka nie czyta kodów kreskowych. Wpisz kod ręcznie.')
  const [torch, setTorch] = useState<boolean | null>(null)   // null = no torch on this camera
  const track = useRef<MediaStreamTrack | null>(null)

  useEffect(() => {
    const Ctor = detectorCtor()
    if (!Ctor) return
    let stopped = false
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout>
    const detector = new Ctor({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] })

    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then(async (s) => {
        stream = s
        if (stopped) return s.getTracks().forEach((t) => t.stop())
        track.current = s.getVideoTracks()[0]
        const caps = (track.current.getCapabilities?.() ?? {}) as { torch?: boolean }
        if (caps.torch) setTorch(false)
        if (video.current) {
          video.current.srcObject = s
          await video.current.play().catch(() => {})
        }
        const tick = async () => {
          if (stopped || !video.current) return
          try {
            const found = await detector.detect(video.current)
            const code = found.map((b) => b.rawValue).find((v) => /^\d{8,14}$/.test(v))
            if (code) {
              stopped = true
              navigator.vibrate?.(60)
              onCode(code)
              return
            }
          } catch { /* frame not ready yet */ }
          timer = setTimeout(tick, 250)
        }
        tick()
      })
      .catch(() => setError('Brak dostępu do aparatu. Zezwól na aparat w przeglądarce albo wpisz kod ręcznie.'))

    return () => {
      stopped = true
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onCode])

  async function toggleTorch() {
    if (!track.current || torch == null) return
    await track.current.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }).catch(() => {})
    setTorch(!torch)
  }

  const pill = { height: 44, padding: '0 16px', borderRadius: 999, border: '1px solid rgba(239,230,214,.35)', background: 'transparent', color: '#efe6d6', font: sans(14, 600), cursor: 'pointer' } as const
  // Per-side widths only: mixing the borderWidth shorthand with longhands upsets React.
  const corner = (pos: CSSProperties) => <span style={{ position: 'absolute', width: 36, height: 36, borderColor: '#efe6d6', borderStyle: 'solid', borderTopWidth: 0, borderRightWidth: 0, borderBottomWidth: 0, borderLeftWidth: 0, ...pos }} />

  return createPortal(
    <div role="dialog" aria-label="Skanuj kod" style={{ position: 'fixed', inset: 0, zIndex: 95, background: '#14100c', display: 'flex', flexDirection: 'column' }}>
      <video ref={video} playsInline muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: error ? 0 : 0.85 }} />
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', padding: 'calc(16px + env(safe-area-inset-top)) 16px 16px' }}>
        <button type="button" onClick={onClose} style={pill}>✕ Zamknij</button>
        {torch != null && <button type="button" onClick={toggleTorch} style={{ ...pill, background: torch ? '#efe6d6' : 'transparent', color: torch ? '#14100c' : '#efe6d6' }}>Latarka</button>}
      </div>
      <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {!error && (
          <div style={{ position: 'relative', width: 280, height: 170 }}>
            {corner({ left: 0, top: 0, borderLeftWidth: 3, borderTopWidth: 3 })}
            {corner({ right: 0, top: 0, borderRightWidth: 3, borderTopWidth: 3 })}
            {corner({ left: 0, bottom: 0, borderLeftWidth: 3, borderBottomWidth: 3 })}
            {corner({ right: 0, bottom: 0, borderRightWidth: 3, borderBottomWidth: 3 })}
            <span style={{ position: 'absolute', left: 14, right: 14, top: '50%', height: 2, background: 'var(--accent)' }} />
          </div>
        )}
      </div>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '0 28px 22px', textAlign: 'center', color: '#efe6d6' }}>
        <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 24 }}>{error ? 'Nie da się skanować' : 'Nakieruj na kod kreskowy'}</span>
        <span style={{ font: sans(14), color: '#b3a488', lineHeight: 1.45 }}>{error ?? 'Trzymaj telefon nieruchomo, ok. 15 cm od opakowania.'}</span>
      </div>
      <div style={{ position: 'relative', padding: '0 16px calc(16px + env(safe-area-inset-bottom))' }}>
        <button type="button" onClick={onManual} style={{ ...pill, width: '100%', height: 54, borderRadius: 14, font: sans(15, 600) }}>Wpisz kod ręcznie</button>
      </div>
    </div>,
    document.body,
  )
}
