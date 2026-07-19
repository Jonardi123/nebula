export interface MobileMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  createdAt: string
  toolResult?: unknown
  attachments?: MobileAttachment[]
}

export interface MobileAttachment {
  id: string
  kind: string
  label: string
  detail?: string
  mimeType?: string
}

export interface MobileConversation {
  id: string
  title: string
  messages: MobileMessage[]
  projectFolder?: string
  folderId?: string
  pinned: boolean
  createdAt: string
  updatedAt: string
}

export interface MobileFolder {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface ConversationStore {
  version: number
  activeId: string
  sessions: MobileConversation[]
  folders: MobileFolder[]
}

export interface RuntimeStatus {
  agentStatus?: string
  service?: string
  model?: string
  memoryReady?: boolean
  activeRunSource?: 'desktop' | 'mobile' | null
  activeProject?: { name: string } | null
  capabilities?: MobileCapabilities
}

export type MobileIntentMode =
  | 'auto'
  | 'web_search'
  | 'deep_research'
  | 'deep_thinking'
  | 'project_search'
  | 'guided_learning'
  | 'personal_intelligence'

export interface MobileCapabilities {
  webSearch: boolean
  deepResearch: boolean
  deepThinking: boolean
  projectSearch: boolean
  projectContext: boolean
  guidedLearning: boolean
  personalIntelligence: boolean
}

export interface MobileSourceCard {
  id: string
  title: string
  url: string
  snippet: string
  dateChecked?: string
}

export type MobileTheme = 'system' | 'dark' | 'light'

export interface MobilePreferences {
  version: 1
  theme: MobileTheme
  textScale: number
  compactMessages: boolean
  showTimestamps: boolean
  wrapCode: boolean
  reducedMotion: boolean
  reducedTransparency: boolean
  highContrast: boolean
  haptics: boolean
  accentIntensity: number
  streamResponses: boolean
  autoScroll: boolean
  persistDrafts: boolean
  submitOnEnter: boolean
  showToolActivity: boolean
  readAloud: boolean
  completionSound: boolean
  cacheHistory: boolean
  voiceLanguage: string
  voiceAutoSubmit: boolean
  voiceSilenceMs: number
  voiceSpeakVoiceReplies: boolean
  voiceOnlineConsent: boolean
  speechRate: number
  speechPitch: number
  autoReconnect: boolean
  bridgeUrl: string
  notifyOnComplete: boolean
  notifyOnApproval: boolean
  showDiagnostics: boolean
  showModelName: boolean
}

export type MobileModelMode = 'auto' | 'fast' | 'code' | 'review'
export type MobileMemoryReviewMode = 'suggest' | 'auto' | 'manual'
export type MobileActionMode = 'fast' | 'guarded' | 'strict'

export interface MobileControlSettings {
  revision: number
  modelMode: MobileModelMode
  singleModelEnabled: boolean
  singleModel: string
  dailyModel: string
  codeModel: string
  reviewModel: string
  autoLoadModels: boolean
  keepDailyModelWarm: boolean
  warmModelWhileTyping: boolean
  backgroundPreloadCodeModel: boolean
  enableAutomaticReviewPass: boolean
  temperature: number
  maxTokens: number
  contextInjectionEnabled: boolean
  contextBudgetChars: number
  autoWebSearch: boolean
  maxAutoFetchPages: number
  memoryReviewMode: MobileMemoryReviewMode
  actionMode: MobileActionMode
}

export interface MobileModelSummary {
  key: string
  displayName: string
  loaded: boolean
  sizeBytes?: number
  architecture?: string
  quantization?: string
}

export interface MobileDiagnostics {
  service: string
  agentStatus: string
  activeModel: string
  activeRunSource?: string | null
  memoryReady: boolean
  bridgeLatencyMs: number
  generatedAt: string
}

export interface ApprovalEvent {
  id: string
  runId: string
  toolRequest: { tool: string; args: Record<string, unknown> }
  riskLevel: string
  reason: string
  requiresTypedConfirm: boolean
  oldContent?: string
  newContent?: string
}

export type RunEvent = {
  type: 'accepted' | 'status' | 'token' | 'message' | 'tool_request' | 'tool_result' | 'source' | 'approval_required' | 'approval_resolved' | 'error' | 'cancelled' | 'completed'
  runId: string
  conversationId?: string
  messageId?: string
  token?: string
  content?: string
  status?: string
  message?: string
  code?: string
  request?: ApprovalEvent['toolRequest']
  result?: unknown
  approval?: ApprovalEvent
  source?: MobileSourceCard
}

export interface SearchResult {
  conversationId: string
  title: string
  excerpt: string
  updatedAt: string
}

export type MobileRunMode = 'new' | 'retry' | 'regenerate'
