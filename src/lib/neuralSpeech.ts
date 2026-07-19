import type { KokoroTTS } from 'kokoro-js'

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

export const NEURAL_VOICES = [
  { id: 'af_heart', name: 'Heart', description: 'Warm and conversational' },
  { id: 'af_bella', name: 'Bella', description: 'Expressive and energetic' },
  { id: 'af_nicole', name: 'Nicole', description: 'Calm and intimate' },
  { id: 'af_sarah', name: 'Sarah', description: 'Clear and balanced' },
  { id: 'bf_emma', name: 'Emma', description: 'Warm British voice' },
  { id: 'am_fenrir', name: 'Fenrir', description: 'Confident lower voice' },
  { id: 'bm_fable', name: 'Fable', description: 'Soft British voice' },
] as const

export type NeuralVoiceId = (typeof NEURAL_VOICES)[number]['id']
export type NeuralSpeechPhase = 'idle' | 'downloading' | 'ready' | 'generating' | 'speaking' | 'error'

export interface NeuralSpeechStatus {
  phase: NeuralSpeechPhase
  progress: number
  message: string
}

interface SpeakOptions {
  voice?: string
  speed?: number
  onStart?: () => void
  onPulse?: (level: number) => void
  onEnd?: () => void
  onError?: (error: Error) => void
}

let modelPromise: Promise<KokoroTTS> | null = null
let activeAudio: HTMLAudioElement | null = null
let playbackGeneration = 0
let status: NeuralSpeechStatus = { phase: 'idle', progress: 0, message: 'Neural voice is not loaded yet.' }
const listeners = new Set<(status: NeuralSpeechStatus) => void>()

function publish(next: NeuralSpeechStatus) {
  status = next
  listeners.forEach((listener) => listener(status))
}

export function getNeuralSpeechStatus() {
  return status
}

export function subscribeNeuralSpeech(listener: (status: NeuralSpeechStatus) => void) {
  listeners.add(listener)
  listener(status)
  return () => {
    listeners.delete(listener)
  }
}

export function resolveNeuralVoice(value: string | undefined): NeuralVoiceId {
  return NEURAL_VOICES.some((voice) => voice.id === value) ? value as NeuralVoiceId : 'af_heart'
}

function progressValue(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  return typeof record.progress === 'number' && Number.isFinite(record.progress) ? Math.max(0, Math.min(100, record.progress)) : null
}

export async function prepareNeuralSpeech() {
  if (modelPromise) return modelPromise
  publish({ phase: 'downloading', progress: 0, message: 'Preparing Nebula Neural voice...' })
  modelPromise = import('kokoro-js')
    .then(({ KokoroTTS }) => KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (update: unknown) => {
        const progress = progressValue(update)
        if (progress !== null) publish({ phase: 'downloading', progress, message: `Downloading neural voice ${Math.round(progress)}%` })
      },
    }))
    .then((model) => {
      publish({ phase: 'ready', progress: 100, message: 'Nebula Neural is ready.' })
      return model
    })
    .catch((error) => {
      modelPromise = null
      const message = error instanceof Error ? error.message : String(error)
      publish({ phase: 'error', progress: 0, message })
      throw error
    })
  return modelPromise
}

function playAudio(blob: Blob, generation: number, onPulse?: (level: number) => void) {
  return new Promise<void>((resolve, reject) => {
    if (generation !== playbackGeneration) return resolve()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    activeAudio = audio
    audio.preload = 'auto'
    audio.volume = 0.96
    const pulse = window.setInterval(() => {
      if (audio.paused) return
      const wave = 0.45 + Math.abs(Math.sin(audio.currentTime * 8.4)) * 0.42
      onPulse?.(wave)
    }, 70)
    const cleanup = () => {
      window.clearInterval(pulse)
      URL.revokeObjectURL(url)
      if (activeAudio === audio) activeAudio = null
    }
    audio.onended = () => {
      cleanup()
      resolve()
    }
    audio.onerror = () => {
      cleanup()
      reject(new Error('Nebula could not play the generated neural voice.'))
    }
    void audio.play().catch((error) => {
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

export async function speakNeural(text: string, options: SpeakOptions = {}) {
  cancelNeuralSpeech()
  const generation = playbackGeneration
  try {
    const model = await prepareNeuralSpeech()
    if (generation !== playbackGeneration) return
    publish({ phase: 'generating', progress: 100, message: 'Preparing speech...' })
    let started = false
    for await (const chunk of model.stream(text, {
      voice: resolveNeuralVoice(options.voice),
      speed: Math.max(0.7, Math.min(1.25, options.speed ?? 0.96)),
    })) {
      if (generation !== playbackGeneration) return
      if (!started) {
        started = true
        options.onStart?.()
      }
      publish({ phase: 'speaking', progress: 100, message: 'Nebula is speaking.' })
      await playAudio(chunk.audio.toBlob(), generation, options.onPulse)
    }
    if (generation !== playbackGeneration) return
    publish({ phase: 'ready', progress: 100, message: 'Nebula Neural is ready.' })
    options.onPulse?.(0)
    options.onEnd?.()
  } catch (error) {
    if (generation !== playbackGeneration) return
    const nextError = error instanceof Error ? error : new Error(String(error))
    publish({ phase: 'error', progress: 0, message: nextError.message })
    options.onPulse?.(0)
    options.onError?.(nextError)
  }
}

export function cancelNeuralSpeech() {
  playbackGeneration += 1
  if (activeAudio) {
    activeAudio.pause()
    activeAudio.src = ''
    activeAudio = null
  }
  if (status.phase === 'speaking' || status.phase === 'generating') {
    publish({ phase: modelPromise ? 'ready' : 'idle', progress: modelPromise ? 100 : 0, message: modelPromise ? 'Nebula Neural is ready.' : 'Neural voice is not loaded yet.' })
  }
}
