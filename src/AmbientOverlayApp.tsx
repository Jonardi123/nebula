import { emit } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useEffect, useState } from 'react'
import { AmbientAssistant } from './components/AmbientAssistant'
import { captureScreen, type ScreenCaptureResult } from './lib/screen'
import { loadSettings } from './lib/settings'

export function AmbientOverlayApp() {
  const [settings] = useState(loadSettings)
  const [latestCapture, setLatestCapture] = useState<ScreenCaptureResult | null>(null)
  const [captureError, setCaptureError] = useState('')

  useEffect(() => {
    document.documentElement.classList.add('ambient-overlay-root')

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      void closeOverlay()
    }

    window.addEventListener('keydown', onKeyDown)
    if (settings.screenAwarenessEnabled) void runScreenCapture()

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.documentElement.classList.remove('ambient-overlay-root')
    }
  }, [settings.screenAwarenessEnabled])

  async function closeOverlay() {
    const current = getCurrentWebviewWindow()
    await current.hide().catch(() => undefined)
    await current.close().catch(() => undefined)
    await current.destroy().catch(() => undefined)
  }

  async function runScreenCapture() {
    setCaptureError('')
    try {
      setLatestCapture(await captureScreen())
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : String(error))
    }
  }

  async function submit(text: string) {
    await emit('ambient-submit', text).catch(() => undefined)
    await closeOverlay()
  }

  return (
    <AmbientAssistant
      active
      settings={settings}
      latestCapture={latestCapture}
      captureError={captureError}
      onClose={closeOverlay}
      onCaptureScreen={runScreenCapture}
      onSubmitVoice={submit}
    />
  )
}
