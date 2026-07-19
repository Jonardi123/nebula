import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useEffect, useState } from 'react'
import { AmbientAssistant } from './components/AmbientAssistant'
import { captureScreen, type ScreenCaptureResult } from './lib/screen'
import { loadSettings } from './lib/settings'
import type { VoiceApprovalDecision, VoiceRequest, VoiceRunEvent } from './types/voice'

export function AmbientOverlayApp() {
  const [settings] = useState(loadSettings)
  const [latestCapture, setLatestCapture] = useState<ScreenCaptureResult | null>(null)
  const [captureError, setCaptureError] = useState('')
  const [active, setActive] = useState(true)
  const [runEvent, setRunEvent] = useState<VoiceRunEvent | null>(null)

  useEffect(() => {
    document.documentElement.classList.add('ambient-overlay-root')

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      void closeOverlay()
    }

    window.addEventListener('keydown', onKeyDown)
    if (settings.screenAwarenessEnabled) void runScreenCapture()
    const unlisteners = [
      listen('ambient-open', () => {
        setActive(true)
        setRunEvent(null)
        if (settings.screenAwarenessEnabled) void runScreenCapture()
      }),
      listen<VoiceRunEvent>('ambient-run-event', (event) => setRunEvent(event.payload)),
    ]

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.documentElement.classList.remove('ambient-overlay-root')
      void Promise.all(unlisteners).then((cleanups) => cleanups.forEach((cleanup) => cleanup()))
    }
  }, [settings.screenAwarenessEnabled])

  async function closeOverlay() {
    setActive(false)
    const current = getCurrentWebviewWindow()
    await current.hide().catch(() => undefined)
  }

  async function runScreenCapture() {
    setCaptureError('')
    try {
      setLatestCapture(await captureScreen())
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : String(error))
    }
  }

  async function submit(text: string, requestId: string) {
    const request: VoiceRequest = { requestId, text, source: 'ambient' }
    await emit('ambient-submit', request).catch(() => undefined)
  }

  return (
    <AmbientAssistant
      active={active}
      settings={settings}
      latestCapture={latestCapture}
      captureError={captureError}
      runEvent={runEvent}
      onClose={closeOverlay}
      onCaptureScreen={runScreenCapture}
      onSubmitVoice={submit}
      onCancelRequest={(requestId) => void emit('ambient-cancel', { requestId }).catch(() => undefined)}
      onApprovalDecision={(decision: VoiceApprovalDecision) => void emit('ambient-approval', decision).catch(() => undefined)}
    />
  )
}
