import { Bug, Camera, Code2, FileText, Mic, Search, Send, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ScreenCaptureResult } from '../lib/screen'
import { recordVoiceDiagnostic, runVoiceDiagnostics } from '../lib/voiceDiagnostics'
import type { AppSettings } from '../types/settings'

type AmbientStyle = CSSProperties & {
  '--voice-level': string
}

type BrowserSpeechRecognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onstart: (() => void) | null
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition

type SpeechRecognitionResultEvent = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>
}

type SpeechRecognitionErrorEvent = {
  error?: string
}

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
  webkitAudioContext?: typeof AudioContext
}

function getSpeechRecognitionConstructor() {
  if (typeof window === 'undefined') return undefined
  const speechWindow = window as SpeechWindow
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
}

interface Props {
  active: boolean
  settings: AppSettings
  latestCapture: ScreenCaptureResult | null
  captureError: string
  onClose: () => void
  onCaptureScreen: () => void
  onSubmitVoice: (text: string) => void
}

export function AmbientAssistant({
  active,
  settings,
  latestCapture,
  captureError,
  onClose,
  onCaptureScreen,
  onSubmitVoice,
}: Props) {
  const [supported] = useState(() => Boolean(getSpeechRecognitionConstructor()))
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [textOpen, setTextOpen] = useState(false)
  const [textDraft, setTextDraft] = useState('')
  const [voiceError, setVoiceError] = useState('')
  const [phase, setPhase] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle')
  const [voiceLevel, setVoiceLevel] = useState(0)
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const autoStarted = useRef(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const meterFrameRef = useRef<number | null>(null)
  const smoothLevelRef = useRef(0)

  const words = useMemo(() => transcript.split(/\s+/).filter(Boolean).slice(-42), [transcript])

  useEffect(() => {
    if (active) void runVoiceDiagnostics(settings.voiceLanguage || 'en-US')
  }, [active, settings.voiceLanguage])

  useEffect(() => {
    if (!active) {
      autoStarted.current = false
      stopListening()
      stopAudioMeter()
      window.setTimeout(() => {
        setTranscript('')
        setTextOpen(false)
        setPhase('idle')
      }, 0)
      return
    }

    if (settings.voiceEnabled && settings.voiceAutoStart && supported && !autoStarted.current) {
      autoStarted.current = true
      window.setTimeout(() => startListening(), 220)
    }
  }, [active, settings.voiceEnabled, settings.voiceAutoStart, supported])

  useEffect(() => {
    return () => {
      stopAudioMeter()
      recognitionRef.current?.abort?.()
    }
  }, [])

  async function startAudioMeter() {
    if (!navigator.mediaDevices?.getUserMedia) return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const AudioContextClass = window.AudioContext || (window as SpeechWindow).webkitAudioContext
      if (!AudioContextClass) return
      const audioContext = new AudioContextClass()
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.84
      audioContext.createMediaStreamSource(stream).connect(analyser)

      audioContextRef.current = audioContext
      mediaStreamRef.current = stream

      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(data)
        let sum = 0
        for (const value of data) sum += value
        const raw = Math.min(1, sum / data.length / 92)
        smoothLevelRef.current += (raw - smoothLevelRef.current) * 0.18
        setVoiceLevel(smoothLevelRef.current)
        meterFrameRef.current = window.requestAnimationFrame(tick)
      }
      tick()
    } catch (error) {
      setVoiceLevel(0.18)
      recordVoiceDiagnostic({ supported, permission: 'denied', language: settings.voiceLanguage || 'en-US', lastError: error instanceof Error ? error.message : String(error) })
    }
  }

  function stopAudioMeter() {
    if (meterFrameRef.current) window.cancelAnimationFrame(meterFrameRef.current)
    meterFrameRef.current = null
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
    void audioContextRef.current?.close?.()
    audioContextRef.current = null
    smoothLevelRef.current = 0
    setVoiceLevel(0)
  }

  function startListening() {
    if (!supported || listening) return
    const SpeechRecognition = getSpeechRecognitionConstructor()
    if (!SpeechRecognition) return
    const recognition = new SpeechRecognition()
    recognition.lang = settings.voiceLanguage || 'en-US'
    recognition.continuous = false
    recognition.interimResults = true

    recognition.onstart = () => {
      setVoiceError('')
      setListening(true)
      setPhase('listening')
      void startAudioMeter()
    }

    recognition.onresult = (event) => {
      let text = ''
      for (let index = 0; index < event.results.length; index += 1) {
        text += event.results[index][0]?.transcript ?? ''
      }
      setTranscript(text.trim())
      if (text.trim()) recordVoiceDiagnostic({ supported: true, permission: 'granted', language: recognition.lang, lastTranscriptAt: new Date().toISOString(), lastError: undefined })
    }

    recognition.onerror = (event) => {
      setVoiceError(event?.error ? `Voice error: ${event.error}` : 'Voice input failed.')
      recordVoiceDiagnostic({ supported: true, permission: event?.error === 'not-allowed' ? 'denied' : 'unknown', language: recognition.lang, lastError: event?.error || 'Voice input failed.' })
      setListening(false)
      setPhase('idle')
      stopAudioMeter()
    }

    recognition.onend = () => {
      setListening(false)
      setPhase('idle')
      stopAudioMeter()
    }
    recognitionRef.current = recognition
    recognition.start()
  }

  function stopListening() {
    recognitionRef.current?.stop?.()
    setListening(false)
    if (phase === 'listening') setPhase('idle')
    stopAudioMeter()
  }

  function sendTranscript() {
    const text = transcript.trim()
    if (!text) return
    setTranscript('')
    setPhase('thinking')
    window.setTimeout(() => setPhase('idle'), 1600)
    onSubmitVoice(text)
  }

  function sendTextDraft() {
    const text = textDraft.trim()
    if (!text) return
    setTextDraft('')
    setTextOpen(false)
    setPhase('thinking')
    window.setTimeout(() => setPhase('idle'), 1600)
    onSubmitVoice(text)
  }

  const statusText =
    phase === 'listening'
      ? 'Listening'
      : phase === 'thinking'
        ? 'Thinking'
        : phase === 'speaking'
          ? 'Speaking'
          : voiceError
            ? 'Voice unavailable'
            : 'Nebula awake'

  return (
    <div
      className={`ambient-assistant ${active ? 'ambient-assistant-active' : ''} ambient-phase-${phase}`}
      style={{ '--voice-level': String(voiceLevel) } as AmbientStyle}
      aria-hidden={!active}
    >
      <button className="ambient-glass-dim" type="button" aria-label="Close ambient assistant" onClick={onClose} />
      <div className="ambient-particle-field" />

      <main className="ambient-stage" aria-live="polite">
        <div className="ambient-status-label">
          <span className="ambient-status-dot" />
          {statusText}
        </div>

        <button
          className="ambient-nebula-field"
          type="button"
          aria-label={listening ? 'Stop listening' : 'Start listening'}
          disabled={!settings.voiceEnabled || !supported}
          onClick={listening ? stopListening : startListening}
        >
          <span className="ambient-nebula-halo ambient-nebula-halo-a" />
          <span className="ambient-nebula-halo ambient-nebula-halo-b" />
          <span className="ambient-nebula-core" />
          <span className="ambient-nebula-cloud ambient-nebula-cloud-a" />
          <span className="ambient-nebula-cloud ambient-nebula-cloud-b" />
          <span className="ambient-nebula-cloud ambient-nebula-cloud-c" />
          <span className="ambient-nebula-ripple ambient-nebula-ripple-a" />
          <span className="ambient-nebula-ripple ambient-nebula-ripple-b" />
          <span className="ambient-nebula-particles" />
        </button>

        {(words.length > 0 || voiceError || captureError) && (
          <section className="ambient-live-caption">
            {voiceError || captureError ? (
              <span className="ambient-caption-error">{voiceError || captureError}</span>
            ) : (
              words.map((word, index) => (
                <span key={`${word}-${index}`} className="ambient-caption-word" style={{ animationDelay: `${index * 34}ms` }}>
                  {word}
                </span>
              ))
            )}
          </section>
        )}

        <div className="ambient-screen-note">
          {latestCapture ? `${latestCapture.width} x ${latestCapture.height} screen context ready` : 'screen context standby'}
        </div>

        {settings.overlayQuickActionsEnabled && (
          <div className="ambient-quick-actions" aria-label="Ambient quick actions">
            <button type="button" onClick={() => onSubmitVoice('Review the active project and summarize the highest priority issues.')}>
              <Code2 size={13} />
              Review
            </button>
            <button type="button" onClick={() => onSubmitVoice('Find likely bugs in the active project. Do not edit files unless I ask.')}>
              <Bug size={13} />
              Bugs
            </button>
            <button type="button" onClick={() => onSubmitVoice('Summarize the current README or active project context.')}>
              <FileText size={13} />
              Summary
            </button>
            <button type="button" onClick={() => onSubmitVoice('Search project context and memory for what I should do next.')}>
              <Search size={13} />
              Next
            </button>
          </div>
        )}
      </main>

      <section className={`ambient-text-dock ${textOpen ? 'ambient-text-dock-open' : ''}`}>
        <button className="ambient-mini-action" type="button" onClick={onCaptureScreen} title="Capture screen context">
          <Camera size={14} />
        </button>
        <button
          className={`ambient-mini-action ${listening ? 'ambient-mini-action-live' : ''}`}
          type="button"
          disabled={!settings.voiceEnabled || !supported}
          onClick={listening ? stopListening : startListening}
          title={listening ? 'Stop listening' : 'Start listening'}
        >
          <Mic size={14} />
        </button>
        <button className="ambient-mini-action" type="button" disabled={!transcript.trim()} onClick={sendTranscript} title="Send transcript">
          <Send size={14} />
        </button>
        <button className="ambient-text-toggle" type="button" onClick={() => setTextOpen((current) => !current)}>
          Text
        </button>
        <div className="ambient-text-panel">
          <textarea
            aria-label="Nebula text prompt"
            placeholder="Type to Nebula..."
            value={textDraft}
            onChange={(event) => setTextDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                sendTextDraft()
              }
            }}
          />
          <button type="button" disabled={!textDraft.trim()} onClick={sendTextDraft}>
            <Send size={14} />
          </button>
        </div>
        <button className="ambient-exit" aria-label="Close ambient assistant" type="button" onMouseDown={(event) => event.stopPropagation()} onClick={onClose}>
          <X size={15} />
        </button>
      </section>
    </div>
  )
}
