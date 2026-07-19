import { invoke, isTauri } from '@tauri-apps/api/core'

export const SUPERTONIC_VOICES = [
  { id: 'F1', name: 'F1', description: 'Clear feminine voice' },
  { id: 'F2', name: 'F2', description: 'Soft feminine voice' },
  { id: 'F3', name: 'F3', description: 'Bright feminine voice' },
  { id: 'F4', name: 'F4', description: 'Calm feminine voice' },
  { id: 'F5', name: 'F5', description: 'Lower feminine voice' },
  { id: 'M1', name: 'M1', description: 'Clear masculine voice' },
  { id: 'M2', name: 'M2', description: 'Warm masculine voice' },
  { id: 'M3', name: 'M3', description: 'Bright masculine voice' },
  { id: 'M4', name: 'M4', description: 'Calm masculine voice' },
  { id: 'M5', name: 'M5', description: 'Lower masculine voice' },
] as const

export type SupertonicPhase = 'idle' | 'generating' | 'speaking' | 'error'

export interface SupertonicStatus {
  phase: SupertonicPhase
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

let activeAudio: HTMLAudioElement | null = null
let generation = 0
let status: SupertonicStatus = { phase: 'idle', message: 'Supertonic is optional and loads only when selected.' }
const listeners = new Set<(status: SupertonicStatus) => void>()

function publish(next: SupertonicStatus) {
  status = next
  listeners.forEach((listener) => listener(status))
}

export function getSupertonicStatus() {
  return status
}

export function subscribeSupertonic(listener: (status: SupertonicStatus) => void) {
  listeners.add(listener)
  listener(status)
  return () => {
    listeners.delete(listener)
  }
}

export function cancelSupertonicSpeech() {
  generation += 1
  activeAudio?.pause()
  if (activeAudio) activeAudio.src = ''
  activeAudio = null
  if (status.phase === 'generating' || status.phase === 'speaking') {
    publish({ phase: 'idle', message: 'Supertonic is ready when needed.' })
  }
}

function resolveVoice(value?: string) {
  return SUPERTONIC_VOICES.some((voice) => voice.id === value) ? value : 'F1'
}

export async function speakSupertonic(text: string, options: SpeakOptions = {}) {
  cancelSupertonicSpeech()
  const currentGeneration = generation
  try {
    if (!isTauri()) throw new Error('Supertonic is available in the Nebula desktop app.')
    publish({ phase: 'generating', message: 'Supertonic is preparing speech...' })
    const audioBase64 = await invoke<string>('supertonic_synthesize', {
      text,
      voice: resolveVoice(options.voice),
      speed: Math.max(0.7, Math.min(1.3, options.speed ?? 1.02)),
    })
    if (currentGeneration !== generation) return
    const audio = new Audio(`data:audio/wav;base64,${audioBase64}`)
    activeAudio = audio
    const pulse = window.setInterval(() => {
      if (!audio.paused) options.onPulse?.(0.42 + Math.abs(Math.sin(audio.currentTime * 8.2)) * 0.44)
    }, 70)
    const cleanup = () => {
      window.clearInterval(pulse)
      if (activeAudio === audio) activeAudio = null
    }
    audio.onplay = () => {
      publish({ phase: 'speaking', message: 'Nebula is speaking with Supertonic.' })
      options.onStart?.()
    }
    audio.onended = () => {
      cleanup()
      publish({ phase: 'idle', message: 'Supertonic is ready when needed.' })
      options.onPulse?.(0)
      options.onEnd?.()
    }
    audio.onerror = () => {
      cleanup()
      const error = new Error('Nebula could not play the Supertonic response.')
      publish({ phase: 'error', message: error.message })
      options.onError?.(error)
    }
    await audio.play()
  } catch (error) {
    if (currentGeneration !== generation) return
    const nextError = error instanceof Error ? error : new Error(String(error))
    publish({ phase: 'error', message: nextError.message })
    options.onPulse?.(0)
    options.onError?.(nextError)
  }
}
