import type { ModelMode } from '../types/settings'
import type { AppSettings } from '../types/settings'
import {
  listLmStudioModelInfos,
  loadLmStudioModel,
  resolveLmStudioModel,
  unloadLmStudioModel,
} from './lmstudio'
import { recordModelFallback, recordModelLoadMetric } from './modelStats'
import { throwIfRunCancelled } from './agentRun'

export type ModelRole = 'daily' | 'code' | 'review'
export type ModelLifecycleState = 'idle' | 'checking' | 'loading' | 'ready' | 'unloading' | 'error'

export interface ModelReadyResult {
  requestedModel: string
  resolvedModel: string
  role: ModelRole
  loaded: boolean
  fallbackUsed?: string
  loadMs?: number
  loadedModelCount?: number
  supportsMultipleLoadedModels?: boolean
}

export interface ModelManagerEvent {
  state: ModelLifecycleState | 'switching' | 'preloading'
  role: ModelRole
  model: string
  message: string
  background?: boolean
}

const READY_CACHE_MS = 20000
const loadedCache = new Map<string, { loaded: boolean; checkedAt: number }>()
const loadPromises = new Map<string, Promise<ModelReadyResult>>()
const idleTimers = new Map<string, number>()
let operationQueue: Promise<unknown> = Promise.resolve()

function now() {
  return performance.now()
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function queueOperation<T>(operation: () => Promise<T>) {
  const next = operationQueue.then(operation, operation)
  operationQueue = next.catch(() => undefined)
  return next
}

function emitModelEvent(event: ModelManagerEvent) {
  window.dispatchEvent(new CustomEvent('nebula-model-manager', { detail: event }))
}

function roleFallbackModel(settings: AppSettings, role: ModelRole) {
  if (settings.singleModelEnabled) return settings.singleModel || settings.model
  if (role === 'daily') return settings.modelAssignments?.daily || settings.fastModel || settings.model
  if (role === 'code') return settings.modelAssignments?.code || settings.codeModel || settings.modelAssignments?.daily || settings.fastModel || settings.model
  return settings.modelAssignments?.review || settings.reviewModel || settings.modelAssignments?.code || settings.codeModel || settings.model
}

export function modelModeToRole(mode: ModelMode): ModelRole {
  if (mode === 'review') return 'review'
  if (mode === 'code') return 'code'
  return 'daily'
}

function isRemoteProvider(settings: AppSettings) {
  return settings.modelProvider === '9router' || settings.modelProvider === 'openrouter'
}

function remoteProviderModel(settings: AppSettings) {
  if (settings.modelProvider === '9router') return settings.nineRouterModel
  if (settings.modelProvider === 'openrouter') return settings.openRouterModel
  return ''
}

async function currentLoadedInfo(settings: AppSettings) {
  const models = await listLmStudioModelInfos(settings).catch(() => [])
  const loaded = models.filter((model) => model.loaded)
  return {
    models,
    loadedModelCount: loaded.length,
    supportsMultipleLoadedModels: loaded.length > 1,
  }
}

function cacheLoaded(model: string, loaded: boolean) {
  loadedCache.set(normalize(model), { loaded, checkedAt: Date.now() })
}

function getCachedLoaded(model: string) {
  const cached = loadedCache.get(normalize(model))
  if (!cached || Date.now() - cached.checkedAt > READY_CACHE_MS) return null
  return cached.loaded
}

export async function resolveRoleModel(settings: AppSettings, role: ModelRole) {
  const remoteModel = remoteProviderModel(settings)
  if (isRemoteProvider(settings) && remoteModel) return remoteModel
  return resolveLmStudioModel(settings, roleFallbackModel(settings, role))
}

export function resolveReportedModel<T extends { id: string }>(requestedModel: string, models: T[]) {
  if (models.length === 0) return requestedModel
  const requested = normalize(requestedModel)
  if (!requested) return requestedModel

  const exact = models.find((model) => normalize(model.id) === requested)
  if (exact) return exact.id

  const contains = models.find((model) => {
    const candidate = normalize(model.id)
    return candidate.includes(requested) || requested.includes(candidate)
  })
  if (contains) return contains.id

  const parts = requestedModel.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const scored = models
    .map((model) => ({
      id: model.id,
      score: parts.filter((part) => model.id.toLowerCase().includes(part)).length,
    }))
    .sort((left, right) => right.score - left.score)
  return scored[0]?.score ? scored[0].id : requestedModel
}

async function resolveFallbackModel(settings: AppSettings, role: ModelRole, failedModel: string) {
  if (settings.singleModelEnabled) return ''
  const info = await currentLoadedInfo(settings)
  const preferred = role === 'review'
    ? [settings.modelAssignments?.code, settings.codeModel, settings.modelAssignments?.daily, settings.fastModel, settings.model]
    : role === 'code'
      ? [settings.modelAssignments?.daily, settings.fastModel, settings.model, settings.modelAssignments?.review, settings.reviewModel]
      : [settings.modelAssignments?.daily, settings.fastModel, settings.model, settings.modelAssignments?.code, settings.codeModel]
  const candidates = preferred.filter((model): model is string => Boolean(model && normalize(model) !== normalize(failedModel)))
  const matching = (model: string) => info.models.find((item) => normalize(item.id) === normalize(model) || normalize(item.id).includes(normalize(model)) || normalize(model).includes(normalize(item.id)))
  for (const candidate of candidates) {
    const model = matching(candidate)
    if (model?.loaded) return model.id
  }
  const anyLoaded = info.models.find((model) => model.loaded && normalize(model.id) !== normalize(failedModel))
  if (anyLoaded) return anyLoaded.id
  for (const candidate of candidates) {
    const model = matching(candidate)
    if (model) return model.id
  }
  return ''
}

export function warmModelInBackground(settings: AppSettings, role: ModelRole, reason: string) {
  if (isRemoteProvider(settings)) return
  if (!settings.autoLoadModels) return
  const requestedModel = roleFallbackModel(settings, role)
  if (!requestedModel) return

  void ensureModelReady(settings, role, requestedModel, { background: true, reason }).catch(() => undefined)
}

export function scheduleHeavyModelIdleUnload(settings: AppSettings, role: ModelRole, model: string) {
  if (isRemoteProvider(settings)) return
  if (settings.singleModelEnabled || role === 'daily' || settings.heavyModelIdleUnloadMs <= 0) return
  const key = normalize(model)
  const previous = idleTimers.get(key)
  if (previous) window.clearTimeout(previous)

  const timer = window.setTimeout(() => {
    void queueOperation(async () => {
      emitModelEvent({ state: 'unloading', role, model, message: `Idle unload requested for ${role} model: ${model}` })
      const started = now()
      try {
        await unloadLmStudioModel(settings, model)
        const unloadMs = now() - started
        cacheLoaded(model, false)
        recordModelLoadMetric(model, { role, lastUnloadMs: unloadMs })
        emitModelEvent({ state: 'idle', role, model, message: `Idle model unloaded: ${model}` })
      } catch (error) {
        recordModelLoadMetric(model, {
          role,
          lastError: `Idle unload unsupported or failed: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    })
  }, settings.heavyModelIdleUnloadMs)

  idleTimers.set(key, timer)
}

export async function ensureModelReady(
  settings: AppSettings,
  role: ModelRole,
  requestedModel = roleFallbackModel(settings, role),
  options: { background?: boolean; reason?: string; signal?: AbortSignal } = {},
): Promise<ModelReadyResult> {
  throwIfRunCancelled(options.signal)
  if (isRemoteProvider(settings)) {
    const resolvedModel = remoteProviderModel(settings) || requestedModel
    emitModelEvent({
      state: 'ready',
      role,
      model: resolvedModel,
      message: `${settings.modelProvider === 'openrouter' ? 'OpenRouter' : '9Router'} route ready: ${resolvedModel}`,
      background: options.background,
    })
    return {
      requestedModel,
      resolvedModel,
      role,
      loaded: true,
    }
  }

  const cachedRequested = getCachedLoaded(requestedModel)
  if (cachedRequested === true) {
    emitModelEvent({ state: 'ready', role, model: requestedModel, message: `${role} model ready from warm cache: ${requestedModel}`, background: options.background })
    return { requestedModel, resolvedModel: requestedModel, role, loaded: true }
  }

  // Loaded models must never wait behind a background load/unload operation.
  const preflight = await currentLoadedInfo(settings)
  throwIfRunCancelled(options.signal)
  const resolvedModel = resolveReportedModel(requestedModel, preflight.models)
  const reportedModel = preflight.models.find((model) => normalize(model.id) === normalize(resolvedModel))
  if (reportedModel?.loaded) {
    cacheLoaded(resolvedModel, true)
    recordModelLoadMetric(resolvedModel, {
      role,
      loadedModelCount: preflight.loadedModelCount,
      supportsMultipleLoadedModels: preflight.supportsMultipleLoadedModels,
    })
    emitModelEvent({ state: 'ready', role, model: resolvedModel, message: `${role} model already loaded: ${resolvedModel}`, background: options.background })
    return {
      requestedModel,
      resolvedModel,
      role,
      loaded: true,
      loadedModelCount: preflight.loadedModelCount,
      supportsMultipleLoadedModels: preflight.supportsMultipleLoadedModels,
    }
  }

  const promiseKey = `${role}:${normalize(resolvedModel)}`
  const existing = loadPromises.get(promiseKey)
  if (existing) return existing

  const promise = queueOperation(async (): Promise<ModelReadyResult> => {
    throwIfRunCancelled(options.signal)
    emitModelEvent({
      state: options.background ? 'preloading' : 'checking',
      role,
      model: resolvedModel,
      message: `${options.background ? 'Preloading' : 'Checking'} ${role} model: ${resolvedModel}`,
      background: options.background,
    })

    const cachedLoaded = getCachedLoaded(resolvedModel)

    if (cachedLoaded !== true) {
      const info = await currentLoadedInfo(settings)
      throwIfRunCancelled(options.signal)
      const modelInfo = info.models.find((model) => normalize(model.id) === normalize(resolvedModel))
      if (modelInfo?.loaded) {
        cacheLoaded(resolvedModel, true)
        recordModelLoadMetric(resolvedModel, {
          role,
          loadedModelCount: info.loadedModelCount,
          supportsMultipleLoadedModels: info.supportsMultipleLoadedModels,
        })
        emitModelEvent({ state: 'ready', role, model: resolvedModel, message: `${role} model already loaded: ${resolvedModel}`, background: options.background })
        return {
          requestedModel,
          resolvedModel,
          role,
          loaded: true,
          loadedModelCount: info.loadedModelCount,
          supportsMultipleLoadedModels: info.supportsMultipleLoadedModels,
        }
      }
    }

    if (cachedLoaded === true) {
      emitModelEvent({ state: 'ready', role, model: resolvedModel, message: `${role} model ready from warm cache: ${resolvedModel}`, background: options.background })
      return {
        requestedModel,
        resolvedModel,
        role,
        loaded: true,
      }
    }

    if (!settings.autoLoadModels) {
      emitModelEvent({ state: 'ready', role, model: resolvedModel, message: `Auto-load disabled. Using requested model: ${resolvedModel}`, background: options.background })
      return { requestedModel, resolvedModel, role, loaded: false }
    }

    emitModelEvent({
      state: options.background ? 'preloading' : 'loading',
      role,
      model: resolvedModel,
      message: `${options.background ? 'Preloading' : 'Loading'} ${role} model: ${resolvedModel}`,
      background: options.background,
    })
    const started = now()
    try {
      await loadLmStudioModel(settings, resolvedModel, settings.modelLoadTimeoutMs || 180000)
      throwIfRunCancelled(options.signal)
      const loadMs = now() - started
      cacheLoaded(resolvedModel, true)
      const info = await currentLoadedInfo(settings)
      recordModelLoadMetric(resolvedModel, {
        role,
        lastLoadMs: loadMs,
        loadedModelCount: info.loadedModelCount,
        supportsMultipleLoadedModels: info.supportsMultipleLoadedModels,
      })
      emitModelEvent({ state: 'ready', role, model: resolvedModel, message: `${role} model ready in ${Math.round(loadMs)} ms: ${resolvedModel}`, background: options.background })
      scheduleHeavyModelIdleUnload(settings, role, resolvedModel)
      return {
        requestedModel,
        resolvedModel,
        role,
        loaded: true,
        loadMs,
        loadedModelCount: info.loadedModelCount,
        supportsMultipleLoadedModels: info.supportsMultipleLoadedModels,
      }
    } catch (error) {
      const fallback = await resolveFallbackModel(settings, role, resolvedModel)
      throwIfRunCancelled(options.signal)
      const reason = error instanceof Error ? error.message : String(error)
      recordModelLoadMetric(resolvedModel, { role, lastError: reason })
      if (!fallback) {
        emitModelEvent({ state: 'error', role, model: resolvedModel, message: `${role} model failed and no usable fallback is installed.`, background: options.background })
        throw new Error(`${role} model "${resolvedModel}" could not load, and Nebula found no different installed fallback. ${reason}`, { cause: error })
      }
      recordModelFallback(resolvedModel, fallback, reason)
      emitModelEvent({
        state: 'switching',
        role,
        model: fallback,
        message: `${role} model failed. Falling back to ${fallback}`,
        background: options.background,
      })

      if (fallback !== resolvedModel && settings.autoLoadModels) {
        try {
          await loadLmStudioModel(settings, fallback, settings.modelLoadTimeoutMs || 180000)
          throwIfRunCancelled(options.signal)
          cacheLoaded(fallback, true)
          emitModelEvent({ state: 'ready', role, model: fallback, message: `Fallback model ready: ${fallback}`, background: options.background })
        } catch (fallbackError) {
          const fallbackReason = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          recordModelLoadMetric(fallback, { role, lastError: fallbackReason })
          emitModelEvent({ state: 'error', role, model: fallback, message: `Fallback model also failed: ${fallback}`, background: options.background })
          throw new Error(`${role} model "${resolvedModel}" failed, then fallback "${fallback}" also failed. ${fallbackReason}`, { cause: fallbackError })
        }
      }

      return {
        requestedModel,
        resolvedModel: fallback || resolvedModel,
        role,
        loaded: true,
        fallbackUsed: fallback,
      }
    }
  }).finally(() => {
    loadPromises.delete(promiseKey)
  })

  loadPromises.set(promiseKey, promise)
  return promise
}
