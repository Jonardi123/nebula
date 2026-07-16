import type { ChatMessage } from '../types/agent'
import type { ConversationFolder, ConversationSearchResult, ConversationSession, ConversationStore } from '../types/nebula'
import { preserveCorruptLocalValue } from './safeStorage'

const CONVERSATIONS_KEY = 'nebula-conversations-v1'
const STORE_VERSION = 2
const MAX_SESSIONS = 48
const MAX_FOLDERS = 24
const MAX_MESSAGES_PER_SESSION = 180
const MAX_MESSAGE_CHARS = 30000

function now() {
  return new Date().toISOString()
}

function bootMessage(): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: 'Nebula online. Point me at a project folder, make sure LM Studio local server is running, and I can start working.',
    createdAt: now(),
  }
}

function clip(value: unknown, limit: number) {
  const text = typeof value === 'string' ? value : ''
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 16))}\n...[trimmed]` : text
}

function normalizeMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ChatMessage>
  if (!candidate.id || !candidate.createdAt || !['user', 'assistant', 'system', 'tool'].includes(String(candidate.role))) return null
  return {
    id: String(candidate.id),
    role: candidate.role as ChatMessage['role'],
    content: clip(candidate.content, MAX_MESSAGE_CHARS),
    createdAt: String(candidate.createdAt),
    toolResult: candidate.toolResult,
    attachments: Array.isArray(candidate.attachments)
      ? candidate.attachments.filter((item) => item && typeof item.id === 'string' && typeof item.label === 'string').slice(0, 12)
      : undefined,
  }
}

function normalizeSession(value: unknown): ConversationSession | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ConversationSession>
  if (!candidate.id || !candidate.createdAt || !candidate.updatedAt) return null
  const messages = Array.isArray(candidate.messages)
    ? candidate.messages.map(normalizeMessage).filter((message): message is ChatMessage => Boolean(message)).slice(-MAX_MESSAGES_PER_SESSION)
    : []

  return {
    id: String(candidate.id),
    title: clip(candidate.title || 'New chat', 96).trim() || 'New chat',
    messages: messages.length ? messages : [bootMessage()],
    projectFolder: typeof candidate.projectFolder === 'string' ? candidate.projectFolder : undefined,
    folderId: typeof candidate.folderId === 'string' ? candidate.folderId : undefined,
    pinned: Boolean(candidate.pinned),
    createdAt: String(candidate.createdAt),
    updatedAt: String(candidate.updatedAt),
  }
}

function normalizeFolder(value: unknown): ConversationFolder | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ConversationFolder>
  const name = clip(candidate.name, 48).trim()
  if (!candidate.id || !name) return null
  return {
    id: String(candidate.id),
    name,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : now(),
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : now(),
  }
}

function createSession(projectFolder?: string): ConversationSession {
  const timestamp = now()
  return {
    id: crypto.randomUUID(),
    title: 'New chat',
    messages: [bootMessage()],
    projectFolder: projectFolder || undefined,
    pinned: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function deriveConversationTitle(messages: ChatMessage[], fallback = 'New chat') {
  const firstUserMessage = messages.find((message) => message.role === 'user')?.content ?? ''
  const compact = firstUserMessage.replace(/\s+/g, ' ').trim()
  if (!compact) return fallback
  return compact.length > 54 ? `${compact.slice(0, 53).trimEnd()}...` : compact
}

export function loadConversationStore(projectFolder?: string): ConversationStore {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(CONVERSATIONS_KEY)
    if (!raw) {
      const session = createSession(projectFolder)
      return { version: STORE_VERSION, activeId: session.id, sessions: [session], folders: [] }
    }

    const parsed = JSON.parse(raw) as Partial<ConversationStore>
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.map(normalizeSession).filter((session): session is ConversationSession => Boolean(session)).slice(0, MAX_SESSIONS)
      : []
    if (sessions.length === 0) {
      const session = createSession(projectFolder)
      return { version: STORE_VERSION, activeId: session.id, sessions: [session], folders: [] }
    }

    const folders = Array.isArray(parsed.folders)
      ? parsed.folders.map(normalizeFolder).filter((folder): folder is ConversationFolder => Boolean(folder)).slice(0, MAX_FOLDERS)
      : []
    const folderIds = new Set(folders.map((folder) => folder.id))
    const normalizedSessions = sessions.map((session) => session.folderId && !folderIds.has(session.folderId) ? { ...session, folderId: undefined } : session)
    const activeId = normalizedSessions.some((session) => session.id === parsed.activeId) ? String(parsed.activeId) : normalizedSessions[0].id
    return { version: STORE_VERSION, activeId, sessions: normalizedSessions, folders }
  } catch {
    if (raw) preserveCorruptLocalValue(CONVERSATIONS_KEY, raw)
    const session = createSession(projectFolder)
    return { version: STORE_VERSION, activeId: session.id, sessions: [session], folders: [] }
  }
}

export function saveConversationStore(store: ConversationStore) {
  try {
    const sessions = [...store.sessions]
      .sort((left, right) => {
        if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
        return right.updatedAt.localeCompare(left.updatedAt)
      })
      .slice(0, MAX_SESSIONS)
      .map((session) => ({
        ...session,
        title: clip(session.title, 96),
        messages: session.messages.slice(-MAX_MESSAGES_PER_SESSION).map((message) => ({ ...message, content: clip(message.content, MAX_MESSAGE_CHARS) })),
      }))
    const activeId = sessions.some((session) => session.id === store.activeId) ? store.activeId : sessions[0]?.id ?? ''
    const folders = store.folders.slice(0, MAX_FOLDERS).map((folder) => ({ ...folder, name: clip(folder.name, 48).trim() }))
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify({ version: STORE_VERSION, activeId, sessions, folders }))
    window.dispatchEvent(new CustomEvent('nebula-conversations-changed'))
  } catch {
    // Conversation recovery is best-effort. A full storage quota must never break chat.
  }
}

export function searchConversations(sessions: ConversationSession[], query: string, limit = 40): ConversationSearchResult[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return sessions.slice(0, limit).map((session) => ({
    conversationId: session.id,
    title: session.title,
    folderId: session.folderId,
    projectFolder: session.projectFolder,
    excerpt: session.messages.find((message) => message.role === 'user')?.content.slice(0, 180) ?? '',
    score: session.pinned ? 2 : 1,
    updatedAt: session.updatedAt,
  }))

  const results: ConversationSearchResult[] = []
  for (const session of sessions) {
      const title = session.title.toLowerCase()
      let score = terms.reduce((total, term) => total + (title.includes(term) ? 8 : 0), 0)
      let bestMessage: ChatMessage | undefined
      for (const message of session.messages) {
        const content = message.content.toLowerCase()
        const matches = terms.filter((term) => content.includes(term)).length
        if (matches > 0 && (!bestMessage || matches > terms.filter((term) => bestMessage!.content.toLowerCase().includes(term)).length)) bestMessage = message
        score += matches * (message.role === 'user' ? 3 : 1)
      }
      if (session.pinned) score += 1
      if (score === 0) continue
      const excerpt = (bestMessage?.content ?? session.title).replace(/\s+/g, ' ').trim()
      results.push({
        conversationId: session.id,
        title: session.title,
        folderId: session.folderId,
        projectFolder: session.projectFolder,
        excerpt: excerpt.length > 180 ? `${excerpt.slice(0, 177)}...` : excerpt,
        messageId: bestMessage?.id,
        score,
        updatedAt: session.updatedAt,
      })
  }
  return results.sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt)).slice(0, limit)
}

export function createConversation(projectFolder?: string) {
  return createSession(projectFolder)
}

export function clearConversationStore() {
  try {
    localStorage.removeItem(CONVERSATIONS_KEY)
    window.dispatchEvent(new CustomEvent('nebula-conversations-changed'))
  } catch {
    // No-op when storage is unavailable.
  }
}
