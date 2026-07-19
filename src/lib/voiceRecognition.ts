import type { VoiceEngine, VoiceFailure } from '../types/voice'

type SpeechRecognitionResultLike = ArrayLike<{ transcript?: string }>

type SpeechRecognitionEventLike = {
  results: ArrayLike<SpeechRecognitionResultLike & { isFinal?: boolean }>
}

type SpeechRecognitionErrorLike = { error?: string; message?: string }

export type BrowserSpeechRecognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  processLocally?: boolean
  onstart: (() => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type LocalAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unknown'

type RecognitionOptions = { langs: string[]; processLocally: boolean }

type SpeechRecognitionConstructor = {
  new (): BrowserSpeechRecognition
  available?: (options: RecognitionOptions) => Promise<LocalAvailability>
  install?: (options: RecognitionOptions) => Promise<boolean>
}

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

export interface VoiceRecognitionCallbacks {
  onEngine?: (engine: VoiceEngine, localAvailability: LocalAvailability) => void
  onStart?: () => void
  onInterim?: (text: string) => void
  onFinal?: (text: string) => void
  onEnd?: () => void
  onError?: (failure: VoiceFailure) => void
}

export interface VoiceRecognitionOptions {
  language: string
  mode: 'local_first' | 'online' | 'text_only'
  allowOnline: boolean
  callbacks?: VoiceRecognitionCallbacks
}

function constructorForWindow() {
  if (typeof window === 'undefined') return undefined
  const speechWindow = window as SpeechWindow
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
}

export function isVoiceRecognitionSupported() {
  return Boolean(constructorForWindow())
}

export function normalizeVoiceError(error: SpeechRecognitionErrorLike | unknown): VoiceFailure {
  const rawCode = typeof error === 'object' && error && 'error' in error ? String(error.error || '') : ''
  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String(error.message || '')
      : String(error || '')
  const code = rawCode.toLowerCase()

  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return {
      code: code === 'service-not-allowed' ? 'speech_permission_denied' : 'microphone_denied',
      message: code === 'service-not-allowed'
        ? 'Windows speech recognition is blocked. Allow speech services, then try again.'
        : 'Nebula cannot use the microphone. Allow microphone access, then try again.',
      recoverable: true,
      rawCode,
    }
  }
  if (code === 'language-not-supported') {
    return { code: 'unsupported_language', message: 'This language is not available for local recognition.', recoverable: true, rawCode }
  }
  if (code === 'no-speech') {
    return { code: 'no_speech', message: 'I did not hear any speech. Tap the nebula and try again.', recoverable: true, rawCode }
  }
  if (code === 'network') {
    return { code: 'network_failure', message: 'The online speech service could not be reached.', recoverable: true, rawCode }
  }
  if (code === 'audio-capture') {
    return { code: 'audio_capture_failure', message: 'Windows could not capture audio from the selected microphone.', recoverable: true, rawCode }
  }
  if (code === 'aborted') {
    return { code: 'cancelled', message: 'Voice input was cancelled.', recoverable: true, rawCode }
  }
  return {
    code: 'unavailable_service',
    message: rawMessage || 'Speech recognition is unavailable right now.',
    recoverable: true,
    rawCode,
  }
}

export function splitRecognitionResults(event: SpeechRecognitionEventLike) {
  const finalParts: string[] = []
  const interimParts: string[] = []
  for (let index = 0; index < event.results.length; index += 1) {
    const result = event.results[index]
    const text = String(result?.[0]?.transcript || '').trim()
    if (!text) continue
    if (result.isFinal) finalParts.push(text)
    else interimParts.push(text)
  }
  return {
    finalText: finalParts.join(' ').replace(/\s+/g, ' ').trim(),
    interimText: interimParts.join(' ').replace(/\s+/g, ' ').trim(),
  }
}

async function requestMicrophonePermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw { code: 'audio_capture_failure', message: 'This WebView cannot access a microphone.', recoverable: false } satisfies VoiceFailure
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((track) => track.stop())
  } catch (error) {
    const name = error instanceof DOMException ? error.name.toLowerCase() : ''
    if (name === 'notfounderror' || name === 'notreadableerror' || name === 'aborterror') {
      throw {
        code: 'audio_capture_failure',
        message: name === 'notfounderror'
          ? 'Nebula could not find a microphone. Connect or enable one, then try again.'
          : 'Windows could not start the selected microphone. Close other audio apps, then try again.',
        recoverable: true,
      } satisfies VoiceFailure
    }
    const failure = normalizeVoiceError({ error: 'not-allowed', message: error instanceof Error ? error.message : String(error) })
    throw failure
  }
}

export class VoiceRecognitionService {
  private recognition: BrowserSpeechRecognition | null = null
  private stopped = false
  private errored = false
  private aborted = false
  private engine: VoiceEngine = 'text'
  private localAvailability: LocalAvailability = 'unknown'
  private readonly options: VoiceRecognitionOptions

  constructor(options: VoiceRecognitionOptions) {
    this.options = options
  }

  async prepare() {
    if (this.options.mode === 'text_only') {
      throw { code: 'unavailable_service', message: 'Voice recognition is disabled in settings.', recoverable: true } satisfies VoiceFailure
    }
    const Recognition = constructorForWindow()
    if (!Recognition) {
      throw { code: 'unavailable_service', message: 'Speech recognition is not supported by this WebView.', recoverable: false } satisfies VoiceFailure
    }

    await requestMicrophonePermission()
    const localOptions = { langs: [this.options.language], processLocally: true }

    if (this.options.mode === 'local_first' && Recognition.available) {
      try {
        this.localAvailability = await Recognition.available(localOptions)
        if (this.localAvailability === 'downloadable' && Recognition.install) {
          const installed = await Recognition.install(localOptions)
          this.localAvailability = installed ? 'available' : 'unavailable'
        }
      } catch {
        this.localAvailability = 'unknown'
      }
    }

    const useLocal = this.options.mode === 'local_first' && this.localAvailability === 'available'
    if (!useLocal && !this.options.allowOnline) {
      throw {
        code: this.localAvailability === 'unavailable' ? 'unsupported_language' : 'unavailable_service',
        message: this.localAvailability === 'unavailable'
          ? `${this.options.language} is not installed for on-device recognition. Allow the online fallback or use text.`
          : 'Local speech recognition is unavailable. Allow the online fallback or use text.',
        recoverable: true,
        requiresOnlineConsent: true,
      } satisfies VoiceFailure
    }

    this.engine = useLocal ? 'webview_local' : 'webview_online'
    this.options.callbacks?.onEngine?.(this.engine, this.localAvailability)
    return { engine: this.engine, localAvailability: this.localAvailability }
  }

  start() {
    const Recognition = constructorForWindow()
    if (!Recognition) throw normalizeVoiceError({ message: 'Speech recognition is unsupported.' })
    this.stopped = false
    this.errored = false
    this.aborted = false
    const recognition = new Recognition()
    recognition.lang = this.options.language
    recognition.continuous = false
    recognition.interimResults = true
    if ('processLocally' in recognition) recognition.processLocally = this.engine === 'webview_local'
    recognition.onstart = () => this.options.callbacks?.onStart?.()
    recognition.onresult = (event) => {
      const { finalText, interimText } = splitRecognitionResults(event)
      this.options.callbacks?.onInterim?.(interimText)
      if (finalText) this.options.callbacks?.onFinal?.(finalText)
    }
    recognition.onerror = (error) => {
      if (this.stopped && error.error === 'aborted') return
      this.errored = true
      this.options.callbacks?.onError?.(normalizeVoiceError(error))
    }
    recognition.onend = () => { if (!this.errored && !this.aborted) this.options.callbacks?.onEnd?.() }
    this.recognition = recognition
    recognition.start()
  }

  stop() {
    this.stopped = true
    this.recognition?.stop()
  }

  abort() {
    this.stopped = true
    this.aborted = true
    this.recognition?.abort()
    this.recognition = null
  }

  dispose() {
    this.abort()
  }
}
