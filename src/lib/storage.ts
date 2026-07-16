import { invoke } from '@tauri-apps/api/core'
import type { ConversationSearchResult, ConversationStore } from '../types/nebula'
import { isTauriRuntime } from './runtime'

export interface StorageMigrationReport {
  success: boolean
  alreadyComplete: boolean
  backupPath?: string
  importedKeys: number
  importedRecords: number
  verifiedRecords: number
  removableKeys: string[]
  error?: string
}

export interface RecoveryNotice {
  interrupted: boolean
  previousSessionId?: string
  message?: string
}

export interface ConversationRepository {
  load(): Promise<ConversationStore | null>
  save(store: ConversationStore): Promise<void>
  search(query: string, limit?: number): Promise<ConversationSearchResult[]>
  flush(): Promise<void>
}

export interface DocumentRepository<T> {
  get(id: string): Promise<T | null>
  put(id: string, value: T): Promise<void>
  list(): Promise<Array<{ id: string; value: T; createdAt: string; updatedAt: string }>>
  delete(id: string): Promise<void>
}

const MIGRATABLE_KEYS = [
  'nebula-conversations-v1',
  'nebula-command-center-automations', 'nebula-command-center-runs', 'nebula-command-center-events',
  'nebula-context-pins-v1', 'nebula-daily-brief-v1', 'nebula-file-insights', 'nebula-memory-proposals',
  'nebula-model-speed-profiles', 'nebula-model-run-stats', 'nebula-bench-results', 'nebula-notifications',
  'nebula-orchestrator-diagnostics', 'nebula-patch-proposals', 'nebula-project-health-v1', 'nebula-project-profiles',
  'nebula-quick-action-runs', 'nebula-skill-drafts', 'nebula-source-cards', 'nebula-task-queue',
  'nebula-task-runs', 'nebula-training-logs', 'nebula-voice-diagnostics-v1', 'nebula-workspace-awareness',
  'nebula-skill-state', 'nebula-marketplace-installs', 'nebula-skill-runtime-stats',
]

let initialization: Promise<RecoveryNotice | null> | null = null

export function initializeStorage() {
  if (initialization) return initialization
  initialization = (async () => {
    if (!isTauriRuntime()) return null
    const notice = await invoke<RecoveryNotice>('storage_initialize')
    const entries = MIGRATABLE_KEYS.flatMap((key) => {
      const value = localStorage.getItem(key)
      return value === null ? [] : [{ key, value }]
    })
    if (entries.length) {
      const report = await invoke<StorageMigrationReport>('storage_migrate_legacy', { entries })
      if (!report.success) console.warn('Nebula storage migration retained legacy data:', report.error)
      // Conversations have an async repository. Other stores remain as local caches and are
      // dual-written until each feature moves behind DocumentRepository.
      if (report.success && report.removableKeys.includes('nebula-conversations-v1')) {
        localStorage.removeItem('nebula-conversations-v1')
      }
    }
    window.dispatchEvent(new CustomEvent('nebula-storage-ready', { detail: notice }))
    return notice
  })().catch((error) => {
    console.error('Nebula durable storage is unavailable; using legacy storage.', error)
    window.dispatchEvent(new CustomEvent('nebula-storage-error', { detail: String(error) }))
    return null
  })
  return initialization
}

let pendingStore: ConversationStore | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let inFlightSave: Promise<void> | null = null

async function writePendingStore() {
  if (!pendingStore || !isTauriRuntime()) return
  const store = pendingStore
  pendingStore = null
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  inFlightSave = invoke('storage_save_conversations', { store }).then(() => undefined)
  try {
    await inFlightSave
  } finally {
    inFlightSave = null
    if (pendingStore) scheduleConversationSave(pendingStore)
  }
}

export function scheduleConversationSave(store: ConversationStore) {
  if (!isTauriRuntime()) return
  pendingStore = store
  if (saveTimer) return
  saveTimer = setTimeout(() => void writePendingStore(), 400)
}

export function discardScheduledConversationSave() {
  pendingStore = null
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = null
}

export const conversationRepository: ConversationRepository = {
  async load() {
    if (!isTauriRuntime()) return null
    await initializeStorage()
    return invoke<ConversationStore | null>('storage_load_conversations')
  },
  async save(store) {
    if (!isTauriRuntime()) return
    pendingStore = store
    await writePendingStore()
  },
  async search(query, limit = 40) {
    if (!isTauriRuntime()) return []
    await initializeStorage()
    return invoke<ConversationSearchResult[]>('storage_search_conversations', { query, limit })
  },
  async flush() {
    await writePendingStore()
    if (inFlightSave) await inFlightSave
  },
}

export function createDocumentRepository<T>(namespace: string): DocumentRepository<T> {
  return {
    async get(id) {
      if (!isTauriRuntime()) return null
      await initializeStorage()
      return invoke<T | null>('storage_get_document', { namespace, id })
    },
    async put(id, value) {
      if (!isTauriRuntime()) return
      await initializeStorage()
      await invoke('storage_put_document', { namespace, id, value })
    },
    async list() {
      if (!isTauriRuntime()) return []
      await initializeStorage()
      return invoke<Array<{ id: string; value: T; createdAt: string; updatedAt: string }>>('storage_list_documents', { namespace })
    },
    async delete(id) {
      if (!isTauriRuntime()) return
      await initializeStorage()
      await invoke('storage_delete_document', { namespace, id })
    },
  }
}

export function installStorageLifecycle() {
  if (!isTauriRuntime()) return () => undefined
  const flush = () => void conversationRepository.flush()
  const shutdown = () => {
    flush()
    void invoke('storage_close_session').catch(() => undefined)
  }
  const visibility = () => { if (document.visibilityState === 'hidden') flush() }
  window.addEventListener('pagehide', shutdown)
  document.addEventListener('visibilitychange', visibility)
  return () => {
    window.removeEventListener('pagehide', shutdown)
    document.removeEventListener('visibilitychange', visibility)
    flush()
    void invoke('storage_close_session').catch(() => undefined)
  }
}
