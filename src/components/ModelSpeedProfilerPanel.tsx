import { Gauge, Play, RotateCcw, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getModelSpeedProfiles, modelForProfileRole, runModelSpeedProfile } from '../lib/modelSpeedProfiler'
import { getModelRouteRecommendations } from '../lib/routeRecommendations'
import type { LogEvent } from '../types/agent'
import type { ModelSpeedProfileResult } from '../types/nebula'
import type { AppSettings } from '../types/settings'

const roles: ModelSpeedProfileResult['role'][] = ['daily', 'code', 'review']

function formatMs(value?: number) {
  if (value === undefined) return 'n/a'
  return `${Math.round(value)} ms`
}

export function ModelSpeedProfilerPanel({
  settings,
  onLog,
}: {
  settings: AppSettings
  onLog: (type: LogEvent['type'], message: string, details?: unknown) => void
}) {
  const [profiles, setProfiles] = useState<ModelSpeedProfileResult[]>(() => getModelSpeedProfiles())
  const [runningRole, setRunningRole] = useState('')
  const recommendations = useMemo(() => getModelRouteRecommendations(settings), [settings, profiles])

  function refresh() {
    setProfiles(getModelSpeedProfiles())
  }

  async function run(role: ModelSpeedProfileResult['role']) {
    setRunningRole(role)
    const result = await runModelSpeedProfile(settings, role)
    refresh()
    onLog(result.ok ? 'status' : 'error', result.ok ? `Model profiler finished for ${role}.` : `Model profiler failed for ${role}: ${result.error}`, result)
    setRunningRole('')
  }

  async function runAll() {
    for (const role of roles) {
      await run(role)
    }
  }

  useEffect(() => {
    const onChange = () => refresh()
    window.addEventListener('nebula-model-profiler-changed', onChange)
    return () => window.removeEventListener('nebula-model-profiler-changed', onChange)
  }, [])

  return (
    <div className="model-profiler-panel space-y-3 p-3 text-xs">
      <section className="model-profiler-hero">
        <Gauge size={18} />
        <div>
          <h2>Model Speed Profiler</h2>
          <p>Measure local response latency for daily, code, and review routes. Results stay on this PC.</p>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-2">
        {roles.map((role) => {
          const model = modelForProfileRole(settings, role)
          const latest = profiles.find((profile) => profile.role === role && profile.model === model)
          return (
            <section key={role} className="model-profiler-card">
              <div className="flex items-center gap-2">
                <Zap size={14} />
                <strong>{role}</strong>
              </div>
              <p className="terminal-font break-all">{model || 'No model assigned'}</p>
              <div className="model-profiler-metrics">
                <span>Total {formatMs(latest?.totalMs)}</span>
                <span>First {formatMs(latest?.firstTokenMs)}</span>
                <span>{latest?.roughTokensPerSecond ? `${latest.roughTokensPerSecond} tok/s` : 'tok/s n/a'}</span>
              </div>
              {latest?.error && <p className="model-profiler-error">{latest.error}</p>}
              <button type="button" onClick={() => void run(role)} disabled={Boolean(runningRole) || !model}>
                <Play size={12} />
                {runningRole === role ? 'Profiling...' : 'Profile'}
              </button>
            </section>
          )
        })}
      </div>

      <button type="button" className="nebula-button-primary flex w-full items-center justify-center gap-2 px-3 py-2" onClick={() => void runAll()} disabled={Boolean(runningRole)}>
        <RotateCcw size={13} />
        Profile all assigned models
      </button>

      {recommendations.length > 0 && (
        <section className="model-profiler-recommendations">
          <h3>Routing recommendations</h3>
          {recommendations.map((recommendation) => (
            <article key={recommendation.id}>
              <strong>{recommendation.role}: {recommendation.recommendedModel}</strong>
              <p>Current: {recommendation.currentModel || 'unset'} | confidence {recommendation.confidence}%</p>
            </article>
          ))}
        </section>
      )}

      <section className="space-y-2">
        {profiles.map((profile) => (
          <article key={profile.id} className={`model-profiler-result ${profile.ok ? 'model-profiler-ok' : 'model-profiler-fail'}`}>
            <div className="flex items-center justify-between gap-2">
              <strong>{profile.role}</strong>
              <span>{formatMs(profile.totalMs)}</span>
            </div>
            <p className="terminal-font break-all">{profile.model}</p>
            <p>{profile.error || profile.outputPreview}</p>
          </article>
        ))}
      </section>
    </div>
  )
}
