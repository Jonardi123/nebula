import {
  Activity,
  Bell,
  Bot,
  BrainCircuit,
  Clock3,
  Database,
  FolderOpen,
  Globe2,
  HardDrive,
  ListChecks,
  MemoryStick,
  Mic,
  MonitorCog,
  Play,
  Plus,
  Radar,
  Save,
  Search,
  ShieldAlert,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAgentActivity } from '../lib/agentActivity'
import {
  STEP_LABELS,
  TRIGGER_LABELS,
  createNebulaRoutine,
  createRoutineStep,
  deleteNebulaRoutine,
  getNebulaRoutineRuns,
  getNebulaRoutines,
  toggleNebulaRoutine,
} from '../lib/automationRoutines'
import { runNebulaRoutineQueued, stopAutomationRunner } from '../lib/automationRunner'
import { getCommandCenterEvents, getMemoryCoreCategories } from '../lib/commandCenter'
import { listLmStudioModelInfos } from '../lib/lmstudio'
import { forgetMemoryCore, rememberMemoryCore, searchMemoryIndex } from '../lib/memoryIndex'
import { readMemory } from '../lib/memory'
import { getResourceSnapshot } from '../lib/resourceDiagnostics'
import { getRoutineTemplates, installRoutineTemplate } from '../lib/routineTemplates'
import type { AgentStatus, LogEvent } from '../types/agent'
import type {
  CommandCenterEvent,
  MemoryCoreCategory,
  MemorySearchRankedResult,
  ModelInfo,
  NebulaRoutine,
  NebulaRoutineRun,
  NebulaRoutineStep,
  NebulaRoutineStepType,
  NebulaRoutineTriggerType,
  ResourceSnapshot,
  WorkspaceAwarenessSnapshot,
} from '../types/nebula'
import type { AppSettings } from '../types/settings'
import { RoutineResultCard } from './RoutineResultCard'

interface Props {
  settings: AppSettings
  logs: LogEvent[]
  agentStatus: AgentStatus
  lmOnline: boolean
  memoryReady: boolean
  workspaceAwareness?: WorkspaceAwarenessSnapshot | null
  onOpenPanel: (panel: string) => void
  onLog: (type: LogEvent['type'], message: string, details?: unknown) => void
}

type MemoryPreview = Record<string, { lineCount: number; preview: string }>

const stepOptions = Object.keys(STEP_LABELS) as NebulaRoutineStepType[]
const triggerOptions = Object.keys(TRIGGER_LABELS) as NebulaRoutineTriggerType[]

function formatMb(value?: number) {
  return value === undefined ? 'n/a' : `${value.toLocaleString()} MB`
}

function formatPercent(value?: number) {
  return value === undefined ? 'n/a' : `${Math.max(0, Math.min(100, Math.round(value)))}%`
}

function compactTime(value?: string) {
  if (!value) return 'never'
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function storageUsage(resources: ResourceSnapshot | null) {
  if (!resources?.systemDriveTotalMb || resources.systemDriveFreeMb === undefined) return undefined
  return ((resources.systemDriveTotalMb - resources.systemDriveFreeMb) / resources.systemDriveTotalMb) * 100
}

export function JarvisModePanel({
  settings,
  logs,
  agentStatus,
  lmOnline,
  memoryReady,
  workspaceAwareness = null,
  onOpenPanel,
  onLog,
}: Props) {
  const [resources, setResources] = useState<ResourceSnapshot | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [events, setEvents] = useState<CommandCenterEvent[]>(() => getCommandCenterEvents(logs))
  const [routines, setRoutines] = useState<NebulaRoutine[]>(() => getNebulaRoutines())
  const [runs, setRuns] = useState<NebulaRoutineRun[]>(() => getNebulaRoutineRuns())
  const [memoryPreview, setMemoryPreview] = useState<MemoryPreview>({})
  const [memoryQuery, setMemoryQuery] = useState('')
  const [memoryResults, setMemoryResults] = useState<MemorySearchRankedResult[]>([])
  const [rememberText, setRememberText] = useState('')
  const [rememberCategory, setRememberCategory] = useState<MemoryCoreCategory['id']>('preferences')
  const [builderOpen, setBuilderOpen] = useState(false)
  const [builderName, setBuilderName] = useState('New routine')
  const [builderDescription, setBuilderDescription] = useState('Prepare a useful Nebula workflow.')
  const [builderTrigger, setBuilderTrigger] = useState<NebulaRoutineTriggerType>('manual')
  const [builderTime, setBuilderTime] = useState('09:00')
  const [builderInterval, setBuilderInterval] = useState(30)
  const [builderStepType, setBuilderStepType] = useState<NebulaRoutineStepType>('send_notification')
  const [builderStepInput, setBuilderStepInput] = useState('Nebula routine completed.')
  const [builderSteps, setBuilderSteps] = useState<NebulaRoutineStep[]>([createRoutineStep('send_notification', 'Nebula routine completed.')])
  const [runningRoutineId, setRunningRoutineId] = useState('')
  const [selectedRunId, setSelectedRunId] = useState('')
  const categories = useMemo(() => getMemoryCoreCategories(), [])
  const templates = useMemo(() => getRoutineTemplates(), [])
  const agents = useMemo(() => getAgentActivity(agentStatus, logs).slice(0, 5), [agentStatus, logs])
  const loadedModels = models.filter((model) => model.loaded)
  const activeTask = workspaceAwareness?.lastActiveTask?.goal ?? logs.slice().reverse().find((log) => log.type === 'user_message')?.message ?? 'No active task observed'
  const diskUsage = storageUsage(resources)
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0]

  const refresh = useCallback(async () => {
    const [nextResources, nextModels] = await Promise.all([
      getResourceSnapshot(),
      listLmStudioModelInfos(settings).catch(() => []),
    ])
    setResources(nextResources)
    setModels(nextModels)
    setEvents(getCommandCenterEvents(logs))
    setRoutines(getNebulaRoutines())
    setRuns(getNebulaRoutineRuns())
    const previews = await Promise.all(
      categories.map(async (category) => {
        const content = await readMemory(settings.memoryFolder, category.file).catch(() => '')
        const lines = content.split(/\r?\n/).filter((line) => line.trim())
        return [
          category.id,
          {
            lineCount: lines.length,
            preview: lines.slice(-2).join(' ') || 'No saved notes yet.',
          },
        ] as const
      }),
    )
    setMemoryPreview(Object.fromEntries(previews))
  }, [categories, logs, settings])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 15000)
    const onChange = () => void refresh()
    window.addEventListener('nebula-command-center-changed', onChange)
    window.addEventListener('nebula-model-manager', onChange)
    window.addEventListener('nebula-diagnostics-changed', onChange)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('nebula-command-center-changed', onChange)
      window.removeEventListener('nebula-model-manager', onChange)
      window.removeEventListener('nebula-diagnostics-changed', onChange)
    }
  }, [refresh])

  function addBuilderStep() {
    setBuilderSteps((current) => [...current, createRoutineStep(builderStepType, builderStepInput)])
    setBuilderStepInput('')
  }

  function createRoutine() {
    const routine = createNebulaRoutine({
      name: builderName,
      description: builderDescription,
      trigger: {
        type: builderTrigger,
        timeOfDay: builderTime,
        intervalMinutes: builderInterval,
      },
      steps: builderSteps,
    })
    setBuilderOpen(false)
    setBuilderName('New routine')
    setBuilderDescription('Prepare a useful Nebula workflow.')
    setBuilderSteps([createRoutineStep('send_notification', 'Nebula routine completed.')])
    setRoutines(getNebulaRoutines())
    onLog('status', `Nebula Core routine created: ${routine.name}`, routine)
  }

  async function runRoutine(routine: NebulaRoutine) {
    setRunningRoutineId(routine.id)
    try {
      const run = await runNebulaRoutineQueued(
        routine,
        settings,
        {
          lmOnline,
          projectFolder: settings.projectFolder,
          workspaceAwareness,
        },
        { onLog },
        'manual',
      )
      setSelectedRunId(run.id)
    } finally {
      setRunningRoutineId('')
      await refresh()
    }
  }

  function stopRoutine() {
    const stoppedRunId = stopAutomationRunner()
    onLog('status', stoppedRunId ? `Stop requested for routine run ${stoppedRunId}.` : 'Stop requested for automation runner.')
  }

  async function runMemorySearch() {
    const results = await searchMemoryIndex(settings.memoryFolder, memoryQuery || 'Nebula', 12)
    setMemoryResults(results)
  }

  async function remember() {
    const saved = await rememberMemoryCore(settings.memoryFolder, rememberCategory, rememberText)
    setRememberText('')
    onLog('memory', `Memory Core saved to ${saved.file}.`, saved)
    await refresh()
  }

  async function forget(result: MemorySearchRankedResult) {
    const removed = await forgetMemoryCore(settings.memoryFolder, result.file, result.line)
    onLog('memory', `Memory Core forgot ${removed.file}:${removed.line}.`, removed)
    await runMemorySearch()
    await refresh()
  }

  return (
    <div className="jarvis-panel space-y-4 p-3 text-xs">
      <section className="jarvis-hero">
        <div className="jarvis-hero-glow" />
        <div className="relative z-10">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-200/80">
            <Radar size={15} />
            Nebula Core
          </div>
          <h2>Nebula Core</h2>
          <p>Local diagnostics, semantic memory foundation, agent activity, and executable routines in one operational view.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusPill label={lmOnline ? 'LM Studio online' : 'LM Studio offline'} tone={lmOnline ? 'good' : 'warn'} />
            <StatusPill label={memoryReady ? 'Memory ready' : 'Memory pending'} tone={memoryReady ? 'good' : 'warn'} />
            <StatusPill label={settings.desktopControlBetaEnabled ? 'Desktop beta on' : 'Desktop beta off'} tone={settings.desktopControlBetaEnabled ? 'good' : 'neutral'} />
            <StatusPill label={agentStatus.replaceAll('_', ' ')} tone={agentStatus === 'error' ? 'danger' : 'neutral'} />
          </div>
        </div>
      </section>

      <section className="jarvis-hud-grid">
        <HudCard icon={<Activity size={15} />} label="CPU" value={formatPercent(resources?.cpuLoadPercent)} detail="Windows processor load" />
        <HudCard icon={<MemoryStick size={15} />} label="RAM" value={`${formatMb(resources?.ramAvailableMb)} free`} detail={`${formatMb(resources?.ramTotalMb)} total`} />
        <HudCard icon={<HardDrive size={15} />} label="Storage" value={formatPercent(diskUsage)} detail={`${resources?.systemDrive ?? 'Drive'} ${formatMb(resources?.systemDriveFreeMb)} free`} />
        <HudCard icon={<BrainCircuit size={15} />} label="Model" value={loadedModels[0]?.displayName ?? (lmOnline ? 'server ready' : 'offline')} detail={`${loadedModels.length} loaded`} />
        <HudCard icon={<ListChecks size={15} />} label="Active task" value={agentStatus.replaceAll('_', ' ')} detail={activeTask} wide />
      </section>

      <section className="jarvis-card">
        <Header icon={<ListChecks size={15} />} title="Automation Routines" action={<button type="button" onClick={() => setBuilderOpen(true)}><Plus size={12} /> Build</button>} />
        <div className="jarvis-template-strip">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => {
                const routine = installRoutineTemplate(template)
                setRoutines(getNebulaRoutines())
                onLog('status', `Routine template installed: ${routine.name}`, routine)
              }}
            >
              <Sparkles size={12} />
              <span>{template.name}</span>
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {routines.map((routine) => (
            <RoutineRow
              key={routine.id}
              routine={routine}
              running={runningRoutineId === routine.id}
              onRun={runRoutine}
              onStop={stopRoutine}
              onToggle={(enabled) => {
                toggleNebulaRoutine(routine.id, enabled)
                void refresh()
              }}
              onDelete={(item) => {
                deleteNebulaRoutine(item.id)
                onLog('status', `Nebula Core routine deleted: ${item.name}`)
                void refresh()
              }}
            />
          ))}
        </div>
      </section>

      <section className="jarvis-card">
        <Header icon={<Clock3 size={15} />} title="Run History" action={<button type="button" onClick={() => onOpenPanel('timeline')}>Timeline</button>} />
        {selectedRun ? (
          <div className="jarvis-run-detail">
            <RoutineResultCard
              run={selectedRun}
              onInspect={() => setSelectedRunId(selectedRun.id)}
              onRetry={() => {
                const routine = routines.find((item) => item.id === selectedRun.routineId)
                if (routine) void runRoutine(routine)
              }}
            />
            <div className="mb-2 flex items-center justify-between gap-2">
              <strong>{selectedRun.routineName}</strong>
              <span className={`jarvis-state jarvis-state-${selectedRun.status}`}>{selectedRun.status}</span>
            </div>
            <p>{selectedRun.summary || 'Run details recorded locally.'}</p>
            <div className="mt-3 space-y-2">
              {selectedRun.stepResults.map((result) => (
                <button key={result.id} type="button" className="jarvis-run-step" onClick={() => setSelectedRunId(selectedRun.id)}>
                  <span className={`jarvis-event-dot jarvis-event-${result.status === 'success' ? 'success' : result.status === 'error' ? 'error' : 'running'}`} />
                  <span className="min-w-0">
                    <strong>{result.label}</strong>
                    <small>{result.output || result.error || result.status}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="premium-empty-state">No routine runs yet.</div>
        )}
      </section>

      <section className="jarvis-card">
        <Header icon={<Database size={15} />} title="Memory Core" action={<button type="button" onClick={() => onOpenPanel('memory')}>Open Memory</button>} />
        <div className="jarvis-memory-grid">
          {categories.map((category) => {
            const preview = memoryPreview[category.id]
            return (
              <button key={category.id} type="button" className="jarvis-memory-card" onClick={() => setRememberCategory(category.id)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-100">{category.label}</span>
                  <span>{preview?.lineCount ?? 0}</span>
                </div>
                <p>{category.description}</p>
                <small>{preview?.preview ?? category.examples.join(', ')}</small>
              </button>
            )
          })}
        </div>
        <div className="jarvis-memory-tools">
          <select value={rememberCategory} onChange={(event) => setRememberCategory(event.target.value as MemoryCoreCategory['id'])}>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
          </select>
          <input value={rememberText} onChange={(event) => setRememberText(event.target.value)} placeholder="Remember a useful fact, preference, command, or lesson..." />
          <button type="button" onClick={() => void remember()} disabled={!rememberText.trim()}><Save size={12} /> Remember</button>
        </div>
        <div className="jarvis-memory-tools">
          <input value={memoryQuery} onChange={(event) => setMemoryQuery(event.target.value)} placeholder="Search Memory Core semantically..." />
          <button type="button" onClick={() => void runMemorySearch()}><Search size={12} /> Search</button>
        </div>
        {memoryResults.length > 0 && (
          <div className="mt-3 space-y-2">
            {memoryResults.map((result) => (
              <div key={result.id} className="jarvis-memory-result">
                <div>
                  <strong>{result.file}:{result.line}</strong>
                  <p>{result.text}</p>
                  <small>{result.reason} Score {result.score}</small>
                </div>
                <button type="button" onClick={() => void forget(result)}>Forget</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="jarvis-card">
        <Header icon={<Bot size={15} />} title="Agent Activity" action={<button type="button" onClick={() => onOpenPanel('activity')}>Open</button>} />
        <div className="space-y-2">
          {agents.map((agent) => (
            <div key={agent.id} className="jarvis-agent-row">
              <div className="min-w-0">
                <div className="font-semibold text-slate-100">{agent.name}</div>
                <div className="truncate text-[11px] text-slate-500">{agent.currentTask ?? agent.note ?? 'Standing by'}</div>
              </div>
              <span className={`jarvis-state jarvis-state-${agent.state}`}>{agent.state}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="jarvis-card">
        <Header icon={<Activity size={15} />} title="Activity Feed" action={<button type="button" onClick={() => onOpenPanel('timeline')}>Timeline</button>} />
        <div className="space-y-2">
          {events.slice(0, 8).map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </div>
      </section>

      <section className="jarvis-card">
        <Header icon={<FolderOpen size={15} />} title="Local Control" action={<button type="button" onClick={() => onOpenPanel('files')}>Files</button>} />
        <div className="jarvis-entry-grid">
          <EntryButton icon={<FolderOpen size={14} />} label="Projects" detail="Open workspace explorer" onClick={() => onOpenPanel('profiles')} />
          <EntryButton icon={<Sparkles size={14} />} label="Skills" detail="Manage capability packs" onClick={() => onOpenPanel('skills')} />
          <EntryButton icon={<Globe2 size={14} />} label="Browser Beta" detail="Safe search/fetch through routines" disabled={!settings.desktopControlBetaEnabled} />
          <EntryButton icon={<MonitorCog size={14} />} label="Known App Launch" detail="Notepad, Calculator, Explorer, shells" disabled={!settings.desktopControlBetaEnabled} />
          <EntryButton icon={<Mic size={14} />} label="Wake Phrase" detail={settings.wakePhraseEnabled ? `"${settings.wakePhrase}" armed as future provider slot` : 'Provider slot disabled'} disabled />
          <EntryButton icon={<ShieldAlert size={14} />} label="Safety Gates" detail="Destructive/security actions stay blocked" disabled />
        </div>
      </section>

      {builderOpen && (
        <div className="jarvis-builder-backdrop" role="presentation" onMouseDown={() => setBuilderOpen(false)}>
          <section className="jarvis-builder-modal" role="dialog" aria-modal="true" aria-label="Build Nebula routine" onMouseDown={(event) => event.stopPropagation()}>
            <Header icon={<ListChecks size={15} />} title="Routine Builder" action={<button type="button" onClick={() => setBuilderOpen(false)}><X size={12} /> Close</button>} />
            <label>
              Name
              <input value={builderName} onChange={(event) => setBuilderName(event.target.value)} />
            </label>
            <label>
              Description
              <input value={builderDescription} onChange={(event) => setBuilderDescription(event.target.value)} />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label>
                Trigger
                <select value={builderTrigger} onChange={(event) => setBuilderTrigger(event.target.value as NebulaRoutineTriggerType)}>
                  {triggerOptions.map((trigger) => <option key={trigger} value={trigger}>{TRIGGER_LABELS[trigger]}</option>)}
                </select>
              </label>
              <label>
                Time
                <input value={builderTime} onChange={(event) => setBuilderTime(event.target.value)} placeholder="09:00" />
              </label>
              <label>
                Interval
                <input value={builderInterval} type="number" min={1} onChange={(event) => setBuilderInterval(Number(event.target.value) || 30)} />
              </label>
            </div>
            <div className="jarvis-builder-step-adder">
              <select value={builderStepType} onChange={(event) => setBuilderStepType(event.target.value as NebulaRoutineStepType)}>
                {stepOptions.map((step) => <option key={step} value={step}>{STEP_LABELS[step]}</option>)}
              </select>
              <input value={builderStepInput} onChange={(event) => setBuilderStepInput(event.target.value)} placeholder="Step input, command, app, URL, or note..." />
              <button type="button" onClick={addBuilderStep}><Plus size={12} /> Add step</button>
            </div>
            <div className="space-y-2">
              {builderSteps.map((step) => (
                <div key={step.id} className="jarvis-builder-step">
                  <div>
                    <strong>{step.label}</strong>
                    <small>{step.input || step.note || 'No input'}</small>
                  </div>
                  <span className={`jarvis-risk jarvis-risk-${step.riskLevel}`}>{step.riskLevel}</span>
                  <button type="button" onClick={() => setBuilderSteps((current) => current.filter((item) => item.id !== step.id))}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="nebula-button-primary mt-3 flex w-full items-center justify-center gap-2 px-3 py-2" onClick={createRoutine} disabled={!builderName.trim() || builderSteps.length === 0}>
              <Save size={13} />
              Save routine
            </button>
          </section>
        </div>
      )}
    </div>
  )
}

function Header({ icon, title, action }: { icon: React.ReactNode; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
        {icon}
        {title}
      </div>
      <div className="jarvis-card-action">{action}</div>
    </div>
  )
}

function StatusPill({ label, tone }: { label: string; tone: 'good' | 'warn' | 'danger' | 'neutral' }) {
  return <span className={`jarvis-pill jarvis-pill-${tone}`}>{label}</span>
}

function HudCard({ icon, label, value, detail, wide }: { icon: React.ReactNode; label: string; value: string; detail: string; wide?: boolean }) {
  return (
    <div className={`jarvis-hud-card ${wide ? 'jarvis-hud-wide' : ''}`}>
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-2 truncate text-sm font-semibold text-slate-100">{value}</div>
      <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{detail}</div>
    </div>
  )
}

function EventRow({ event }: { event: CommandCenterEvent }) {
  return (
    <div className="jarvis-event-row">
      <span className={`jarvis-event-dot jarvis-event-${event.status}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold text-slate-100">{event.title}</span>
          <time className="shrink-0 text-[10px] text-slate-600">{compactTime(event.createdAt)}</time>
        </div>
        <div className="line-clamp-2 text-[11px] leading-4 text-slate-500">{event.detail}</div>
      </div>
    </div>
  )
}

function RoutineRow({
  routine,
  running,
  onRun,
  onStop,
  onToggle,
  onDelete,
}: {
  routine: NebulaRoutine
  running: boolean
  onRun: (routine: NebulaRoutine) => void
  onStop: () => void
  onToggle: (enabled: boolean) => void
  onDelete: (routine: NebulaRoutine) => void
}) {
  return (
    <div className={`jarvis-routine-row ${!routine.enabled ? 'jarvis-routine-disabled' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-slate-100">{routine.name}</span>
          <span className={`jarvis-risk jarvis-risk-${routine.riskLevel}`}>{routine.riskLevel}</span>
        </div>
        <p className="line-clamp-2">{routine.description}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="jarvis-step-chip">{TRIGGER_LABELS[routine.trigger.type]}</span>
          {routine.steps.slice(0, 4).map((step) => (
            <span key={step.id} className="jarvis-step-chip">{step.label}</span>
          ))}
        </div>
        <small>Last run: {compactTime(routine.lastRunAt)} | {routine.lastRunStatus ?? 'never'}</small>
      </div>
      <div className="flex shrink-0 gap-1">
        <button type="button" className="jarvis-icon-button" onClick={() => onToggle(!routine.enabled)} aria-label={`${routine.enabled ? 'Disable' : 'Enable'} ${routine.name}`}>
          <Bell size={12} />
        </button>
        {running ? (
          <button type="button" className="jarvis-icon-button jarvis-danger-button" onClick={onStop} aria-label={`Stop ${routine.name}`}>
            <Square size={12} />
          </button>
        ) : (
          <button type="button" className="jarvis-icon-button" onClick={() => void onRun(routine)} disabled={!routine.enabled} aria-label={`Run ${routine.name}`}>
            <Play size={12} />
          </button>
        )}
        <button type="button" className="jarvis-icon-button jarvis-danger-button" onClick={() => onDelete(routine)} aria-label={`Delete ${routine.name}`}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

function EntryButton({ icon, label, detail, disabled, onClick }: { icon: React.ReactNode; label: string; detail: string; disabled?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className="jarvis-entry-button" disabled={disabled} onClick={onClick}>
      {icon}
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </button>
  )
}
