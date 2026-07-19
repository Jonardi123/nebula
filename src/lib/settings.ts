import type { AppSettings } from '../types/settings'

export type { AppSettings } from '../types/settings'

const SETTINGS_KEY = 'nebula-settings'
const SINGLE_MODEL_MIGRATION_KEY = 'nebula-single-model-qwen-v1'
const DAILY_CHAT_MODEL = 'google_-_gemma-7b-it'
const CODE_MODEL = 'qwen/qwen2.5-coder-14b'
const TUNED_QWEN_MODEL = 'qwen2.5-coder-1.5b-v1'

export const DEFAULT_SETTINGS: AppSettings = {
  experienceMode: 'simple',
  endpoint: 'http://localhost:1234/v1/chat/completions',
  modelProvider: 'lmstudio',
  nineRouterBaseUrl: 'http://localhost:20128/v1',
  nineRouterApiKey: '',
  nineRouterModel: '',
  openRouterBaseUrl: 'https://openrouter.ai/api/v1',
  openRouterApiKey: '',
  openRouterModel: '',
  fallbackToLmStudio: true,
  model: DAILY_CHAT_MODEL,
  modelMode: 'auto',
  singleModelEnabled: false,
  singleModel: '',
  fastModel: DAILY_CHAT_MODEL,
  codeModel: CODE_MODEL,
  reviewModel: 'openai-gpt-oss-20b-heretic-uncensored-neo-imatrix',
  autoLoadModels: true,
  warmFastModelOnStartup: true,
  keepDailyModelWarm: true,
  backgroundPreloadCodeModel: false,
  heavyModelIdleUnloadMs: 8 * 60 * 1000,
  modelLoadTimeoutMs: 180000,
  enableAutomaticReviewPass: false,
  warmModelWhileTyping: true,
  contextInjectionEnabled: true,
  contextBudgetChars: 18000,
  showModelDebugInfo: false,
  developerDiagnosticsEnabled: true,
  nebulaCoreEnabled: true,
  desktopControlBetaEnabled: true,
  automationSchedulerEnabled: true,
  automationConfirmationMode: 'confirm_risky',
  autoWebSearch: true,
  modelAssignments: {
    daily: DAILY_CHAT_MODEL,
    code: CODE_MODEL,
    review: 'openai-gpt-oss-20b-heretic-uncensored-neo-imatrix',
  },
  launcherIndexedFolders: [],
  trustedAppAliases: {},
  maxAutoFetchPages: 2,
  memoryReviewMode: 'suggest',
  activeProjectProfileId: '',
  projectProfileMode: 'auto_editable',
  modelRoutingSuggestions: true,
  notificationMode: 'in_app_tray',
  screenshotAskEnabled: true,
  startupAnimation: 'event_horizon',
  temperature: 0.25,
  maxTokens: 4096,
  projectFolder: '',
  memoryFolder: 'memory',
  requireApproval: false,
  riskyToolsEnabled: true,
  actionMode: 'safe',
  assistantHoldMs: 360,
  globalShortcutEnabled: true,
  launchAtStartup: true,
  keepRunningInBackground: true,
  screenAwarenessEnabled: true,
  voiceEnabled: true,
  voiceAutoStart: true,
  voiceLanguage: 'en-US',
  voiceRecognitionMode: 'local_first',
  voiceOnlineConsent: false,
  voiceAutoSubmit: true,
  voiceSilenceMs: 1200,
  voiceSpeakReplies: true,
  voiceSynthesisMode: 'neural_local',
  voiceNeuralVoice: 'af_heart',
  voiceSupertonicVoice: 'F1',
  voiceSystemVoice: '',
  voiceRate: 0.94,
  voicePitch: 1.02,
  wakePhraseEnabled: false,
  wakePhrase: 'Nebula',
  theme: 'black_matter',
  profileAvatarMode: 'preset',
  profileAvatarPath: '',
  profileAvatarPreset: 'nova',
  setupWizardCompleted: false,
  setupWizardLastRunAt: '',
  overlayQuickActionsEnabled: true,
  modelProfilerEnabled: true,
  dailyBriefEnabled: true,
  permissionCenterOverrides: {},
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function readNumber(value: unknown, fallback: number, min?: number, max?: number) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  const withMin = min === undefined ? number : Math.max(min, number)
  return max === undefined ? withMin : Math.min(max, withMin)
}

function readStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback
  return value.filter((item): item is string => typeof item === 'string')
}

function readPermissionOverrides(value: unknown) {
  if (!isRecord(value)) return DEFAULT_SETTINGS.permissionCenterOverrides
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, 'enabled' | 'disabled'] => entry[1] === 'enabled' || entry[1] === 'disabled'),
  )
}

function readStringRecord(value: unknown) {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, entry]) => [key.trim().toLowerCase(), entry.trim()])
      .filter(([key, entry]) => Boolean(key && entry)),
  )
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T) {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback
}

function normalizeDailyModel(value: unknown, fallback: string) {
  const model = readString(value, fallback).trim()
  if (!model) return fallback
  if (/^gemma$/i.test(model)) return DAILY_CHAT_MODEL
  return model
}

function readExecutionMode(value: unknown): AppSettings['actionMode'] {
  if (value === 'approval' || value === 'strict') return 'approval'
  if (value === 'safe' || value === 'fast' || value === 'guarded') return 'safe'
  // Full Access is deliberately session-only and is never restored from storage.
  if (value === 'full') return 'safe'
  return DEFAULT_SETTINGS.actionMode
}

function readVisualTheme(value: unknown): AppSettings['theme'] {
  if (value === 'original') return 'original'
  if (value === 'black_matter') return 'black_matter'
  // Legacy themes enter the Black Matter release on its new default theme.
  if (value === 'dark' || value === 'darker') return 'black_matter'
  return DEFAULT_SETTINGS.theme
}

function sanitizeSettings(value: unknown): AppSettings {
  if (!isRecord(value)) return DEFAULT_SETTINGS

  const assignments = isRecord(value.modelAssignments) ? value.modelAssignments : {}
  const rawDailyModel = readString(assignments.daily, readString(value.fastModel, DEFAULT_SETTINGS.modelAssignments.daily))
  const dailyModel = normalizeDailyModel(rawDailyModel, DEFAULT_SETTINGS.modelAssignments.daily)
  const migratedLegacyDailyModel = rawDailyModel.trim() !== dailyModel
  const rawPrimaryModel = readString(value.model, DEFAULT_SETTINGS.model)
  const primaryModel = normalizeDailyModel(rawPrimaryModel, dailyModel)
  const migratedLegacyPrimaryModel = rawPrimaryModel.trim() !== primaryModel
  const modelMode = readEnum(value.modelMode, ['auto', 'fast', 'code', 'review'] as const, DEFAULT_SETTINGS.modelMode)
  const storedProvider = readEnum(value.modelProvider, ['lmstudio', '9router', 'openrouter'] as const, DEFAULT_SETTINGS.modelProvider)
  const storedNineRouterModel = readString(value.nineRouterModel, DEFAULT_SETTINGS.nineRouterModel)
  const accidentalRouterDefault =
    storedProvider === '9router' &&
    !readString(value.nineRouterApiKey, '').trim() &&
    readString(value.nineRouterBaseUrl, DEFAULT_SETTINGS.nineRouterBaseUrl) === DEFAULT_SETTINGS.nineRouterBaseUrl &&
    (!storedNineRouterModel.trim() || storedNineRouterModel === 'cx/gpt-5.4-mini')

  return {
    experienceMode: readEnum(value.experienceMode, ['simple', 'advanced'] as const, DEFAULT_SETTINGS.experienceMode),
    endpoint: readString(value.endpoint, DEFAULT_SETTINGS.endpoint),
    modelProvider: accidentalRouterDefault ? 'lmstudio' : storedProvider,
    nineRouterBaseUrl: readString(value.nineRouterBaseUrl, DEFAULT_SETTINGS.nineRouterBaseUrl),
    nineRouterApiKey: readString(value.nineRouterApiKey, DEFAULT_SETTINGS.nineRouterApiKey),
    nineRouterModel: accidentalRouterDefault ? '' : storedNineRouterModel,
    openRouterBaseUrl: readString(value.openRouterBaseUrl, DEFAULT_SETTINGS.openRouterBaseUrl),
    openRouterApiKey: readString(value.openRouterApiKey, DEFAULT_SETTINGS.openRouterApiKey),
    openRouterModel: readString(value.openRouterModel, DEFAULT_SETTINGS.openRouterModel),
    fallbackToLmStudio: readBoolean(value.fallbackToLmStudio, DEFAULT_SETTINGS.fallbackToLmStudio),
    model: primaryModel,
    modelMode: (migratedLegacyDailyModel || migratedLegacyPrimaryModel) && modelMode === 'code' ? 'auto' : modelMode,
    singleModelEnabled: readBoolean(value.singleModelEnabled, DEFAULT_SETTINGS.singleModelEnabled),
    singleModel: readString(value.singleModel, DEFAULT_SETTINGS.singleModel),
    fastModel: dailyModel,
    codeModel: readString(value.codeModel, DEFAULT_SETTINGS.codeModel),
    reviewModel: readString(value.reviewModel, DEFAULT_SETTINGS.reviewModel),
    autoLoadModels: readBoolean(value.autoLoadModels, DEFAULT_SETTINGS.autoLoadModels),
    warmFastModelOnStartup: readBoolean(value.warmFastModelOnStartup, DEFAULT_SETTINGS.warmFastModelOnStartup),
    keepDailyModelWarm: readBoolean(value.keepDailyModelWarm, DEFAULT_SETTINGS.keepDailyModelWarm),
    backgroundPreloadCodeModel: migratedLegacyDailyModel ? false : readBoolean(value.backgroundPreloadCodeModel, DEFAULT_SETTINGS.backgroundPreloadCodeModel),
    heavyModelIdleUnloadMs: readNumber(value.heavyModelIdleUnloadMs, DEFAULT_SETTINGS.heavyModelIdleUnloadMs, 0, 60 * 60 * 1000),
    modelLoadTimeoutMs: readNumber(value.modelLoadTimeoutMs, DEFAULT_SETTINGS.modelLoadTimeoutMs, 5000, 10 * 60 * 1000),
    enableAutomaticReviewPass: readBoolean(value.enableAutomaticReviewPass, DEFAULT_SETTINGS.enableAutomaticReviewPass),
    warmModelWhileTyping: readBoolean(value.warmModelWhileTyping, DEFAULT_SETTINGS.warmModelWhileTyping),
    contextInjectionEnabled: readBoolean(value.contextInjectionEnabled, DEFAULT_SETTINGS.contextInjectionEnabled),
    contextBudgetChars: readNumber(value.contextBudgetChars, DEFAULT_SETTINGS.contextBudgetChars, 1000, 120000),
    showModelDebugInfo: readBoolean(value.showModelDebugInfo, DEFAULT_SETTINGS.showModelDebugInfo),
    developerDiagnosticsEnabled: readBoolean(value.developerDiagnosticsEnabled, DEFAULT_SETTINGS.developerDiagnosticsEnabled),
    nebulaCoreEnabled: readBoolean(value.nebulaCoreEnabled, DEFAULT_SETTINGS.nebulaCoreEnabled),
    desktopControlBetaEnabled: readBoolean(value.desktopControlBetaEnabled, DEFAULT_SETTINGS.desktopControlBetaEnabled),
    automationSchedulerEnabled: readBoolean(value.automationSchedulerEnabled, DEFAULT_SETTINGS.automationSchedulerEnabled),
    automationConfirmationMode: readEnum(value.automationConfirmationMode, ['safe_only', 'confirm_risky', 'manual_only'] as const, DEFAULT_SETTINGS.automationConfirmationMode),
    autoWebSearch: readBoolean(value.autoWebSearch, DEFAULT_SETTINGS.autoWebSearch),
    modelAssignments: {
      daily: dailyModel,
      code: readString(assignments.code, DEFAULT_SETTINGS.modelAssignments.code),
      review: readString(assignments.review, DEFAULT_SETTINGS.modelAssignments.review),
    },
    launcherIndexedFolders: readStringArray(value.launcherIndexedFolders, DEFAULT_SETTINGS.launcherIndexedFolders),
    trustedAppAliases: readStringRecord(value.trustedAppAliases),
    maxAutoFetchPages: Math.round(readNumber(value.maxAutoFetchPages, DEFAULT_SETTINGS.maxAutoFetchPages, 0, 8)),
    memoryReviewMode: readEnum(value.memoryReviewMode, ['suggest', 'auto', 'manual'] as const, DEFAULT_SETTINGS.memoryReviewMode),
    activeProjectProfileId: readString(value.activeProjectProfileId, DEFAULT_SETTINGS.activeProjectProfileId),
    projectProfileMode: readEnum(value.projectProfileMode, ['auto_editable'] as const, DEFAULT_SETTINGS.projectProfileMode),
    modelRoutingSuggestions: readBoolean(value.modelRoutingSuggestions, DEFAULT_SETTINGS.modelRoutingSuggestions),
    notificationMode: readEnum(value.notificationMode, ['in_app_tray'] as const, DEFAULT_SETTINGS.notificationMode),
    screenshotAskEnabled: readBoolean(value.screenshotAskEnabled, DEFAULT_SETTINGS.screenshotAskEnabled),
    startupAnimation: readEnum(value.startupAnimation, ['event_horizon', 'cinematic', 'simple', 'off'] as const, DEFAULT_SETTINGS.startupAnimation),
    temperature: readNumber(value.temperature, DEFAULT_SETTINGS.temperature, 0, 2),
    maxTokens: Math.round(readNumber(value.maxTokens, DEFAULT_SETTINGS.maxTokens, 64, 32768)),
    projectFolder: readString(value.projectFolder, DEFAULT_SETTINGS.projectFolder),
    memoryFolder: readString(value.memoryFolder, DEFAULT_SETTINGS.memoryFolder),
    requireApproval: readExecutionMode(value.actionMode) === 'approval',
    riskyToolsEnabled: readBoolean(value.riskyToolsEnabled, DEFAULT_SETTINGS.riskyToolsEnabled),
    actionMode: readExecutionMode(value.actionMode),
    assistantHoldMs: Math.round(readNumber(value.assistantHoldMs, DEFAULT_SETTINGS.assistantHoldMs, 120, 3000)),
    globalShortcutEnabled: readBoolean(value.globalShortcutEnabled, DEFAULT_SETTINGS.globalShortcutEnabled),
    launchAtStartup: readBoolean(value.launchAtStartup, DEFAULT_SETTINGS.launchAtStartup),
    keepRunningInBackground: readBoolean(value.keepRunningInBackground, DEFAULT_SETTINGS.keepRunningInBackground),
    screenAwarenessEnabled: readBoolean(value.screenAwarenessEnabled, DEFAULT_SETTINGS.screenAwarenessEnabled),
    voiceEnabled: readBoolean(value.voiceEnabled, DEFAULT_SETTINGS.voiceEnabled),
    voiceAutoStart: readBoolean(value.voiceAutoStart, DEFAULT_SETTINGS.voiceAutoStart),
    voiceLanguage: readString(value.voiceLanguage, DEFAULT_SETTINGS.voiceLanguage),
    voiceRecognitionMode: readEnum(value.voiceRecognitionMode, ['local_first', 'online', 'text_only'] as const, DEFAULT_SETTINGS.voiceRecognitionMode),
    voiceOnlineConsent: readBoolean(value.voiceOnlineConsent, DEFAULT_SETTINGS.voiceOnlineConsent),
    voiceAutoSubmit: readBoolean(value.voiceAutoSubmit, DEFAULT_SETTINGS.voiceAutoSubmit),
    voiceSilenceMs: Math.round(readNumber(value.voiceSilenceMs, DEFAULT_SETTINGS.voiceSilenceMs, 500, 5000)),
    voiceSpeakReplies: readBoolean(value.voiceSpeakReplies, DEFAULT_SETTINGS.voiceSpeakReplies),
    voiceSynthesisMode: readEnum(value.voiceSynthesisMode, ['neural_local', 'supertonic', 'system'] as const, DEFAULT_SETTINGS.voiceSynthesisMode),
    voiceNeuralVoice: readString(value.voiceNeuralVoice, DEFAULT_SETTINGS.voiceNeuralVoice),
    voiceSupertonicVoice: readString(value.voiceSupertonicVoice, DEFAULT_SETTINGS.voiceSupertonicVoice),
    voiceSystemVoice: readString(value.voiceSystemVoice, DEFAULT_SETTINGS.voiceSystemVoice),
    voiceRate: readNumber(value.voiceRate, DEFAULT_SETTINGS.voiceRate, 0.5, 2),
    voicePitch: readNumber(value.voicePitch, DEFAULT_SETTINGS.voicePitch, 0.5, 2),
    wakePhraseEnabled: readBoolean(value.wakePhraseEnabled, DEFAULT_SETTINGS.wakePhraseEnabled),
    wakePhrase: readString(value.wakePhrase, DEFAULT_SETTINGS.wakePhrase),
    theme: readVisualTheme(value.theme),
    profileAvatarMode: readEnum(value.profileAvatarMode, ['preset', 'image'] as const, DEFAULT_SETTINGS.profileAvatarMode),
    profileAvatarPath: readString(value.profileAvatarPath, DEFAULT_SETTINGS.profileAvatarPath),
    profileAvatarPreset: readEnum(value.profileAvatarPreset, ['nova', 'aurora', 'plasma', 'prism', 'eclipse', 'event_horizon', 'singularity', 'void', 'ion', 'pulsar', 'quasar', 'vector'] as const, DEFAULT_SETTINGS.profileAvatarPreset),
    setupWizardCompleted: readBoolean(value.setupWizardCompleted, DEFAULT_SETTINGS.setupWizardCompleted),
    setupWizardLastRunAt: readString(value.setupWizardLastRunAt, DEFAULT_SETTINGS.setupWizardLastRunAt),
    overlayQuickActionsEnabled: readBoolean(value.overlayQuickActionsEnabled, DEFAULT_SETTINGS.overlayQuickActionsEnabled),
    modelProfilerEnabled: readBoolean(value.modelProfilerEnabled, DEFAULT_SETTINGS.modelProfilerEnabled),
    dailyBriefEnabled: readBoolean(value.dailyBriefEnabled, DEFAULT_SETTINGS.dailyBriefEnabled),
    permissionCenterOverrides: readPermissionOverrides(value.permissionCenterOverrides),
  }
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const settings = sanitizeSettings(JSON.parse(raw))
    if (!localStorage.getItem(SINGLE_MODEL_MIGRATION_KEY)) {
      const migrated = {
        ...settings,
        modelProvider: 'lmstudio' as const,
        model: TUNED_QWEN_MODEL,
        modelMode: 'auto' as const,
        singleModelEnabled: true,
        singleModel: TUNED_QWEN_MODEL,
      }
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(migrated))
      localStorage.setItem(SINGLE_MODEL_MIGRATION_KEY, '1')
      return migrated
    }
    return settings
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: AppSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(settings)))
  } catch {
    // Keep Nebula running even when browser storage is unavailable or full.
  }
}
