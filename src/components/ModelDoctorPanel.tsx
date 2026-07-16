import { AlertTriangle, CheckCircle2, RefreshCw, Stethoscope, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { loadLmStudioModel } from '../lib/lmstudio'
import { runModelDoctor } from '../lib/modelDoctor'
import type { LogEvent } from '../types/agent'
import type { ModelDoctorCheck } from '../types/nebula'
import type { AppSettings } from '../types/settings'

interface Props {
  settings: AppSettings
  onChange: (settings: AppSettings) => void
  onLog: (type: LogEvent['type'], message: string, details?: unknown) => void
}

function statusIcon(status: ModelDoctorCheck['status']) {
  if (status === 'success') return <CheckCircle2 size={15} />
  if (status === 'warning') return <AlertTriangle size={15} />
  return <XCircle size={15} />
}

export function ModelDoctorPanel({ settings, onChange, onLog }: Props) {
  const [checks, setChecks] = useState<ModelDoctorCheck[]>([])
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState('')

  async function refresh() {
    setRunning(true)
    try {
      const next = await runModelDoctor(settings)
      setChecks(next)
      onLog('status', `Model Doctor completed: ${next.filter((check) => check.status === 'error').length} errors, ${next.filter((check) => check.status === 'warning').length} warnings.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setChecks([{ id: 'doctor-error', title: 'Model Doctor failed', status: 'error', detail: message, fix: 'Check Diagnostics for the raw error.' }])
      onLog('error', `Model Doctor failed: ${message}`)
    } finally {
      setRunning(false)
    }
  }

  async function warmDaily() {
    const model = settings.modelAssignments?.daily || settings.fastModel || settings.model
    if (!model) return
    setBusy(model)
    try {
      await loadLmStudioModel({ ...settings, model }, model)
      onLog('status', `Model Doctor loaded daily model: ${model}`)
      await refresh()
    } catch (error) {
      onLog('error', `Model Doctor could not load ${model}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy('')
    }
  }

  useEffect(() => {
    void refresh()
  }, [settings.endpoint, settings.modelProvider, settings.model, settings.fastModel, settings.codeModel, settings.reviewModel])

  const errors = checks.filter((check) => check.status === 'error').length
  const warnings = checks.filter((check) => check.status === 'warning').length

  return (
    <div className="space-y-3 p-3 text-xs">
      <section className="doctor-hero">
        <div className="flex items-center gap-2 text-sm font-semibold text-cyan-50">
          <Stethoscope size={16} />
          Model Doctor
        </div>
        <p>Nebula checks LM Studio, assigned models, loaded state, recent errors, and slow responses.</p>
        <div className="grid grid-cols-2 gap-2">
          <button className="nebula-button-primary flex items-center justify-center gap-2 px-3 py-2" type="button" onClick={refresh} disabled={running}>
            <RefreshCw size={13} />
            {running ? 'Checking...' : 'Run check'}
          </button>
          <button className="nebula-toggle px-3 py-2" type="button" onClick={warmDaily} disabled={Boolean(busy)}>
            {busy ? 'Loading...' : 'Warm daily model'}
          </button>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-2">
        <Metric label="Errors" value={String(errors)} tone={errors ? 'danger' : 'good'} />
        <Metric label="Warnings" value={String(warnings)} tone={warnings ? 'warn' : 'good'} />
        <Metric label="Checks" value={String(checks.length)} tone="neutral" />
      </div>

      <div className="space-y-2">
        {checks.map((check) => (
          <article key={check.id} className={`doctor-card doctor-card-${check.status}`}>
            <div className="flex items-start gap-2">
              <span className="doctor-card-icon">{statusIcon(check.status)}</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-100">{check.title}</div>
                <p>{check.detail}</p>
                {check.fix && <div className="doctor-fix">{check.fix}</div>}
              </div>
            </div>
          </article>
        ))}
      </div>

      <button
        className="nebula-toggle w-full px-3 py-2 text-left"
        type="button"
        onClick={() => onChange({ ...settings, endpoint: 'http://localhost:1234/v1/chat/completions', autoLoadModels: true, modelMode: 'auto' })}
      >
        Apply safe defaults: LM Studio endpoint, auto model loading, auto routing
      </button>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'good' | 'warn' | 'danger' | 'neutral' }) {
  return (
    <div className={`doctor-metric doctor-metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
