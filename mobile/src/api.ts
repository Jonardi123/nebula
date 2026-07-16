import { readPrivateValue, writePrivateValue } from './idb'
import { apiUrl, deleteSecureValue, readSecureValue, shareValue, writeSecureValue } from './platform'
import type { ConversationStore, MobileControlSettings, MobileConversation, MobileDiagnostics, MobileModelSummary, MobileRunMode, RunEvent, RuntimeStatus, SearchResult } from './types'

const TOKEN_KEY = 'device-token'
const CACHE_KEY = 'conversation-cache'
let bridgeBaseUrl = ''
let conversationCacheEnabled = true

export function configureApiBridge(url: string) {
  bridgeBaseUrl = url.trim().replace(/\/$/, '')
}

export function configureApiCache(enabled: boolean) {
  conversationCacheEnabled = enabled
}

export class MobileApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function token() {
  return readSecureValue<string>(TOKEN_KEY)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = await token()
  const response = await fetch(apiUrl(path, bridgeBaseUrl), {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...init.headers,
    },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null
    throw new MobileApiError(response.status, body?.error?.code ?? 'request_failed', body?.error?.message ?? `Nebula request failed (${response.status}).`)
  }
  return response.json() as Promise<T>
}

export async function pairDevice(code: string, deviceName: string) {
  const result = await request<{ token: string }>('/api/v1/pair', {
    method: 'POST', body: JSON.stringify({ code, deviceName }),
  })
  await writeSecureValue(TOKEN_KEY, result.token)
}

export async function unpairDevice() {
  await deleteSecureValue(TOKEN_KEY)
}

export async function hasDeviceToken() {
  return Boolean(await token())
}

export async function getStatus() {
  return request<{ ok: true; runtime: RuntimeStatus }>('/api/v1/status')
}

export async function getConversations(): Promise<ConversationStore> {
  try {
    const result = await request<ConversationStore>('/api/v1/conversations')
    if (conversationCacheEnabled) await writePrivateValue(CACHE_KEY, result)
    return result
  } catch (error) {
    const cached = conversationCacheEnabled ? await readPrivateValue<ConversationStore>(CACHE_KEY) : undefined
    if (cached) return cached
    throw error
  }
}

export async function getCachedConversations() {
  return conversationCacheEnabled ? readPrivateValue<ConversationStore>(CACHE_KEY) : undefined
}

export async function createConversation() {
  return request<{ id: string }>('/api/v1/conversations', { method: 'POST', body: JSON.stringify({ title: 'New chat' }) })
}

export async function updateConversation(id: string, change: { title?: string; pinned?: boolean }) {
  return request<MobileConversation>(`/api/v1/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(change),
  })
}

export async function deleteConversation(id: string) {
  return request<{ ok: true; activeId: string }>(`/api/v1/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function searchConversations(query: string) {
  return request<SearchResult[]>(`/api/v1/search?q=${encodeURIComponent(query)}&limit=40`)
}

async function filePayload(file: File) {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  return { name: file.name, mimeType: file.type || 'application/octet-stream', dataBase64: btoa(binary) }
}

export async function startRun(
  conversationId: string | undefined,
  content: string,
  attachments: File[],
  mode: MobileRunMode = 'new',
  sourceMessageId?: string,
) {
  const encoded = await Promise.all(attachments.map(filePayload))
  return request<{ runId: string }>('/api/v1/runs', {
    method: 'POST', body: JSON.stringify({ conversationId, content, attachments: encoded, mode, sourceMessageId }),
  })
}

export async function copyText(value: string) {
  await navigator.clipboard.writeText(value)
}

export async function shareText(value: string) {
  await shareValue(value)
}

export function attachmentUrl(id: string) {
  return `/api/v1/attachments/${encodeURIComponent(id)}`
}

export async function getAttachmentBlob(id: string) {
  const auth = await token()
  const response = await fetch(apiUrl(attachmentUrl(id), bridgeBaseUrl), {
    cache: 'no-store', headers: auth ? { Authorization: `Bearer ${auth}` } : {},
  })
  if (!response.ok) throw new MobileApiError(response.status, 'attachment_failed', 'That attachment preview is unavailable.')
  return response.blob()
}

export async function streamRun(runId: string, onEvent: (event: RunEvent) => void, signal: AbortSignal) {
  const auth = await token()
  const response = await fetch(apiUrl(`/api/v1/runs/${encodeURIComponent(runId)}/events`, bridgeBaseUrl), {
    headers: auth ? { Authorization: `Bearer ${auth}` } : {}, signal, cache: 'no-store',
  })
  if (!response.ok || !response.body) throw new MobileApiError(response.status, 'stream_failed', 'Nebula could not open the response stream.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
      if (data) {
        try { onEvent(JSON.parse(data) as RunEvent) } catch { /* Ignore malformed transport frames. */ }
      }
      boundary = buffer.indexOf('\n\n')
    }
  }
}

export async function cancelRun(runId: string) {
  return request<{ ok: boolean }>(`/api/v1/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' })
}

export async function decideApproval(id: string, runId: string, approved: boolean, confirmation?: string) {
  return request<{ ok: boolean }>(`/api/v1/approvals/${encodeURIComponent(id)}`, {
    method: 'POST', body: JSON.stringify({ runId, approved, confirmation }),
  })
}

export async function getMobileControlSettings() {
  return request<MobileControlSettings>('/api/v1/settings/mobile-control')
}

export async function updateMobileControlSettings(revision: number, change: Partial<Omit<MobileControlSettings, 'revision'>>) {
  return request<MobileControlSettings>('/api/v1/settings/mobile-control', {
    method: 'PATCH', body: JSON.stringify({ revision, change }),
  })
}

export async function getMobileModels() {
  return request<MobileModelSummary[]>('/api/v1/models')
}

export async function getMobileDiagnostics() {
  const started = performance.now()
  const result = await request<MobileDiagnostics>('/api/v1/diagnostics/mobile')
  return { ...result, bridgeLatencyMs: Math.max(result.bridgeLatencyMs || 0, Math.round(performance.now() - started)) }
}
