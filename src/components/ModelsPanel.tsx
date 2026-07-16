import { Cpu, Flame, RefreshCw, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { listLmStudioModelInfos } from '../lib/lmstudio'
import { ensureModelReady, type ModelRole } from '../lib/modelManager'
import { getModelRunStats } from '../lib/modelStats'
import { notify } from '../lib/notifications'
import { getModelRouteRecommendations } from '../lib/routeRecommendations'
import type { ModelInfo } from '../types/nebula'
import type { AppSettings } from '../types/settings'
import type { LogEvent } from '../types/agent'

interface Props {
  settings: AppSettings
  onChange: (settings: AppSettings) => void
  onLog: (type: LogEvent['type'], message: string, details?: unknown) => void
}

function formatBytes(value?: number) {
  if (!value) return 'unknown size'
  const gb = value / 1024 / 1024 / 1024
  return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`
}

function assignedRole(settings: AppSettings, model: string) {
  if (settings.modelAssignments?.daily === model || settings.fastModel === model) return 'daily'
  if (settings.modelAssignments?.code === model || settings.codeModel === model) return 'code'
  if (settings.modelAssignments?.review === model || settings.reviewModel === model) return 'review'
  return ''
}

function providerLabel(settings: AppSettings) {
  if (settings.modelProvider === '9router') return '9Router'
  if (settings.modelProvider === 'openrouter') return 'OpenRouter'
  return 'LM Studio'
}

export function ModelsPanel({ settings, onChange, onLog }: Props) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [busyModel, setBusyModel] = useState('')
  const stats = useMemo(() => getModelRunStats(), [models, busyModel])
  const recommendations = useMemo(() => getModelRouteRecommendations(settings), [settings, models, busyModel])

  async function refresh() {
    setLoading(true)
    try {
      const next = await listLmStudioModelInfos(settings)
      setModels(next)
      onLog('status', `${providerLabel(settings)} model dashboard refreshed: ${next.length} models.`)
    } catch (error) {
      onLog('error', `Model refresh failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  async function load(model: string, role: ModelRole = 'daily') {
    setBusyModel(model)
    try {
      await ensureModelReady(settings, role, model)
      onLog('status', `${settings.modelProvider === 'lmstudio' ? 'Loaded LM Studio' : `Selected ${providerLabel(settings)}`} model: ${model}`)
      await notify({ type: 'model_loaded', title: 'Model loaded', message: model })
      await refresh()
    } catch (error) {
      onLog('error', `Model load failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusyModel('')
    }
  }

  function assign(model: string, role: 'daily' | 'code' | 'review') {
    const modelAssignments = { ...settings.modelAssignments, [role]: model }
    onChange({
      ...settings,
      modelAssignments,
      nineRouterModel: settings.modelProvider === '9router' ? model : settings.nineRouterModel,
      openRouterModel: settings.modelProvider === 'openrouter' ? model : settings.openRouterModel,
      fastModel: role === 'daily' ? model : settings.fastModel,
      codeModel: role === 'code' ? model : settings.codeModel,
      reviewModel: role === 'review' ? model : settings.reviewModel,
      model: settings.modelProvider !== 'lmstudio' || role === 'code' ? model : settings.model,
    })
    onLog('status', `Assigned ${model} as ${settings.modelProvider === 'lmstudio' ? role : providerLabel(settings)} model.`)
  }

  useEffect(() => {
    void refresh()
  }, [settings.endpoint, settings.modelProvider, settings.nineRouterBaseUrl, settings.nineRouterApiKey, settings.openRouterBaseUrl, settings.openRouterApiKey])

  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="flex gap-2">
        <button className="nebula-button-primary flex flex-1 items-center justify-center gap-2 px-3 py-2" type="button" onClick={refresh}>
          <RefreshCw size={13} />
          {loading ? 'Refreshing...' : 'Refresh Provider Models'}
        </button>
        <button className="nebula-button-primary flex flex-1 items-center justify-center gap-2 px-3 py-2" type="button" onClick={() => load(settings.modelAssignments?.daily || settings.fastModel, 'daily')}>
          <Flame size={13} />
          Warm Daily
        </button>
      </div>

      {recommendations.length > 0 && (
        <section className="rounded-md border border-fuchsia-300/25 bg-fuchsia-300/10 p-3">
          <div className="mb-2 text-sm font-semibold text-fuchsia-50">Routing Recommendations</div>
          <div className="space-y-2">
            {recommendations.map((recommendation) => (
              <div key={recommendation.id} className="rounded-md border border-white/10 bg-black/20 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-100">
                      Use {recommendation.recommendedModel} for {recommendation.role}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      Current: {recommendation.currentModel || 'unset'} - confidence {recommendation.confidence}%
                    </div>
                  </div>
                  <button className="nebula-toggle shrink-0 px-2 py-1 text-[11px]" type="button" onClick={() => assign(recommendation.recommendedModel, recommendation.role)}>
                    Apply
                  </button>
                </div>
                <ul className="mt-2 space-y-1 text-[11px] leading-4 text-slate-400">
                  {recommendation.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="space-y-3">
        {models.map((model) => {
          const role = assignedRole(settings, model.id)
          const stat = stats[model.id]
          return (
            <section key={model.id} className="skill-card rounded-md border border-slate-800 bg-slate-950 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Cpu size={14} className={model.loaded ? 'text-emerald-300' : 'text-slate-500'} />
                    <h3 className="break-words text-sm font-semibold text-slate-100">{model.displayName || model.id}</h3>
                  </div>
                  <div className="terminal-font mt-1 break-all text-[11px] text-slate-500">{model.id}</div>
                </div>
                <span className={`rounded-md border px-2 py-0.5 text-[11px] ${model.loaded ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-slate-700 bg-slate-800/50 text-slate-400'}`}>
                  {model.loaded ? 'loaded' : 'unloaded'}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                <span>{model.params ?? 'unknown params'}</span>
                <span>{formatBytes(model.sizeBytes)}</span>
                <span>{model.quantization ?? 'unknown quant'}</span>
                <span>{model.maxContextLength ? `${model.maxContextLength.toLocaleString()} ctx` : 'ctx unknown'}</span>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {role && <span className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 text-[11px] text-cyan-100">{role}</span>}
                {model.capabilities.slice(0, 4).map((capability) => (
                  <span key={capability} className="rounded-md bg-slate-800 px-2 py-1 text-[11px] text-slate-300">{capability}</span>
                ))}
              </div>

              <div className="mt-3 rounded-md border border-white/10 bg-white/[0.03] p-2 text-[11px] text-slate-400">
                {stat ? (
                  <>
                    <div>Last: {stat.lastResponseMs ? `${Math.round(stat.lastResponseMs)} ms` : 'n/a'} {stat.roughTokensPerSecond ? `- ${stat.roughTokensPerSecond} tok/s rough` : ''}</div>
                    {stat.lastFirstTokenMs && <div>First token: {Math.round(stat.lastFirstTokenMs)} ms</div>}
                    {stat.lastLoadMs && <div>Load: {Math.round(stat.lastLoadMs)} ms</div>}
                    {stat.lastUnloadMs && <div>Unload: {Math.round(stat.lastUnloadMs)} ms</div>}
                    {stat.loadedModelCount !== undefined && <div>Loaded models: {stat.loadedModelCount} {stat.supportsMultipleLoadedModels ? '(multi)' : ''}</div>}
                    {stat.approxJsHeapMb && <div>UI heap: {stat.approxJsHeapMb} MB</div>}
                    {stat.lastFallback && <div className="mt-1 text-amber-200">Fallback: {stat.lastFallback}</div>}
                    {stat.lastError && <div className="mt-1 text-red-200">Error: {stat.lastError}</div>}
                  </>
                ) : (
                  'No local Nebula run stats yet.'
                )}
              </div>

              <div className="mt-3 grid grid-cols-4 gap-1.5">
                <button className="nebula-toggle px-2 py-2" type="button" disabled={busyModel === model.id} onClick={() => load(model.id, (role || 'daily') as ModelRole)}>
                  <Zap size={12} className="mx-auto" />
                </button>
                <button className="nebula-toggle px-2 py-2" type="button" onClick={() => assign(model.id, 'daily')}>Daily</button>
                <button className="nebula-toggle px-2 py-2" type="button" onClick={() => assign(model.id, 'code')}>Code</button>
                <button className="nebula-toggle px-2 py-2" type="button" onClick={() => assign(model.id, 'review')}>Review</button>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
