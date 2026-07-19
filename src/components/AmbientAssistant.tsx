import { invoke } from '@tauri-apps/api/core'
import { Camera, Keyboard, Mic, RotateCcw, Send, Settings, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ScreenCaptureResult } from '../lib/screen'
import { cancelNeuralSpeech, prepareNeuralSpeech, speakNeural } from '../lib/neuralSpeech'
import { cancelSupertonicSpeech, speakSupertonic } from '../lib/supertonicSpeech'
import { saveSettings } from '../lib/settings'
import { selectSpeechVoice } from '../lib/speechVoices'
import { recordVoiceDiagnostic, runVoiceDiagnostics } from '../lib/voiceDiagnostics'
import { isVoiceRecognitionSupported, VoiceRecognitionService } from '../lib/voiceRecognition'
import type { AppSettings } from '../types/settings'
import type { VoiceApprovalDecision, VoiceFailure, VoicePhase, VoiceRunEvent } from '../types/voice'

type AmbientStyle = CSSProperties & { '--voice-level': string; '--submit-progress': string }

interface Props {
  active: boolean
  settings: AppSettings
  latestCapture: ScreenCaptureResult | null
  captureError: string
  runEvent?: VoiceRunEvent | null
  onClose: () => void
  onCaptureScreen: () => void
  onSubmitVoice: (text: string, requestId: string) => void
  onCancelRequest?: (requestId: string) => void
  onApprovalDecision?: (decision: VoiceApprovalDecision) => void
}

function speechSummary(text: string) {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, ' I kept the full code in chat. ')
    .replace(/[`*_>#\]]/g, '')
    .replaceAll('[', '')
    .replace(/https?:\/\/\S+/g, 'a linked source')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length <= 900) return cleaned
  return `${cleaned.slice(0, 860).replace(/\s+\S*$/, '')}. I kept the complete response in chat.`
}

export function AmbientAssistant({
  active,
  settings,
  latestCapture,
  captureError,
  runEvent,
  onClose,
  onCaptureScreen,
  onSubmitVoice,
  onCancelRequest,
  onApprovalDecision,
}: Props) {
  const supported = useMemo(isVoiceRecognitionSupported, [])
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [finalTranscript, setFinalTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [textOpen, setTextOpen] = useState(false)
  const [textDraft, setTextDraft] = useState('')
  const [failure, setFailure] = useState<VoiceFailure | null>(null)
  const [voiceLevel, setVoiceLevel] = useState(0)
  const [submitProgress, setSubmitProgress] = useState(0)
  const [activeRequestId, setActiveRequestId] = useState('')
  const [onlineConsent, setOnlineConsent] = useState(settings.voiceOnlineConsent ?? false)
  const [approval, setApproval] = useState<VoiceRunEvent['approval'] | null>(null)
  const [approvalConfirmation, setApprovalConfirmation] = useState('')
  const recognitionRef = useRef<VoiceRecognitionService | null>(null)
  const autoStartedRef = useRef(false)
  const submitTimerRef = useRef<number | null>(null)
  const progressTimerRef = useRef<number | null>(null)
  const finalTranscriptRef = useRef('')
  const audioContextRef = useRef<AudioContext | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const meterFrameRef = useRef<number | null>(null)
  const smoothLevelRef = useRef(0)

  const transcript = `${finalTranscript} ${interimTranscript}`.replace(/\s+/g, ' ').trim()
  const words = useMemo(() => transcript.split(/\s+/).filter(Boolean).slice(-42), [transcript])

  useEffect(() => {
    if (!active) {
      autoStartedRef.current = false
      stopEverything()
      return
    }
    setFailure(null)
    setApproval(null)
    if (settings.voiceSpeakReplies && (settings.voiceSynthesisMode ?? 'neural_local') === 'neural_local') {
      void prepareNeuralSpeech().catch(() => undefined)
    }
    void runVoiceDiagnostics(settings.voiceLanguage || 'en-US').then((diagnostic) => {
      if (!settings.voiceEnabled || !settings.voiceAutoStart || diagnostic.permission !== 'granted' || autoStartedRef.current) return
      autoStartedRef.current = true
      window.setTimeout(() => void beginListening(), 240)
    })
  }, [active, settings.voiceAutoStart, settings.voiceEnabled, settings.voiceLanguage, settings.voiceSpeakReplies, settings.voiceSynthesisMode])

  useEffect(() => () => stopEverything(), [])

  useEffect(() => {
    if (!runEvent || runEvent.requestId !== activeRequestId) return
    if (runEvent.type === 'accepted' || runEvent.type === 'thinking' || runEvent.type === 'tool_activity') setPhase('thinking')
    if (runEvent.type === 'approval_required') {
      setApproval(runEvent.approval ?? null)
      setApprovalConfirmation('')
      setPhase('thinking')
    }
    if (runEvent.type === 'approval_resolved') {
      setApproval(null)
      setApprovalConfirmation('')
    }
    if (runEvent.type === 'final' && runEvent.response) {
      setApproval(null)
      if (settings.voiceSpeakReplies) speakReply(runEvent.response)
      else setPhase('idle')
    }
    if (runEvent.type === 'error') {
      setFailure({ code: 'unavailable_service', message: runEvent.message || 'Nebula could not complete that voice request.', recoverable: true })
      setPhase('error')
    }
    if (runEvent.type === 'cancelled') {
      setApproval(null)
      setPhase('idle')
    }
  }, [runEvent, activeRequestId, settings.voiceSpeakReplies])

  async function startAudioMeter() {
    if (!navigator.mediaDevices?.getUserMedia) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const AudioContextClass = window.AudioContext
      if (!AudioContextClass) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
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
        const average = data.reduce((sum, value) => sum + value, 0) / Math.max(1, data.length)
        const raw = Math.min(1, average / 92)
        smoothLevelRef.current += (raw - smoothLevelRef.current) * 0.18
        setVoiceLevel(smoothLevelRef.current)
        meterFrameRef.current = window.requestAnimationFrame(tick)
      }
      tick()
    } catch {
      setVoiceLevel(0.12)
    }
  }

  function stopAudioMeter() {
    if (meterFrameRef.current !== null) window.cancelAnimationFrame(meterFrameRef.current)
    meterFrameRef.current = null
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
    void audioContextRef.current?.close()
    audioContextRef.current = null
    smoothLevelRef.current = 0
    setVoiceLevel(0)
  }

  function clearSubmitCountdown() {
    if (submitTimerRef.current !== null) window.clearTimeout(submitTimerRef.current)
    if (progressTimerRef.current !== null) window.clearInterval(progressTimerRef.current)
    submitTimerRef.current = null
    progressTimerRef.current = null
    setSubmitProgress(0)
  }

  function scheduleSubmit() {
    const text = finalTranscriptRef.current.trim()
    if (!text) {
      setPhase('idle')
      return
    }
    if (!settings.voiceAutoSubmit) {
      setPhase('idle')
      return
    }
    clearSubmitCountdown()
    const silenceMs = settings.voiceSilenceMs || 1200
    const startedAt = performance.now()
    setPhase('submit_countdown')
    progressTimerRef.current = window.setInterval(() => {
      setSubmitProgress(Math.min(1, (performance.now() - startedAt) / silenceMs))
    }, 40)
    submitTimerRef.current = window.setTimeout(() => submitTranscript(), silenceMs)
  }

  async function beginListening(forceOnline = false) {
    if (!active || !settings.voiceEnabled || phase === 'preparing' || phase === 'permission') return
    clearSubmitCountdown()
    window.speechSynthesis?.cancel()
    cancelNeuralSpeech()
    cancelSupertonicSpeech()
    recognitionRef.current?.dispose()
    recognitionRef.current = null
    finalTranscriptRef.current = ''
    setFinalTranscript('')
    setInterimTranscript('')
    setFailure(null)
    setApproval(null)
    setPhase('permission')
    const startedAt = performance.now()
    const service = new VoiceRecognitionService({
      language: settings.voiceLanguage || 'en-US',
      mode: forceOnline ? 'online' : (settings.voiceRecognitionMode || 'local_first'),
      allowOnline: forceOnline || onlineConsent || settings.voiceRecognitionMode === 'online',
      callbacks: {
        onEngine: (engine, localAvailability) => recordVoiceDiagnostic({ supported: true, permission: 'granted', language: settings.voiceLanguage || 'en-US', engine, localAvailability }),
        onStart: () => {
          setPhase('listening')
          recordVoiceDiagnostic({ supported: true, permission: 'granted', language: settings.voiceLanguage || 'en-US', recognitionLatencyMs: Math.round(performance.now() - startedAt), lastError: undefined })
          void startAudioMeter()
        },
        onInterim: setInterimTranscript,
        onFinal: (text) => {
          finalTranscriptRef.current = text
          setFinalTranscript(text)
          setInterimTranscript('')
          recordVoiceDiagnostic({ supported: true, permission: 'granted', language: settings.voiceLanguage || 'en-US', lastTranscriptAt: new Date().toISOString(), lastTranscriptPreview: text.slice(0, 120), lastError: undefined })
        },
        onEnd: () => {
          stopAudioMeter()
          recognitionRef.current = null
          scheduleSubmit()
        },
        onError: (nextFailure) => {
          stopAudioMeter()
          recognitionRef.current = null
          if (nextFailure.code === 'cancelled') return
          setFailure(nextFailure)
          setPhase('error')
          recordVoiceDiagnostic({ supported: true, permission: nextFailure.code.includes('denied') ? 'denied' : 'unknown', language: settings.voiceLanguage || 'en-US', lastErrorCode: nextFailure.code, lastError: nextFailure.message })
        },
      },
    })
    recognitionRef.current = service
    try {
      setPhase('preparing')
      await service.prepare()
      service.start()
    } catch (error) {
      const nextFailure = error as VoiceFailure
      recognitionRef.current = null
      setFailure(nextFailure)
      setPhase('error')
      recordVoiceDiagnostic({ supported, permission: nextFailure.code.includes('denied') ? 'denied' : 'unknown', language: settings.voiceLanguage || 'en-US', lastErrorCode: nextFailure.code, lastError: nextFailure.message })
    }
  }

  function stopListening() {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    stopAudioMeter()
    if (finalTranscriptRef.current.trim()) scheduleSubmit()
    else setPhase('idle')
  }

  function submitTranscript() {
    const text = finalTranscriptRef.current.trim()
    if (!text) return
    clearSubmitCountdown()
    recognitionRef.current?.dispose()
    recognitionRef.current = null
    stopAudioMeter()
    const requestId = crypto.randomUUID()
    setActiveRequestId(requestId)
    setFinalTranscript('')
    setInterimTranscript('')
    finalTranscriptRef.current = ''
    setPhase('thinking')
    onSubmitVoice(text, requestId)
  }

  function submitTextDraft() {
    const text = textDraft.trim()
    if (!text) return
    const requestId = crypto.randomUUID()
    setTextDraft('')
    setTextOpen(false)
    setActiveRequestId(requestId)
    setPhase('thinking')
    onSubmitVoice(text, requestId)
  }

  function speakReply(text: string) {
    const summary = speechSummary(text)
    const synthesisMode = settings.voiceSynthesisMode ?? 'neural_local'
    if (synthesisMode === 'neural_local') {
      window.speechSynthesis?.cancel()
      cancelSupertonicSpeech()
      void speakNeural(summary, {
        voice: settings.voiceNeuralVoice,
        speed: settings.voiceRate || 0.96,
        onStart: () => setPhase('speaking'),
        onPulse: setVoiceLevel,
        onEnd: () => {
          setVoiceLevel(0)
          setPhase('idle')
        },
        onError: () => speakSystemReply(summary),
      })
      return
    }
    if (synthesisMode === 'supertonic') {
      window.speechSynthesis?.cancel()
      cancelNeuralSpeech()
      void speakSupertonic(summary, {
        voice: settings.voiceSupertonicVoice,
        speed: settings.voiceRate || 1.02,
        onStart: () => setPhase('speaking'),
        onPulse: setVoiceLevel,
        onEnd: () => {
          setVoiceLevel(0)
          setPhase('idle')
        },
        onError: () => speakSystemReply(summary),
      })
      return
    }
    speakSystemReply(summary)
  }

  function speakSystemReply(text: string) {
    if (!('speechSynthesis' in window)) {
      setPhase('idle')
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = settings.voiceLanguage || 'en-US'
    const preferred = settings.voiceSystemVoice?.trim()
    const automaticVoice = !preferred
    utterance.voice = selectSpeechVoice(window.speechSynthesis.getVoices(), preferred, utterance.lang)
    utterance.rate = automaticVoice ? Math.min(settings.voiceRate || 1, 0.94) : settings.voiceRate || 1
    utterance.pitch = automaticVoice ? Math.max(settings.voicePitch || 1, 1.02) : settings.voicePitch || 1
    utterance.volume = automaticVoice ? 0.92 : 1
    utterance.onstart = () => setPhase('speaking')
    utterance.onboundary = () => setVoiceLevel(0.45 + Math.random() * 0.4)
    utterance.onend = () => {
      setVoiceLevel(0)
      setPhase('idle')
    }
    utterance.onerror = () => {
      setVoiceLevel(0)
      setPhase('idle')
    }
    window.speechSynthesis.speak(utterance)
  }

  function stopEverything() {
    clearSubmitCountdown()
    recognitionRef.current?.dispose()
    recognitionRef.current = null
    window.speechSynthesis?.cancel()
    cancelNeuralSpeech()
    cancelSupertonicSpeech()
    stopAudioMeter()
    setPhase('idle')
  }

  function handleOrbClick() {
    if (phase === 'speaking') {
      window.speechSynthesis?.cancel()
      cancelNeuralSpeech()
      cancelSupertonicSpeech()
      setPhase('idle')
      void beginListening()
      return
    }
    if (phase === 'listening') stopListening()
    else if (phase !== 'thinking') void beginListening()
  }

  function allowOnlineFallback() {
    setOnlineConsent(true)
    saveSettings({ ...settings, voiceOnlineConsent: true })
    void beginListening(true)
  }

  function decideApproval(approved: boolean) {
    if (!approval || !activeRequestId) return
    if (approved && approval.requiresTypedConfirmation && approvalConfirmation.trim().toUpperCase() !== 'CONFIRM') return
    onApprovalDecision?.({ requestId: activeRequestId, approvalId: approval.id, approved, confirmation: approvalConfirmation.trim() || undefined })
    setApproval(null)
    setApprovalConfirmation('')
  }

  const statusText = phase === 'permission'
    ? 'Microphone permission'
    : phase === 'preparing'
      ? 'Preparing voice'
      : phase === 'listening'
        ? 'Listening'
        : phase === 'submit_countdown'
          ? 'Sending shortly'
          : phase === 'thinking'
            ? 'Thinking'
            : phase === 'speaking'
              ? 'Speaking'
              : phase === 'error'
                ? 'Voice needs attention'
                : supported
                  ? 'Tap to speak'
                  : 'Use text'

  return (
    <div className={`ambient-assistant ${active ? 'ambient-assistant-active' : ''} ambient-phase-${phase}`} style={{ '--voice-level': String(voiceLevel), '--submit-progress': String(submitProgress) } as AmbientStyle} aria-hidden={!active}>
      <button className="ambient-glass-dim" type="button" aria-label="Close ambient assistant" onClick={onClose} />
      <div className="ambient-particle-field" />
      <main className="ambient-stage" aria-live="polite">
        <div className="ambient-status-label"><span className="ambient-status-dot" />{statusText}</div>
        <button className="ambient-nebula-field" type="button" aria-label={phase === 'listening' ? 'Stop listening' : phase === 'speaking' ? 'Interrupt and listen' : 'Start listening'} disabled={!settings.voiceEnabled || !supported || phase === 'thinking'} onClick={handleOrbClick}>
          <span className="ambient-nebula-halo ambient-nebula-halo-a" /><span className="ambient-nebula-halo ambient-nebula-halo-b" /><span className="ambient-nebula-core" />
          <span className="ambient-nebula-cloud ambient-nebula-cloud-a" /><span className="ambient-nebula-cloud ambient-nebula-cloud-b" /><span className="ambient-nebula-cloud ambient-nebula-cloud-c" />
          <span className="ambient-nebula-ripple ambient-nebula-ripple-a" /><span className="ambient-nebula-ripple ambient-nebula-ripple-b" /><span className="ambient-nebula-particles" />
        </button>

        {(words.length > 0 || captureError) && <section className="ambient-live-caption">
          {captureError ? <span className="ambient-caption-error">{captureError}</span> : words.map((word, index) => <span key={`${word}-${index}`} className="ambient-caption-word" style={{ animationDelay: `${index * 34}ms` }}>{word}</span>)}
        </section>}

        {phase === 'submit_countdown' && <section className="ambient-submit-card"><span>Send "{finalTranscript.slice(0, 90)}{finalTranscript.length > 90 ? '...' : ''}"</span><button type="button" onClick={() => { clearSubmitCountdown(); setPhase('idle') }}>Cancel</button></section>}

        {failure && <section className="ambient-recovery-card" role="alert">
          <strong>{failure.message}</strong>
          <div>
            <button type="button" onClick={() => void beginListening()}><RotateCcw size={13} />Retry</button>
            {failure.requiresOnlineConsent && <button type="button" onClick={allowOnlineFallback}>Allow online once</button>}
            {failure.code === 'microphone_denied' && <button type="button" onClick={() => void invoke('open_voice_privacy_settings', { kind: 'microphone' })}><Settings size={13} />Microphone settings</button>}
            {failure.code === 'speech_permission_denied' && <button type="button" onClick={() => void invoke('open_voice_privacy_settings', { kind: 'speech' })}><Settings size={13} />Speech settings</button>}
            <button type="button" onClick={() => setTextOpen(true)}><Keyboard size={13} />Use text</button>
          </div>
        </section>}

        {approval && <section className="ambient-approval-card">
          <strong>{approval.title}</strong><span>{approval.detail}</span><small>{approval.risk.replace('_', ' ')}</small>
          {approval.requiresTypedConfirmation && <input aria-label="Type CONFIRM to approve" placeholder="Type CONFIRM" value={approvalConfirmation} onChange={(event) => setApprovalConfirmation(event.target.value)} />}
          <div><button type="button" onClick={() => decideApproval(false)}>Reject</button><button type="button" disabled={approval.requiresTypedConfirmation && approvalConfirmation.trim().toUpperCase() !== 'CONFIRM'} onClick={() => decideApproval(true)}>Approve</button></div>
        </section>}

        <div className="ambient-screen-note">{latestCapture ? 'Screen context ready' : 'Screen context standby'}</div>
      </main>

      <section className={`ambient-text-dock ${textOpen ? 'ambient-text-dock-open' : ''}`}>
        <button className="ambient-mini-action" type="button" onClick={onCaptureScreen} title="Capture screen context"><Camera size={14} /></button>
        <button className={`ambient-mini-action ${phase === 'listening' ? 'ambient-mini-action-live' : ''}`} type="button" disabled={!settings.voiceEnabled || !supported || phase === 'thinking'} onClick={handleOrbClick} title="Voice"><Mic size={14} /></button>
        {finalTranscript.trim() && !settings.voiceAutoSubmit && <button className="ambient-mini-action" type="button" onClick={submitTranscript} title="Send transcript"><Send size={14} /></button>}
        {phase === 'thinking' && activeRequestId && <button className="ambient-text-toggle" type="button" onClick={() => onCancelRequest?.(activeRequestId)}>Stop</button>}
        <button className="ambient-text-toggle" type="button" onClick={() => setTextOpen((current) => !current)}>Text</button>
        <div className="ambient-text-panel"><textarea aria-label="Nebula text prompt" placeholder="Type to Nebula..." value={textDraft} onChange={(event) => setTextDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitTextDraft() } }} /><button type="button" disabled={!textDraft.trim()} onClick={submitTextDraft}><Send size={14} /></button></div>
        <button className="ambient-exit" aria-label="Close ambient assistant" type="button" onClick={() => { stopEverything(); onClose() }}><X size={15} /></button>
      </section>
    </div>
  )
}
