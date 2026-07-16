import { Activity, Boxes, Gauge, RefreshCw, Stethoscope } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { listProviderModelInfos } from '../lib/lmstudio'
import { getModelRunStats } from '../lib/modelStats'
import type { LogEvent } from '../types/agent'
import type { ModelInfo, ModelRuntimeState } from '../types/nebula'
import type { AppSettings } from '../types/settings'
import { ModelDoctorPanel } from './ModelDoctorPanel'
import { ModelsPanel } from './ModelsPanel'
import { ModelSpeedProfilerPanel } from './ModelSpeedProfilerPanel'

type View = 'overview' | 'models' | 'doctor' | 'speed'

interface Props {
  settings: AppSettings
  onChange: (settings: AppSettings) => void
  onLog: (type: LogEvent['type'], message: string, details?: unknown) => void
  initialView?: View
}

const roleLabels = { daily: 'Daily chat', code: 'Coding', review: 'Review' } as const

function modelMatches(info: ModelInfo, model: string) {
  const id = info.id.toLowerCase()
  const requested = model.toLowerCase()
  return id === requested || id.includes(requested) || requested.includes(id)
}

export function ModelControlCenter({ settings, onChange, onLog, initialView = 'overview' }: Props) {
  const [view, setView] = useState<View>(initialView)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setModels(await listProviderModelInfos(settings, settings.modelProvider))
    } catch (refreshError) {
      setModels([])
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError))
    } finally {
      setLoading(false)
    }
  }, [settings])

  useEffect(() => {
    void refresh()
    const handler = () => void refresh()
    window.addEventListener('nebula-model-manager', handler)
    return () => window.removeEventListener('nebula-model-manager', handler)
  }, [refresh])

  const runtimeStates = useMemo(() => {
    const stats = getModelRunStats()
    const assignments = {
      daily: settings.modelAssignments.daily || settings.fastModel || settings.model,
      code: settings.modelAssignments.code || settings.codeModel,
      review: settings.modelAssignments.review || settings.reviewModel,
    }
    return (Object.entries(assignments) as Array<[ModelRuntimeState['role'], string]>).map(([role, model]) => {
      const listed = models.find((info) => modelMatches(info, model))
      const stat = stats[model]
      const remote = settings.modelProvider !== 'lmstudio'
      return {
        role,
        model,
        phase: error ? 'error' : loading ? 'checking' : remote || listed?.loaded ? 'ready' : listed ? 'unloaded' : 'error',
        loaded: remote || Boolean(listed?.loaded),
        remote,
        lastLoadMs: stat?.lastLoadMs,
        lastFirstTokenMs: stat?.lastFirstTokenMs,
        lastResponseMs: stat?.lastResponseMs,
        lastError: stat?.lastError || (!listed && !remote && !loading ? 'Model not found in LM Studio inventory.' : undefined),
        updatedAt: stat?.updatedAt || new Date().toISOString(),
      } satisfies ModelRuntimeState
    })
  }, [error, loading, models, settings])

  return (
    <div className="model-control-center text-xs">
      <header className="model-control-header">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100"><Boxes size={16} />Model Control</div>
          <p>Assignments, health, loading, and speed in one place.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh model state"><RefreshCw className={loading ? 'animate-spin' : ''} size={14} /></button>
      </header>
      <nav className="model-control-tabs" aria-label="Model Control sections">
        <Tab active={view === 'overview'} onClick={() => setView('overview')} icon={<Activity size={13} />} label="Overview" />
        <Tab active={view === 'models'} onClick={() => setView('models')} icon={<Boxes size={13} />} label="Assignments" />
        <Tab active={view === 'doctor'} onClick={() => setView('doctor')} icon={<Stethoscope size={13} />} label="Doctor" />
        <Tab active={view === 'speed'} onClick={() => setView('speed')} icon={<Gauge size={13} />} label="Speed" />
      </nav>
      {view === 'overview' && (
        <div className="space-y-2 p-3">
          {error && <div className="nebula-inline-error">{error}</div>}
          {runtimeStates.map((state) => (
            <article key={state.role} className="model-runtime-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><strong>{roleLabels[state.role]}</strong><p className="terminal-font truncate">{state.model || 'Not assigned'}</p></div>
                <span className={`model-runtime-phase model-runtime-${state.phase}`}>{state.phase}</span>
              </div>
              <div className="model-runtime-metrics">
                <span>Load {state.lastLoadMs ? `${Math.round(state.lastLoadMs)} ms` : 'n/a'}</span>
                <span>First token {state.lastFirstTokenMs ? `${Math.round(state.lastFirstTokenMs)} ms` : 'n/a'}</span>
                <span>Total {state.lastResponseMs ? `${Math.round(state.lastResponseMs)} ms` : 'n/a'}</span>
              </div>
              {state.lastError && <p className="model-runtime-error">{state.lastError}</p>}
            </article>
          ))}
          <div className="nebula-note">Daily stays warm when resources allow. Coding preloads from intent. Review remains lazy and falls back deterministically.</div>
        </div>
      )}
      {view === 'models' && <ModelsPanel settings={settings} onChange={onChange} onLog={onLog} />}
      {view === 'doctor' && <ModelDoctorPanel settings={settings} onChange={onChange} onLog={onLog} />}
      {view === 'speed' && <ModelSpeedProfilerPanel settings={settings} onLog={onLog} />}
    </div>
  )
}

function Tab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button type="button" className={active ? 'active' : ''} onClick={onClick}>{icon}{label}</button>
}
