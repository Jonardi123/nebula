import type { VoiceDiagnosticSnapshot } from '../types/nebula'
import { readLocalJson, writeLocalJson } from './safeStorage'

const VOICE_DIAGNOSTICS_KEY = 'nebula-voice-diagnostics-v1'
const VOICE_DIAGNOSTICS_EVENT = 'nebula-voice-diagnostics-changed'

export function getVoiceDiagnostics() {
  return readLocalJson<VoiceDiagnosticSnapshot | null>(VOICE_DIAGNOSTICS_KEY, null)
}

export function recordVoiceDiagnostic(update: Partial<VoiceDiagnosticSnapshot>) {
  const previous = getVoiceDiagnostics()
  const next: VoiceDiagnosticSnapshot = {
    supported: update.supported ?? previous?.supported ?? false,
    permission: update.permission ?? previous?.permission ?? 'unknown',
    language: update.language ?? previous?.language ?? 'en-US',
    lastTranscriptAt: update.lastTranscriptAt ?? previous?.lastTranscriptAt,
    lastError: update.lastError,
    checkedAt: new Date().toISOString(),
  }
  writeLocalJson(VOICE_DIAGNOSTICS_KEY, next, VOICE_DIAGNOSTICS_EVENT)
  return next
}

export async function runVoiceDiagnostics(language = 'en-US') {
  const speechWindow = window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
  const supported = Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition)
  let permission: VoiceDiagnosticSnapshot['permission'] = supported ? 'unknown' : 'unsupported'
  try {
    if (navigator.permissions?.query) {
      const result = await navigator.permissions.query({ name: 'microphone' as PermissionName })
      permission = result.state
    }
  } catch {
    // Some WebViews support speech recognition but do not expose microphone permission queries.
  }
  return recordVoiceDiagnostic({ supported, permission, language, lastError: undefined })
}
