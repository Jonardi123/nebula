import { invoke } from '@tauri-apps/api/core'
import type { ChatMessage } from '../types/agent'
import type { AppSettings } from '../types/settings'
import type { OpenAIToolDefinition } from '../skills/types'
import type { ModelInfo } from '../types/nebula'

export interface LmStudioStatus {
  online: boolean
  model: string
  error?: string
}

export interface LmToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface LmChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  name?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
}

export interface LmChatResponse {
  content: string
  toolCalls: LmToolCall[]
  rawMessage?: unknown
}

export type LmStudioModelInfo = ModelInfo

function providerDisplayName(settings: AppSettings) {
  if (activeProvider(settings) === '9router') return '9Router'
  if (activeProvider(settings) === 'openrouter') return 'OpenRouter'
  return 'LM Studio'
}

function modelsEndpoint(endpoint: string) {
  return endpoint.replace(/\/chat\/completions\/?$/i, '/models')
}

function activeProvider(settings: AppSettings) {
  return settings.modelProvider ?? 'lmstudio'
}

function nineRouterBase(settings: AppSettings) {
  return (settings.nineRouterBaseUrl || 'http://localhost:20128/v1').replace(/\/$/, '')
}

function nineRouterChatEndpoint(settings: AppSettings) {
  return `${nineRouterBase(settings)}/chat/completions`
}

function nineRouterModelsEndpoint(settings: AppSettings) {
  return `${nineRouterBase(settings)}/models`
}

function openRouterBase(settings: AppSettings) {
  return (settings.openRouterBaseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '')
}

function openRouterChatEndpoint(settings: AppSettings) {
  return `${openRouterBase(settings)}/chat/completions`
}

function openRouterModelsEndpoint(settings: AppSettings) {
  return `${openRouterBase(settings)}/models`
}

function nineRouterApiKey(settings: AppSettings) {
  return settings.nineRouterApiKey || import.meta.env.VITE_9ROUTER_API_KEY || ''
}

function openRouterApiKey(settings: AppSettings) {
  return settings.openRouterApiKey || import.meta.env.VITE_OPENROUTER_API_KEY || ''
}

function providerModel(settings: AppSettings) {
  if (activeProvider(settings) === '9router') return settings.nineRouterModel || settings.model
  if (activeProvider(settings) === 'openrouter') return settings.openRouterModel || settings.model
  return settings.model
}

function withProviderModel(settings: AppSettings, body: Record<string, any>) {
  return { ...body, model: providerModel(settings) }
}

function providerHeaders(settings: AppSettings) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (activeProvider(settings) === '9router') {
    const key = nineRouterApiKey(settings)
    if (key) headers.Authorization = `Bearer ${key}`
  }
  if (activeProvider(settings) === 'openrouter') {
    const key = openRouterApiKey(settings)
    if (key) headers.Authorization = `Bearer ${key}`
    headers['X-OpenRouter-Title'] = 'Nebula'
    headers['HTTP-Referer'] = 'https://local.nebula.app'
  }
  return headers
}

function fallbackSettings(settings: AppSettings): AppSettings {
  return { ...settings, modelProvider: 'lmstudio', model: settings.modelAssignments?.daily || settings.fastModel || settings.model }
}

async function providerError(response: Response, provider: string) {
  const detail = await response.text().catch(() => '')
  const compactDetail = detail.replace(/\s+/g, ' ').trim()
  return new Error(`${provider} request failed: ${response.status} ${response.statusText}${compactDetail ? ` - ${compactDetail}` : ''}`)
}

function providerNetworkError(error: unknown, settings: AppSettings, action: string) {
  if (activeProvider(settings) === 'lmstudio') return lmStudioNetworkError(error, settings, action)
  const message = error instanceof Error ? error.message : String(error)
  const isOpenRouter = activeProvider(settings) === 'openrouter'
  const provider = isOpenRouter ? 'OpenRouter' : '9Router'
  const endpoint = isOpenRouter ? openRouterChatEndpoint(settings) : nineRouterChatEndpoint(settings)
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new Error(`${provider} timed out while trying to ${action}. Endpoint: ${endpoint}`)
  }
  if (/Failed to fetch|NetworkError|Load failed|fetch/i.test(message)) {
    if (isOpenRouter) {
      return new Error(`OpenRouter unavailable at ${endpoint}. Check internet/API key or switch provider. ${settings.fallbackToLmStudio ? 'Nebula can fallback to LM Studio.' : 'Fallback is disabled.'}`)
    }
    return new Error(`9Router unavailable at ${endpoint}. Start 9Router on localhost:20128 or switch provider. ${settings.fallbackToLmStudio ? 'Nebula can fallback to LM Studio.' : 'Fallback is disabled.'}`)
  }
  return new Error(`${provider} connection failed while trying to ${action}: ${message}`)
}

async function providerChat(settings: AppSettings, body: Record<string, any>, timeoutMs: number, action: string) {
  if (activeProvider(settings) === 'lmstudio') {
    try {
      return await tauriLmStudioChat(settings, body, timeoutMs)
    } catch (error) {
      if (!isTauriInvokeUnavailable(error)) throw error
    }
  }

  let response: Response
  try {
    response = await fetchWithTimeout(
      activeProvider(settings) === '9router'
        ? nineRouterChatEndpoint(settings)
        : activeProvider(settings) === 'openrouter'
          ? openRouterChatEndpoint(settings)
          : settings.endpoint,
      {
        method: 'POST',
        headers: providerHeaders(settings),
        body: JSON.stringify(withProviderModel(settings, body)),
      },
      timeoutMs,
    )
  } catch (error) {
    throw providerNetworkError(error, settings, action)
  }

  if (!response.ok) throw await providerError(response, activeProvider(settings) === '9router' ? '9Router' : activeProvider(settings) === 'openrouter' ? 'OpenRouter' : 'LM Studio')
  return response.json()
}

async function providerChatWithFallback(settings: AppSettings, body: Record<string, any>, timeoutMs: number, action: string) {
  try {
    return await providerChat(settings, body, timeoutMs, action)
  } catch (error) {
    if ((activeProvider(settings) === '9router' || activeProvider(settings) === 'openrouter') && settings.fallbackToLmStudio) {
      const fallback = fallbackSettings(settings)
      console.warn(`${activeProvider(settings)} unavailable; falling back to LM Studio.`, error)
      return providerChat(fallback, { ...body, model: fallback.model }, timeoutMs, `${action} via LM Studio fallback`)
    }
    throw error
  }
}

function nativeApiBase(endpoint: string) {
  return endpoint
    .replace(/\/v1\/chat\/completions\/?$/i, '/api/v1')
    .replace(/\/v1\/responses\/?$/i, '/api/v1')
    .replace(/\/v1\/?$/i, '/api/v1')
}

function nativeModelsEndpoint(endpoint: string) {
  return `${nativeApiBase(endpoint).replace(/\/$/, '')}/models`
}

function nativeModelLoadEndpoint(endpoint: string) {
  return `${nativeApiBase(endpoint).replace(/\/$/, '')}/models/load`
}

function nativeModelUnloadEndpoint(endpoint: string) {
  return `${nativeApiBase(endpoint).replace(/\/$/, '')}/models/unload`
}

function normalizeModelName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

const activeRequestControllers = new Set<AbortController>()
const userCancelledControllers = new WeakSet<AbortController>()

export function cancelActiveLmStudioRequests() {
  for (const controller of activeRequestControllers) {
    userCancelledControllers.add(controller)
    controller.abort()
  }
  activeRequestControllers.clear()
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  activeRequestControllers.add(controller)
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (userCancelledControllers.has(controller)) throw new Error('Nebula request cancelled by user.', { cause: error })
    throw error
  } finally {
    window.clearTimeout(timeout)
    activeRequestControllers.delete(controller)
  }
}

function lmStudioNetworkError(error: unknown, settings: AppSettings, action = 'reach LM Studio') {
  const message = error instanceof Error ? error.message : String(error)
  const endpoint = settings.endpoint || 'http://localhost:1234/v1/chat/completions'

  if (error instanceof DOMException && error.name === 'AbortError') {
    return new Error(`LM Studio timed out while trying to ${action}. Check whether the model is still loading, then try again. Endpoint: ${endpoint}`)
  }

  if (/Failed to fetch|NetworkError|Load failed|fetch/i.test(message)) {
    return new Error(`Nebula could not ${action}. Make sure LM Studio is open, the local server is enabled, and the endpoint is correct: ${endpoint}`)
  }

  return new Error(`LM Studio connection failed while trying to ${action}: ${message}`)
}

function isTauriInvokeUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /not found|unknown command|not available|__TAURI__|ipc|invoke/i.test(message)
}

async function invokeLmStudioText(command: string, args: Record<string, unknown>) {
  try {
    return await invoke<string>(command, args)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(message, { cause: error })
  }
}

async function tauriLmStudioChat(settings: AppSettings, body: Record<string, unknown>, timeoutMs = 120000) {
  const text = await invokeLmStudioText('lmstudio_chat_completion', {
    endpoint: settings.endpoint,
    body: JSON.stringify(body),
    timeoutSecs: Math.ceil(timeoutMs / 1000),
  })

  try {
    return JSON.parse(text)
  } catch {
    throw new Error('LM Studio returned invalid JSON.')
  }
}

async function lmStudioError(response: Response) {
  const detail = await response.text().catch(() => '')
  const compactDetail = detail.replace(/\s+/g, ' ').trim()
  return new Error(`LM Studio request failed: ${response.status} ${response.statusText}${compactDetail ? ` - ${compactDetail}` : ''}`)
}

export function canRetryWithoutNativeTools(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (isModelUnloadedError(error)) return false
  return /400|tool_choice|tool_calls|tools|function|schema|Bad Request/i.test(message)
}

export function isModelUnloadedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /model is unloaded|model unloaded|unloaded/i.test(message)
}

function readModelId(model: any) {
  const id = model?.key ?? model?.id ?? model?.model ?? model?.path ?? model?.name ?? model?.identifier
  return typeof id === 'string' ? id : ''
}

function readLoadedState(model: any) {
  if (Array.isArray(model?.loaded_instances)) return model.loaded_instances.length > 0
  return Boolean(
    model?.loaded ||
      model?.is_loaded ||
      model?.state === 'loaded' ||
      model?.status === 'loaded' ||
      model?.instance_id ||
      model?.instanceId,
  )
}

function parseModelList(data: any): LmStudioModelInfo[] {
  const rawModels = Array.isArray(data?.models) ? data.models : Array.isArray(data?.data) ? data.data : []
  return rawModels.flatMap((model: any) => {
    const id = readModelId(model)
    if (!id) return []

    const instanceId = model?.instance_id ?? model?.instanceId
    const loadedInstances = Array.isArray(model?.loaded_instances) ? model.loaded_instances : []
    const loadedInstanceId = loadedInstances
      .map((instance: any) => instance?.identifier ?? instance?.instance_id ?? instance?.instanceId ?? instance?.key)
      .find((value: unknown) => typeof value === 'string')
    const capabilities = model?.capabilities && typeof model.capabilities === 'object'
      ? Object.entries(model.capabilities)
          .filter(([, value]) => Boolean(value))
          .map(([key, value]) => (typeof value === 'object' ? key : key))
      : []
    const quantization = model?.quantization?.name ?? model?.quantization
    return [
      {
        id,
        displayName: model?.display_name ?? model?.displayName ?? id,
        loaded: readLoadedState(model),
        instanceId: typeof instanceId === 'string' ? instanceId : typeof loadedInstanceId === 'string' ? loadedInstanceId : undefined,
        publisher: typeof model?.publisher === 'string' ? model.publisher : undefined,
        architecture: typeof model?.architecture === 'string' ? model.architecture : undefined,
        quantization: typeof quantization === 'string' ? quantization : undefined,
        sizeBytes: typeof model?.size_bytes === 'number' ? model.size_bytes : undefined,
        params: typeof model?.params_string === 'string' ? model.params_string : undefined,
        maxContextLength: typeof model?.max_context_length === 'number' ? model.max_context_length : undefined,
        capabilities,
      },
    ]
  })
}

export async function listLmStudioModelInfos(settings: AppSettings): Promise<LmStudioModelInfo[]> {
  if (activeProvider(settings) === '9router') {
    const response = await fetchWithTimeout(nineRouterModelsEndpoint(settings), { method: 'GET', headers: providerHeaders(settings) }, 2500)
    if (!response.ok) throw await providerError(response, '9Router')
    return parseModelList(await response.json())
  }
  if (activeProvider(settings) === 'openrouter') {
    const response = await fetchWithTimeout(openRouterModelsEndpoint(settings), { method: 'GET', headers: providerHeaders(settings) }, 5000)
    if (!response.ok) throw await providerError(response, 'OpenRouter')
    return parseModelList(await response.json())
  }

  try {
    const text = await invokeLmStudioText('lmstudio_list_models', { endpoint: settings.endpoint })
    const models = parseModelList(JSON.parse(text))
    if (models.length > 0) return models
  } catch (error) {
    if (!isTauriInvokeUnavailable(error)) {
      // Fall through to browser fetch as a second chance; model list is non-critical.
    }
  }

  const endpoints = [nativeModelsEndpoint(settings.endpoint), modelsEndpoint(settings.endpoint)]
  for (const endpoint of endpoints) {
    const response = await fetchWithTimeout(endpoint, { method: 'GET' }, 2500).catch(() => null)
    if (!response?.ok) continue

    const data = await response.json().catch(() => null)
    const models = parseModelList(data).map((model) => endpoint === modelsEndpoint(settings.endpoint) ? { ...model, loaded: true } : model)
    if (models.length > 0) return models
  }

  return []
}

export async function listProviderModelInfos(settings: AppSettings, provider: AppSettings['modelProvider']): Promise<LmStudioModelInfo[]> {
  return listLmStudioModelInfos({ ...settings, modelProvider: provider })
}

export async function listLmStudioModels(settings: AppSettings): Promise<string[]> {
  return (await listLmStudioModelInfos(settings)).map((model) => model.id)
}

export async function resolveLmStudioModel(settings: AppSettings, preferred: string) {
  const requested = preferred.trim()
  if (!requested) return preferred

  const models = await listLmStudioModels(settings).catch(() => [])
  if (models.length === 0) return preferred

  const exact = models.find((model) => model === requested)
  if (exact) return exact

  const requestedNormalized = normalizeModelName(requested)
  const contains = models.find((model) => normalizeModelName(model).includes(requestedNormalized))
  if (contains) return contains

  const requestedParts = requested
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  const scored = models
    .map((model) => ({
      model,
      score: requestedParts.filter((part) => model.toLowerCase().includes(part)).length,
    }))
    .sort((a, b) => b.score - a.score)

  return scored[0]?.score > 0 ? scored[0].model : preferred
}

export async function loadLmStudioModel(settings: AppSettings, model: string, timeoutMs = settings.modelLoadTimeoutMs || 180000) {
  if (activeProvider(settings) === '9router' || activeProvider(settings) === 'openrouter') return { status: 'remote', model }
  const contextLength = Math.min(Math.max(settings.maxTokens || 4096, 2048), 4096)

  try {
    const text = await invokeLmStudioText('lmstudio_load_model', {
      endpoint: settings.endpoint,
      model,
      contextLength,
    })
    return JSON.parse(text)
  } catch (error) {
    if (!isTauriInvokeUnavailable(error)) throw error
  }

  let response: Response
  try {
    response = await fetchWithTimeout(
      nativeModelLoadEndpoint(settings.endpoint),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          context_length: contextLength,
          parallel: 1,
          flash_attention: true,
          offload_kv_cache_to_gpu: true,
          echo_load_config: true,
        }),
      },
      timeoutMs,
    )
  } catch (error) {
    throw lmStudioNetworkError(error, settings, `load model "${model}"`)
  }

  if (!response.ok) {
    throw await lmStudioError(response)
  }

  return response.json().catch(() => ({ status: 'loaded', instance_id: model }))
}

export async function unloadLmStudioModel(settings: AppSettings, model: string, timeoutMs = 45000) {
  if (activeProvider(settings) === '9router' || activeProvider(settings) === 'openrouter') return { status: 'remote', model }
  let response: Response
  try {
    response = await fetchWithTimeout(
      nativeModelUnloadEndpoint(settings.endpoint),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      },
      timeoutMs,
    )
  } catch (error) {
    throw lmStudioNetworkError(error, settings, `unload model "${model}"`)
  }

  if (!response.ok) {
    throw await lmStudioError(response)
  }

  return response.json().catch(() => ({ status: 'unloaded', model }))
}

export async function ensureLmStudioModelLoaded(settings: AppSettings, preferred: string) {
  const resolved = await resolveLmStudioModel(settings, preferred)
  if (!settings.autoLoadModels) return resolved

  const models = await listLmStudioModelInfos(settings).catch(() => [])
  const normalizedResolved = normalizeModelName(resolved)
  const info = models.find((model) => normalizeModelName(model.id) === normalizedResolved)
  if (info?.loaded) return resolved

  await loadLmStudioModel(settings, resolved)
  return resolved
}

export async function checkLmStudio(settings: AppSettings): Promise<LmStudioStatus> {
  if (activeProvider(settings) === '9router' || activeProvider(settings) === 'openrouter') {
    const provider = activeProvider(settings) === 'openrouter' ? 'OpenRouter' : '9Router'
    const model = providerModel(settings)
    const endpoint = activeProvider(settings) === 'openrouter' ? openRouterModelsEndpoint(settings) : nineRouterModelsEndpoint(settings)
    try {
      const response = await fetchWithTimeout(endpoint, { method: 'GET', headers: providerHeaders(settings) }, activeProvider(settings) === 'openrouter' ? 5000 : 1800)
      if (!response.ok) throw await providerError(response, provider)
      return { online: true, model, error: settings.fallbackToLmStudio ? undefined : 'LM Studio fallback disabled.' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { online: false, model, error: `${provider} unavailable at ${activeProvider(settings) === 'openrouter' ? openRouterBase(settings) : nineRouterBase(settings)}. ${settings.fallbackToLmStudio ? 'Fallback to LM Studio enabled.' : 'Fallback disabled.'} ${message}` }
    }
  }

  let serverReachable = false
  let availableModels: LmStudioModelInfo[] = []
  try {
    const text = await invokeLmStudioText('lmstudio_list_models', { endpoint: settings.endpoint })
    availableModels = parseModelList(JSON.parse(text))
    serverReachable = true
  } catch {
    // Browser fetch fallback below handles non-Tauri dev and transient IPC failures.
  }

  if (!serverReachable) {
    for (const endpoint of [nativeModelsEndpoint(settings.endpoint), modelsEndpoint(settings.endpoint)]) {
      const response = await fetchWithTimeout(endpoint, { method: 'GET' }, 1500).catch(() => null)
      if (response?.ok) {
        serverReachable = true
        try {
          availableModels = parseModelList(await response.json()).map((model) => endpoint === modelsEndpoint(settings.endpoint) ? { ...model, loaded: true } : model)
        } catch {
          availableModels = []
        }
        break
      }
    }
  }

  if (!serverReachable) {
    return {
      online: false,
      model: settings.model,
      error: `Nebula could not reach LM Studio. Make sure the local server is enabled and the endpoint is correct: ${settings.endpoint}`,
    }
  }

  if (availableModels.length === 0) {
    return { online: true, model: settings.model, error: 'LM Studio is online, but it did not report any available models.' }
  }

  const configured = availableModels.find((model) => normalizeModelName(model.id) === normalizeModelName(settings.model))
  if (!configured) {
    return { online: true, model: settings.model, error: `The configured model "${settings.model}" was not found in LM Studio.` }
  }

  if (!configured.loaded) {
    return { online: true, model: settings.model, error: `The configured model "${settings.model}" is available but unloaded.` }
  }

  return { online: true, model: configured.id }
}

export async function sendChat(settings: AppSettings, messages: ChatMessage[]) {
  const body = {
    model: providerModel(settings),
    messages: messages.map((message) => ({
      role: message.role === 'tool' ? 'system' : message.role,
      content: message.content,
    })),
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
    stream: false,
  }

  let data: any
  try {
    data = await providerChatWithFallback(settings, body, 120000, 'send a chat request')
  } catch (error) {
    if (activeProvider(settings) === 'lmstudio' && settings.autoLoadModels && isModelUnloadedError(error)) {
      const resolvedModel = await resolveLmStudioModel(settings, settings.model)
      await loadLmStudioModel(settings, resolvedModel)
      body.model = resolvedModel
      data = await providerChat(settings, body, 120000, 'send a chat request')
    } else {
      throw error
    }
  }

  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error(`${providerDisplayName(settings)} response did not contain message content.`)
  }
  return content
}
export async function sendChatWithTools(
  settings: AppSettings,
  messages: LmChatMessage[],
  tools: OpenAIToolDefinition[],
): Promise<LmChatResponse> {
  const body = {
    model: settings.model,
    messages,
    tools,
    tool_choice: 'auto',
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
    stream: false,
  }

  let data: any
  try {
    data = await providerChatWithFallback(settings, body, 120000, 'send a tool-enabled chat request')
  } catch (error) {
    if (activeProvider(settings) === 'lmstudio' && settings.autoLoadModels && isModelUnloadedError(error)) {
      const resolvedModel = await resolveLmStudioModel(settings, settings.model)
      await loadLmStudioModel(settings, resolvedModel)
      body.model = resolvedModel
      data = await providerChat(settings, body, 120000, 'send a tool-enabled chat request')
    } else {
      throw error
    }
  }

  const responseMessage = data?.choices?.[0]?.message
  const content = typeof responseMessage?.content === 'string' ? responseMessage.content : ''
  const rawToolCalls = Array.isArray(responseMessage?.tool_calls) ? responseMessage.tool_calls : []

  const toolCalls = rawToolCalls.flatMap((call: any): LmToolCall[] => {
    const name = call?.function?.name
    const rawArgs = call?.function?.arguments ?? '{}'
    if (typeof name !== 'string') return []

    try {
      const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : rawArgs
      return [
        {
          id: typeof call?.id === 'string' ? call.id : crypto.randomUUID(),
          name,
          args: typeof args === 'object' && args !== null ? args : {},
        },
      ]
    } catch {
      return [
        {
          id: typeof call?.id === 'string' ? call.id : crypto.randomUUID(),
          name,
          args: {},
        },
      ]
    }
  })

  return { content, toolCalls, rawMessage: responseMessage }
}
export async function sendLmChatWithoutTools(
  settings: AppSettings,
  messages: LmChatMessage[],
): Promise<LmChatResponse> {
  const sanitizedMessages = messages.map((message) => ({
    role: message.role === 'tool' ? 'system' : message.role,
    content:
      message.role === 'tool'
        ? `Tool result for ${message.name ?? 'tool'}: ${message.content}`
        : message.content,
  }))

  const body = {
    model: settings.model,
    messages: sanitizedMessages,
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
    stream: false,
  }

  let data: any
  try {
    data = await providerChatWithFallback(settings, body, 120000, 'send a non-tool chat request')
  } catch (error) {
    if (activeProvider(settings) === 'lmstudio' && settings.autoLoadModels && isModelUnloadedError(error)) {
      const resolvedModel = await resolveLmStudioModel(settings, settings.model)
      await loadLmStudioModel(settings, resolvedModel)
      body.model = resolvedModel
      data = await providerChat(settings, body, 120000, 'send a non-tool chat request')
    } else {
      throw error
    }
  }

  const responseMessage = data?.choices?.[0]?.message
  const content = typeof responseMessage?.content === 'string' ? responseMessage.content : ''
  return { content, toolCalls: [], rawMessage: responseMessage }
}
export async function streamChat(
  settings: AppSettings,
  messages: ChatMessage[],
  onToken: (token: string) => void,
) {
  const streamBody = {
    model: providerModel(settings),
    messages: messages.map((message) => ({
      role: message.role === 'tool' ? 'system' : message.role,
      content: message.content,
    })),
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
    stream: true,
  }

  const streamEndpoint =
    activeProvider(settings) === '9router'
      ? nineRouterChatEndpoint(settings)
      : activeProvider(settings) === 'openrouter'
        ? openRouterChatEndpoint(settings)
        : settings.endpoint

  async function requestStream(body: Record<string, unknown>) {
    return fetchWithTimeout(
      streamEndpoint,
      {
        method: 'POST',
        headers: providerHeaders(settings),
        body: JSON.stringify(body),
      },
      120000,
    )
  }

  let response: Response
  try {
    response = await requestStream(streamBody)
  } catch {
    // Some Tauri/LM Studio combinations do not expose browser streaming. The normal IPC path remains a reliable fallback.
    const content = await sendChat(settings, messages)
    onToken(content)
    return content
  }

  if (!response.ok) {
    const error = await providerError(response, providerDisplayName(settings))
    if (activeProvider(settings) === 'lmstudio' && settings.autoLoadModels && isModelUnloadedError(error)) {
      const resolvedModel = await resolveLmStudioModel(settings, settings.model)
      await loadLmStudioModel(settings, resolvedModel)
      streamBody.model = resolvedModel
      try {
        response = await requestStream(streamBody)
      } catch {
        const content = await sendChat({ ...settings, model: resolvedModel }, messages)
        onToken(content)
        return content
      }
    }
  }

  if (!response.ok || !response.body) {
    const content = await sendChat(settings, messages)
    onToken(content)
    return content
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  let pending = ''

  function consumeLine(line: string) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:') || trimmed === 'data: [DONE]') return
    try {
      const json = JSON.parse(trimmed.slice(5).trim())
      const token = json?.choices?.[0]?.delta?.content
      if (typeof token === 'string' && token) {
        full += token
        onToken(token)
      }
    } catch {
      // A malformed server-sent event is ignored; later chunks can still complete the response.
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    pending += decoder.decode(value ?? new Uint8Array(), { stream: !done })
    const lines = pending.split(/\r?\n/)
    pending = done ? '' : lines.pop() ?? ''
    for (const line of lines) consumeLine(line)
    if (done) break
  }
  if (pending) consumeLine(pending)

  if (!full) {
    const content = await sendChat(settings, messages)
    onToken(content)
    return content
  }
  return full
}
