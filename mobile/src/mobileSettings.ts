import type { MobilePreferences } from './types'
import { readPreference, writePreference } from './platform'

const SETTINGS_KEY = 'mobile-preferences-v1'
export const DEFAULT_BRIDGE_URL = ''

export const DEFAULT_MOBILE_PREFERENCES: MobilePreferences = {
  version: 1,
  theme: 'black_matter',
  textScale: 1,
  compactMessages: false,
  showTimestamps: false,
  wrapCode: true,
  reducedMotion: false,
  reducedTransparency: false,
  highContrast: false,
  haptics: true,
  accentIntensity: 0.7,
  streamResponses: true,
  autoScroll: true,
  persistDrafts: true,
  submitOnEnter: false,
  showToolActivity: true,
  readAloud: false,
  completionSound: false,
  cacheHistory: true,
  voiceLanguage: 'en-US',
  voiceAutoSubmit: true,
  voiceSilenceMs: 1200,
  voiceSpeakVoiceReplies: true,
  voiceOnlineConsent: false,
  speechRate: 1,
  speechPitch: 1,
  autoReconnect: true,
  bridgeUrl: DEFAULT_BRIDGE_URL,
  notifyOnComplete: true,
  notifyOnApproval: true,
  showDiagnostics: false,
  showModelName: false,
}

function bounded(value: unknown, fallback: number, min: number, max: number) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, number))
}

export function sanitizeMobilePreferences(value: unknown): MobilePreferences {
  const candidate = value && typeof value === 'object' ? value as Partial<MobilePreferences> : {}
  const boolean = <K extends keyof MobilePreferences>(key: K) => typeof candidate[key] === 'boolean' ? candidate[key] as boolean : DEFAULT_MOBILE_PREFERENCES[key] as boolean
  const theme = candidate.theme === 'system' || candidate.theme === 'light' || candidate.theme === 'original' || candidate.theme === 'black_matter'
    ? candidate.theme
    : 'black_matter'
  const bridgeUrl = typeof candidate.bridgeUrl === 'string' && /^https:\/\//i.test(candidate.bridgeUrl.trim())
    ? candidate.bridgeUrl.trim().replace(/\/$/, '')
    : DEFAULT_BRIDGE_URL
  return {
    ...DEFAULT_MOBILE_PREFERENCES,
    ...candidate,
    version: 1,
    theme,
    bridgeUrl,
    textScale: bounded(candidate.textScale, 1, 0.85, 1.3),
    accentIntensity: bounded(candidate.accentIntensity, 0.7, 0, 1),
    speechRate: bounded(candidate.speechRate, 1, 0.6, 1.6),
    speechPitch: bounded(candidate.speechPitch, 1, 0.6, 1.4),
    voiceSilenceMs: bounded(candidate.voiceSilenceMs, 1200, 500, 5000),
    compactMessages: boolean('compactMessages'),
    showTimestamps: boolean('showTimestamps'),
    wrapCode: boolean('wrapCode'),
    reducedMotion: boolean('reducedMotion'),
    reducedTransparency: boolean('reducedTransparency'),
    highContrast: boolean('highContrast'),
    haptics: boolean('haptics'),
    streamResponses: boolean('streamResponses'),
    autoScroll: boolean('autoScroll'),
    persistDrafts: boolean('persistDrafts'),
    submitOnEnter: boolean('submitOnEnter'),
    showToolActivity: boolean('showToolActivity'),
    readAloud: boolean('readAloud'),
    voiceAutoSubmit: boolean('voiceAutoSubmit'),
    voiceSpeakVoiceReplies: boolean('voiceSpeakVoiceReplies'),
    voiceOnlineConsent: boolean('voiceOnlineConsent'),
    completionSound: boolean('completionSound'),
    cacheHistory: boolean('cacheHistory'),
    autoReconnect: boolean('autoReconnect'),
    notifyOnComplete: boolean('notifyOnComplete'),
    notifyOnApproval: boolean('notifyOnApproval'),
    showDiagnostics: boolean('showDiagnostics'),
    showModelName: boolean('showModelName'),
    voiceLanguage: typeof candidate.voiceLanguage === 'string' ? candidate.voiceLanguage.slice(0, 24) : 'en-US',
  }
}

export async function loadMobilePreferences() {
  const raw = await readPreference(SETTINGS_KEY)
  if (!raw) return DEFAULT_MOBILE_PREFERENCES
  try { return sanitizeMobilePreferences(JSON.parse(raw)) } catch { return DEFAULT_MOBILE_PREFERENCES }
}

export async function saveMobilePreferences(settings: MobilePreferences) {
  await writePreference(SETTINGS_KEY, JSON.stringify(sanitizeMobilePreferences(settings)))
}
