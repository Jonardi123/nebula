import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeVoiceError, splitRecognitionResults, VoiceRecognitionService } from './voiceRecognition'

class RecognitionMock {
  static available = vi.fn<() => Promise<'available' | 'unavailable' | 'downloadable' | 'downloading' | 'unknown'>>(async () => 'available')
  static install = vi.fn(async () => true)
  lang = ''
  continuous = false
  interimResults = false
  processLocally = false
  onstart: (() => void) | null = null
  onresult: ((event: never) => void) | null = null
  onerror: ((event: never) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn(() => this.onstart?.())
  stop = vi.fn(() => this.onend?.())
  abort = vi.fn()
}

function installBrowserMock() {
  Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: RecognitionMock })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
  })
}

afterEach(() => {
  Reflect.deleteProperty(window, 'SpeechRecognition')
  vi.restoreAllMocks()
})

describe('voice recognition reliability', () => {
  it('normalizes browser permission and audio failures', () => {
    expect(normalizeVoiceError({ error: 'not-allowed' }).code).toBe('microphone_denied')
    expect(normalizeVoiceError({ error: 'service-not-allowed' }).code).toBe('speech_permission_denied')
    expect(normalizeVoiceError({ error: 'audio-capture' }).code).toBe('audio_capture_failure')
  })

  it('keeps final and interim transcript text separate', () => {
    const result = splitRecognitionResults({
      results: Object.assign([
        Object.assign([{ transcript: 'hello' }], { isFinal: true }),
        Object.assign([{ transcript: 'world' }], { isFinal: false }),
      ], {}),
    })
    expect(result).toEqual({ finalText: 'hello', interimText: 'world' })
  })

  it('selects the local WebView engine when the language is available', async () => {
    installBrowserMock()
    const onEngine = vi.fn()
    const service = new VoiceRecognitionService({ language: 'en-US', mode: 'local_first', allowOnline: false, callbacks: { onEngine } })
    await expect(service.prepare()).resolves.toMatchObject({ engine: 'webview_local', localAvailability: 'available' })
    service.start()
    expect(onEngine).toHaveBeenCalledWith('webview_local', 'available')
    service.dispose()
  })

  it('requires explicit consent before an online fallback', async () => {
    installBrowserMock()
    RecognitionMock.available.mockResolvedValueOnce('unavailable')
    const service = new VoiceRecognitionService({ language: 'sq-AL', mode: 'local_first', allowOnline: false })
    await expect(service.prepare()).rejects.toMatchObject({ code: 'unsupported_language', requiresOnlineConsent: true })
  })

  it('reports a missing microphone as a capture failure', async () => {
    installBrowserMock()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => { throw new DOMException('No input device', 'NotFoundError') }) },
    })
    const service = new VoiceRecognitionService({ language: 'en-US', mode: 'local_first', allowOnline: false })
    await expect(service.prepare()).rejects.toMatchObject({ code: 'audio_capture_failure' })
  })
})
