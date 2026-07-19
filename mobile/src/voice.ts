import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export type MobileVoicePhase = 'idle' | 'permission' | 'preparing' | 'listening' | 'submit_countdown' | 'thinking' | 'speaking' | 'error'

export interface MobileVoiceFailure {
  code: 'microphone_denied' | 'speech_permission_denied' | 'unsupported_language' | 'unavailable_service' | 'no_speech' | 'network_failure' | 'audio_capture_failure' | 'cancelled'
  message: string
  requiresOnlineConsent?: boolean
}

interface NativeVoiceStatus {
  microphone: 'granted' | 'denied' | 'prompt' | 'restricted' | 'unknown'
  speech: 'granted' | 'denied' | 'prompt' | 'restricted' | 'unknown'
  available: boolean
  supportsOnDevice: boolean
  locale: string
}

interface NativeVoicePlugin {
  getStatus(options: { locale: string }): Promise<NativeVoiceStatus>
  requestPermissions(): Promise<{ microphone: string; speech: string }>
  startListening(options: { locale: string; preferOnDevice: boolean; allowOnline: boolean }): Promise<{ engine: 'apple_local' | 'apple_online'; supportsOnDevice: boolean }>
  stopListening(): Promise<void>
  cancelListening(): Promise<void>
  speak(options: { text: string; locale: string; rate: number; pitch: number }): Promise<void>
  stopSpeaking(): Promise<void>
  openSettings(): Promise<void>
  addListener(event: 'voiceResult', callback: (result: { text: string; isFinal: boolean }) => void): Promise<PluginListenerHandle>
  addListener(event: 'voiceState', callback: (state: { phase: MobileVoicePhase; engine?: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'voiceError', callback: (error: { code?: string; message?: string }) => void): Promise<PluginListenerHandle>
}

type BrowserRecognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}

type BrowserRecognitionConstructor = new () => BrowserRecognition

const NativeVoice = registerPlugin<NativeVoicePlugin>('NebulaVoice')

function browserConstructor() {
  const target = window as Window & { SpeechRecognition?: BrowserRecognitionConstructor; webkitSpeechRecognition?: BrowserRecognitionConstructor }
  return target.SpeechRecognition || target.webkitSpeechRecognition
}

function failureFrom(error: unknown): MobileVoiceFailure {
  const candidate = error as { code?: string; message?: string; error?: string }
  const raw = String(candidate?.code || candidate?.error || '').toUpperCase()
  if (raw.includes('ONLINE_CONSENT')) return { code: 'unsupported_language', message: candidate.message || "This language requires Apple's online speech service.", requiresOnlineConsent: true }
  if (raw.includes('MICROPHONE') || raw === 'NOT-ALLOWED') return { code: 'microphone_denied', message: 'Allow microphone access for Nebula in iOS Settings.' }
  if (raw.includes('SPEECH_PERMISSION') || raw.includes('SERVICE-NOT-ALLOWED')) return { code: 'speech_permission_denied', message: 'Allow Speech Recognition for Nebula in iOS Settings.' }
  if (raw.includes('AUDIO')) return { code: 'audio_capture_failure', message: candidate.message || 'The microphone could not start.' }
  if (raw.includes('NO-SPEECH')) return { code: 'no_speech', message: 'I did not hear any speech.' }
  if (raw.includes('NETWORK')) return { code: 'network_failure', message: 'The online speech service could not be reached.' }
  if (raw.includes('CANCEL')) return { code: 'cancelled', message: 'Voice input was cancelled.' }
  return { code: 'unavailable_service', message: candidate?.message || 'Voice recognition is unavailable.' }
}

export interface MobileVoiceCallbacks {
  onPhase?: (phase: MobileVoicePhase) => void
  onInterim?: (text: string) => void
  onFinal?: (text: string) => void
  onEnd?: () => void
  onError?: (failure: MobileVoiceFailure) => void
}

export class MobileVoiceController {
  private browser: BrowserRecognition | null = null
  private listeners: PluginListenerHandle[] = []
  private cancelled = false
  private readonly callbacks: MobileVoiceCallbacks

  constructor(callbacks: MobileVoiceCallbacks) {
    this.callbacks = callbacks
  }

  async status(locale: string) {
    if (!Capacitor.isNativePlatform()) return { native: false, available: Boolean(browserConstructor()), supportsOnDevice: false }
    const status = await NativeVoice.getStatus({ locale })
    return { native: true, ...status }
  }

  async start(options: { locale: string; allowOnline: boolean }) {
    this.cancelled = false
    this.callbacks.onPhase?.('permission')
    if (Capacitor.isNativePlatform()) {
      await this.attachNativeListeners()
      let status = await NativeVoice.getStatus({ locale: options.locale })
      if (status.microphone === 'prompt' || status.speech === 'prompt') {
        await NativeVoice.requestPermissions()
        status = await NativeVoice.getStatus({ locale: options.locale })
      }
      if (status.microphone !== 'granted') throw failureFrom({ code: 'MICROPHONE_DENIED' })
      if (status.speech !== 'granted') throw failureFrom({ code: 'SPEECH_PERMISSION_DENIED' })
      this.callbacks.onPhase?.('preparing')
      try {
        await NativeVoice.startListening({ locale: options.locale, preferOnDevice: true, allowOnline: options.allowOnline })
      } catch (error) {
        throw failureFrom(error)
      }
      return
    }

    const Recognition = browserConstructor()
    if (!Recognition) throw failureFrom({ message: 'Voice recognition is unavailable here. Use iPhone keyboard dictation instead.' })
    if (!options.allowOnline) throw failureFrom({ code: 'ONLINE_CONSENT_REQUIRED', message: 'Browser voice recognition may use an online service. Allow it once or use keyboard dictation.' })
    const instance = new Recognition()
    instance.lang = options.locale
    instance.interimResults = true
    instance.continuous = false
    instance.onresult = (event) => {
      const final: string[] = []
      const interim: string[] = []
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index]
        const value = result?.[0]?.transcript?.trim() || ''
        if (!value) continue
        if (result.isFinal) final.push(value)
        else interim.push(value)
      }
      this.callbacks.onInterim?.(interim.join(' '))
      if (final.length) this.callbacks.onFinal?.(final.join(' '))
    }
    instance.onerror = (error) => {
      if (!this.cancelled) this.callbacks.onError?.(failureFrom(error))
    }
    instance.onend = () => this.callbacks.onEnd?.()
    this.browser = instance
    this.callbacks.onPhase?.('listening')
    instance.start()
  }

  async stop() {
    if (Capacitor.isNativePlatform()) await NativeVoice.stopListening().catch(() => undefined)
    else this.browser?.stop()
  }

  async cancel() {
    this.cancelled = true
    if (Capacitor.isNativePlatform()) await NativeVoice.cancelListening().catch(() => undefined)
    else this.browser?.abort()
    this.browser = null
    this.callbacks.onPhase?.('idle')
  }

  async speak(options: { text: string; locale: string; rate: number; pitch: number }) {
    if (Capacitor.isNativePlatform()) {
      await this.attachNativeListeners()
      await NativeVoice.speak(options)
      return
    }
    if (!('speechSynthesis' in window)) return
    speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(options.text)
    utterance.lang = options.locale
    utterance.rate = options.rate
    utterance.pitch = options.pitch
    utterance.onstart = () => this.callbacks.onPhase?.('speaking')
    utterance.onend = () => this.callbacks.onPhase?.('idle')
    utterance.onerror = () => this.callbacks.onPhase?.('idle')
    speechSynthesis.speak(utterance)
  }

  async stopSpeaking() {
    if (Capacitor.isNativePlatform()) await NativeVoice.stopSpeaking().catch(() => undefined)
    else speechSynthesis?.cancel()
  }

  async openSettings() {
    if (Capacitor.isNativePlatform()) await NativeVoice.openSettings()
  }

  async dispose() {
    await this.cancel()
    this.listeners.forEach((listener) => void listener.remove())
    this.listeners = []
  }

  private async attachNativeListeners() {
    if (this.listeners.length) return
    this.listeners = await Promise.all([
      NativeVoice.addListener('voiceResult', (result) => {
        if (result.isFinal) this.callbacks.onFinal?.(result.text)
        else this.callbacks.onInterim?.(result.text)
      }),
      NativeVoice.addListener('voiceState', (state) => {
        this.callbacks.onPhase?.(state.phase)
        if (state.phase === 'idle' && !this.cancelled) this.callbacks.onEnd?.()
      }),
      NativeVoice.addListener('voiceError', (error) => {
        if (!this.cancelled) this.callbacks.onError?.(failureFrom(error))
      }),
    ])
  }
}
