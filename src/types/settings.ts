export type VisualTheme = 'black_matter' | 'original'
export type ThemeMode = VisualTheme
export type ExecutionMode = 'approval' | 'safe' | 'full'
export type ActionMode = ExecutionMode
export type ModelMode = 'auto' | 'fast' | 'code' | 'review'
export type ModelProvider = 'lmstudio' | '9router' | 'openrouter'
export type MemoryReviewMode = 'suggest' | 'auto' | 'manual'
export type ProjectProfileMode = 'auto_editable'
export type NotificationMode = 'in_app_tray'
export type StartupAnimationMode = 'event_horizon' | 'cinematic' | 'simple' | 'off'
export type ProfileAvatarMode = 'preset' | 'image'
export type ProfileAvatarCategory = 'nebula_originals' | 'black_matter' | 'signals'
export type ProfileAvatarPreset =
  | 'nova' | 'aurora' | 'plasma' | 'prism'
  | 'eclipse' | 'event_horizon' | 'singularity' | 'void'
  | 'ion' | 'pulsar' | 'quasar' | 'vector'
export type AutomationConfirmationMode = 'safe_only' | 'confirm_risky' | 'manual_only'
export type PermissionMode = 'enabled' | 'disabled'
export type ExperienceMode = 'simple' | 'advanced'
export type VoiceRecognitionMode = 'local_first' | 'online' | 'text_only'
export type VoiceSynthesisMode = 'neural_local' | 'supertonic' | 'system'

export interface AppSettings {
  experienceMode: ExperienceMode
  endpoint: string
  modelProvider: ModelProvider
  nineRouterBaseUrl: string
  nineRouterApiKey: string
  nineRouterModel: string
  openRouterBaseUrl: string
  openRouterApiKey: string
  openRouterModel: string
  fallbackToLmStudio: boolean
  model: string
  modelMode: ModelMode
  singleModelEnabled: boolean
  singleModel: string
  fastModel: string
  codeModel: string
  reviewModel: string
  autoLoadModels: boolean
  warmFastModelOnStartup: boolean
  keepDailyModelWarm: boolean
  backgroundPreloadCodeModel: boolean
  heavyModelIdleUnloadMs: number
  modelLoadTimeoutMs: number
  enableAutomaticReviewPass: boolean
  warmModelWhileTyping: boolean
  contextInjectionEnabled: boolean
  contextBudgetChars: number
  showModelDebugInfo: boolean
  developerDiagnosticsEnabled: boolean
  nebulaCoreEnabled: boolean
  desktopControlBetaEnabled: boolean
  automationSchedulerEnabled: boolean
  automationConfirmationMode: AutomationConfirmationMode
  autoWebSearch: boolean
  modelAssignments: {
    daily: string
    code: string
    review: string
  }
  launcherIndexedFolders: string[]
  trustedAppAliases: Record<string, string>
  maxAutoFetchPages: number
  memoryReviewMode: MemoryReviewMode
  activeProjectProfileId: string
  projectProfileMode: ProjectProfileMode
  modelRoutingSuggestions: boolean
  notificationMode: NotificationMode
  screenshotAskEnabled: boolean
  startupAnimation: StartupAnimationMode
  temperature: number
  maxTokens: number
  projectFolder: string
  memoryFolder: string
  requireApproval: boolean
  riskyToolsEnabled: boolean
  actionMode: ActionMode
  assistantHoldMs: number
  globalShortcutEnabled: boolean
  launchAtStartup: boolean
  keepRunningInBackground: boolean
  screenAwarenessEnabled: boolean
  voiceEnabled: boolean
  voiceAutoStart: boolean
  voiceLanguage: string
  voiceRecognitionMode: VoiceRecognitionMode
  voiceOnlineConsent: boolean
  voiceAutoSubmit: boolean
  voiceSilenceMs: number
  voiceSpeakReplies: boolean
  voiceSynthesisMode: VoiceSynthesisMode
  voiceNeuralVoice: string
  voiceSupertonicVoice: string
  voiceSystemVoice: string
  voiceRate: number
  voicePitch: number
  wakePhraseEnabled: boolean
  wakePhrase: string
  theme: ThemeMode
  profileAvatarMode: ProfileAvatarMode
  profileAvatarPath: string
  profileAvatarPreset: ProfileAvatarPreset
  setupWizardCompleted: boolean
  setupWizardLastRunAt: string
  overlayQuickActionsEnabled: boolean
  modelProfilerEnabled: boolean
  dailyBriefEnabled: boolean
  permissionCenterOverrides: Record<string, PermissionMode>
}
