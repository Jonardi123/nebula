import { Activity, BrainCircuit, Cpu, Gauge, Mic, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { listLmStudioModelInfos } from '../lib/lmstudio'
import { getRegisteredNebulaModels } from '../lib/modelOrchestrator'
import { getModelRunStats } from '../lib/modelStats'
import { getOrchestratorDiagnostics, modelSwitchCount } from '../lib/orchestratorDiagnostics'
import { getResourceSnapshot } from '../lib/resourceDiagnostics'
import { getVoiceDiagnostics, runVoiceDiagnostics } from '../lib/voiceDiagnostics'
import type { ModelInfo, NebulaDiagnosticEvent, ResourceSnapshot, VoiceDiagnosticSnapshot } from '../types/nebula'
import type { AppSettings } from '../types/settings'

interface Props {
  settings: AppSettings
}

function formatMs(value?: number) {
  return value ? `${Math.round(value)} ms` : 'n/a'
}

function formatMb(value?: number) {
  return value === undefined ? 'n/a' : `${value.toLocaleString()} MB`
}

export function DiagnosticsPanel({ settings }: Props) {
  const [events, setEvents] = useState<NebulaDiagnosticEvent[]>(() => getOrchestratorDiagnostics())
  const [models, setModels] = useState<ModelInfo[]>([])
  const [resources, setResources] = useState<ResourceSnapshot | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [voice, setVoice] = useState<VoiceDiagnosticSnapshot | null>(() => getVoiceDiagnostics())
  const stats = useMemo(() => getModelRunStats(), [events, models])
  const registry = useMemo(() => getRegisteredNebulaModels(settings), [settings])
  const routeEvents = events.filter((event) => event.type === 'route')
  const latestRoute = routeEvents[0]
  const loadedModels = models.filter((model) => model.loaded)
  const warmModels = registry.filter((entry) => loadedModels.some((model) => model.id === entry.id))

  async function refresh() {
    setRefreshing(true)
    try {
      const [nextModels, nextResources, nextVoice] = await Promise.all([
        listLmStudioModelInfos(settings).catch(() => []),
        getResourceSnapshot(),
        runVoiceDiagnostics(settings.voiceLanguage),
      ])
      setEvents(getOrchestratorDiagnostics())
      setModels(nextModels)
      setResources(nextResources)
      setVoice(nextVoice)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void refresh()
    const onChange = () => setEvents(getOrchestratorDiagnostics())
    window.addEventListener('nebula-diagnostics-changed', onChange)
    window.addEventListener('nebula-model-manager', onChange)
    return () => {
      window.removeEventListener('nebula-diagnostics-changed', onChange)
      window.removeEventListener('nebula-model-manager', onChange)
    }
  }, [settings.endpoint])

  if (!settings.developerDiagnosticsEnabled) {
    return (
      <div className="p-3 text-sm text-slate-400">
        Developer diagnostics are disabled in Settings.
      </div>
    )
  }

  return (
    <div className="space-y-3 p-3 text-xs">
      <button className="nebula-button-primary flex w-full items-center justify-center gap-2 px-3 py-2" type="button" onClick={refresh}>
        <RefreshCw size={13} />
        {refreshing ? 'Refreshing...' : 'Refresh Diagnostics'}
      </button>

      <section className="rounded-md border border-cyan-300/20 bg-cyan-300/[0.08] p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-cyan-50">
          <BrainCircuit size={15} />
          Orchestrator
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
          <Metric label="Active route" value={latestRoute?.label ?? 'n/a'} />
          <Metric label="Active model" value={latestRoute?.model ?? 'n/a'} />
          <Metric label="Loaded models" value={loadedModels.length.toString()} />
          <Metric label="Warm models" value={warmModels.map((model) => model.role).join(', ') || 'none'} />
          <Metric label="Switch count" value={modelSwitchCount(events).toString()} />
          <Metric label="Review triggers" value={events.filter((event) => event.type === 'review').length.toString()} />
        </div>
        {latestRoute?.detail && <div className="mt-3 text-[11px] leading-4 text-slate-400">{latestRoute.detail}</div>}
      </section>

      <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100"><Mic size={15} />Voice reliability</div>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
          <Metric label="Recognition" value={voice?.supported ? 'supported' : 'unavailable'} />
          <Metric label="Microphone" value={voice?.permission ?? 'unknown'} />
          <Metric label="Language" value={voice?.language ?? settings.voiceLanguage} />
          <Metric label="Last transcript" value={voice?.lastTranscriptAt ? new Date(voice.lastTranscriptAt).toLocaleString() : 'none'} />
        </div>
        {voice?.lastError && <div className="mt-3 text-[11px] leading-4 text-red-200">{voice.lastError}</div>}
      </section>

      <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Gauge size={15} />
          Latency
        </div>
        <div className="space-y-2">
          {registry.map((entry) => {
            const stat = stats[entry.id]
            return (
              <div key={`${entry.role}:${entry.id}`} className="rounded-md border border-white/10 bg-black/20 p-2">
                <div className="break-words font-semibold text-slate-200">{entry.label}</div>
                <div className="terminal-font mt-1 break-all text-[10px] text-slate-500">{entry.id}</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                  <Metric label="First token" value={formatMs(stat?.lastFirstTokenMs)} />
                  <Metric label="Total" value={formatMs(stat?.lastResponseMs)} />
                  <Metric label="Load" value={formatMs(stat?.lastLoadMs)} />
                  <Metric label="Rough speed" value={stat?.roughTokensPerSecond ? `${stat.roughTokensPerSecond} tok/s` : 'n/a'} />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Cpu size={15} />
          Resources
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
          <Metric label="RAM total" value={formatMb(resources?.ramTotalMb)} />
          <Metric label="RAM available" value={formatMb(resources?.ramAvailableMb)} />
          <Metric label="Nebula process" value={formatMb(resources?.processWorkingSetMb)} />
          <Metric label="UI heap" value={formatMb(resources?.jsHeapMb)} />
          <Metric label="GPU" value={resources?.gpuName ?? 'n/a'} />
          <Metric label="VRAM reported" value={formatMb(resources?.vramTotalMb)} />
        </div>
        {resources?.vramNote && <div className="mt-3 text-[11px] leading-4 text-amber-200">{resources.vramNote}</div>}
        {resources?.error && <div className="mt-3 text-[11px] leading-4 text-red-200">{resources.error}</div>}
      </section>

      <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Activity size={15} />
          Recent Decisions
        </div>
        <div className="space-y-2">
          {events.slice(0, 18).map((event) => (
            <div key={event.id} className="rounded-md border border-white/10 bg-black/20 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-200">{event.label}</span>
                <span className="text-[10px] text-slate-500">{new Date(event.createdAt).toLocaleTimeString()}</span>
              </div>
              {event.detail && <div className="mt-1 break-words text-[11px] leading-4 text-slate-400">{event.detail}</div>}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20 p-2">
      <div className="text-[10px] uppercase tracking-[0.08em] text-slate-500">{label}</div>
      <div className="mt-1 break-words text-slate-200">{value}</div>
    </div>
  )
}
