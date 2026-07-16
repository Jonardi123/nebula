import { invoke } from '@tauri-apps/api/core'
import type { ComposerAttachment } from '../types/nebula'
import type { AppSettings } from '../types/settings'

export interface RemoteRunRequest {
  runId: string
  clientId: string
  conversationId?: string
  content: string
  attachments: ComposerAttachment[]
  mode: 'new' | 'retry' | 'regenerate'
  sourceMessageId?: string
}

export interface RemoteRunCancel {
  runId: string
  clientId: string
}

export interface RemoteApprovalDecision {
  runId: string
  approvalId: string
  approved: boolean
  confirmation?: string
  clientId: string
}

export interface RemoteMobileSettingsChange {
  change: Record<string, unknown>
  revision: number
  clientId: string
}

export interface MobileClientRecord {
  id: string
  name: string
  createdAt: string
  lastSeenAt: string
  revokedAt?: string
}

export interface MobileBridgeSnapshot {
  listening: boolean
  port: number
  tailscaleOnline: boolean
  serveEnabled: boolean
  installUrl?: string
  lastError?: string
  pairedClients: MobileClientRecord[]
}

export interface PairingCodeResult {
  code: string
  expiresAtMs: number
  installUrl?: string
}

export function createMobileRunSink(runId: string) {
  let tokenBuffer = ''
  let tokenMessageId = ''
  let timer: number | null = null
  let sequence = Promise.resolve()

  function enqueue(event: Record<string, unknown>) {
    sequence = sequence.then(() => invoke<void>('mobile_bridge_publish_event', { runId, event })).catch(() => undefined)
    return sequence
  }

  function flushTokens() {
    if (timer !== null) window.clearTimeout(timer)
    timer = null
    const token = tokenBuffer
    const messageId = tokenMessageId
    tokenBuffer = ''
    tokenMessageId = ''
    if (token) void enqueue({ type: 'token', token, messageId })
  }

  return {
    event(type: string, detail: Record<string, unknown> = {}) {
      flushTokens()
      return enqueue({ type, ...detail })
    },
    token(messageId: string, token: string) {
      if (tokenMessageId && tokenMessageId !== messageId) flushTokens()
      tokenMessageId = messageId
      tokenBuffer += token
      if (timer === null) timer = window.setTimeout(flushTokens, 36)
    },
    async flush() {
      flushTokens()
      await sequence
    },
  }
}

export function updateMobileRuntimeStatus(status: Record<string, unknown>) {
  return invoke('mobile_bridge_update_runtime_status', { status }).catch(() => undefined)
}

export function mobileControlSnapshot(settings: AppSettings) {
  return {
    modelMode: settings.modelMode,
    singleModelEnabled: settings.singleModelEnabled,
    singleModel: settings.singleModel,
    dailyModel: settings.modelAssignments.daily,
    codeModel: settings.modelAssignments.code,
    reviewModel: settings.modelAssignments.review,
    autoLoadModels: settings.autoLoadModels,
    keepDailyModelWarm: settings.keepDailyModelWarm,
    warmModelWhileTyping: settings.warmModelWhileTyping,
    backgroundPreloadCodeModel: settings.backgroundPreloadCodeModel,
    enableAutomaticReviewPass: settings.enableAutomaticReviewPass,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    contextInjectionEnabled: settings.contextInjectionEnabled,
    contextBudgetChars: settings.contextBudgetChars,
    autoWebSearch: settings.autoWebSearch,
    maxAutoFetchPages: settings.maxAutoFetchPages,
    memoryReviewMode: settings.memoryReviewMode,
    actionMode: settings.actionMode,
  }
}

export function applyMobileControlChange(settings: AppSettings, change: Record<string, unknown>): AppSettings {
  const next = { ...settings }
  const assign = <K extends keyof AppSettings>(key: K) => {
    if (key in change) (next as Record<string, unknown>)[key] = change[key as string]
  }
  assign('modelMode'); assign('singleModelEnabled'); assign('singleModel')
  assign('autoLoadModels'); assign('keepDailyModelWarm'); assign('warmModelWhileTyping')
  assign('backgroundPreloadCodeModel'); assign('enableAutomaticReviewPass')
  assign('temperature'); assign('maxTokens'); assign('contextInjectionEnabled')
  assign('contextBudgetChars'); assign('autoWebSearch'); assign('maxAutoFetchPages')
  assign('memoryReviewMode'); assign('actionMode')
  const daily = typeof change.dailyModel === 'string' ? change.dailyModel : settings.modelAssignments.daily
  const code = typeof change.codeModel === 'string' ? change.codeModel : settings.modelAssignments.code
  const review = typeof change.reviewModel === 'string' ? change.reviewModel : settings.modelAssignments.review
  next.modelAssignments = { daily, code, review }
  next.fastModel = daily
  next.codeModel = code
  next.reviewModel = review
  if (typeof change.singleModel === 'string' && change.singleModel) next.model = change.singleModel
  next.requireApproval = next.actionMode !== 'fast'
  return next
}
