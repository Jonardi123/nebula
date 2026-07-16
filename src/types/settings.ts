export type ThemeMode = 'dark' | 'darker'
export type ActionMode = 'fast' | 'guarded' | 'strict'
export type ModelMode = 'auto' | 'fast' | 'code' | 'review'
export type ModelProvider = 'lmstudio' | '9router' | 'openrouter'
export type MemoryReviewMode = 'suggest' | 'auto' | 'manual'
export type ProjectProfileMode = 'auto_editable'
export type NotificationMode = 'in_app_tray'
export type StartupAnimationMode = 'cinematic' | 'simple' | 'off'
export type ProfileAvatarMode = 'preset' | 'image'
export type ProfileAvatarPreset = 'nova' | 'aurora' | 'eclipse' | 'plasma'
export type AutomationConfirmationMode = 'safe_only' | 'confirm_risky' | 'manual_only'
export type PermissionMode = 'enabled' | 'disabled'

export interface AppSettings {
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
