import { Activity, Bot, BrainCircuit, Cpu, Database, HardDrive, MemoryStick, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { listLmStudioModelInfos } from '../lib/lmstudio'
import { getRegisteredNebulaModels } from '../lib/modelOrchestrator'
import { getModelRunStats } from '../lib/modelStats'
import { getSkillRuntimeStats } from '../skills'
import type { AgentStatus, ChatMessage } from '../types/agent'
import type { ModelInfo, ResourceSnapshot } from '../types/nebula'
import type { AppSettings } from '../types/settings'
import { getResourceSnapshot } from '../lib/resourceDiagnostics'

interface Props {
  settings: AppSettings
  lmOnline: boolean
  memoryReady: boolean
  agentStatus: AgentStatus
  messages: ChatMessage[]
  notificationCount: number
}

function percent(value: number) {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`
}

function mb(value?: number) {
  return value === undefined ? 'n/a' : `${value.toLocaleString()} MB`
}

export function SystemOverviewPanel({ settings, lmOnline, memoryReady, agentStatus, messages, notificationCount }: Props) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [resources, setResources] = useState<ResourceSnapshot | null>(null)
  const stats = useMemo(() => getModelRunStats(), [models, agentStatus])
  const skillStats = useMemo(() => getSkillRuntimeStats(), [agentStatus, messages.length])
  const registry = useMemo(() => getRegisteredNebulaModels(settings), [settings])
  const loadedModels = models.filter((model) => model.loaded)
  const contextChars = messages.slice(-18).reduce((total, message) => total + message.content.length, 0)
  const contextUsage = Math.min(100, (contextChars / Math.max(settings.contextBudgetChars || 18000, 1)) * 100)
  const recentSkills = Object.values(skillStats)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5)

  async function refresh() {
    const [nextModels, nextResources] = await Promise.all([
      listLmStudioModelInfos(settings).catch(() => []),
      getResourceSnapshot(),
    ])
    setModels(nextModels)
    setResources(nextResources)
  }

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 18000)
    const onModel = () => void refresh()
    window.addEventListener('nebula-model-manager', onModel)
    window.addEventListener('nebula-skills-runtime-changed', onModel)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('nebula-model-manager', onModel)
      window.removeEventListener('nebula-skills-runtime-changed', onModel)
    }
  }, [settings.endpoint, settings.modelAssignments?.daily, settings.modelAssignments?.code, settings.modelAssignments?.review])

  return (
    <aside className="nebula-system-panel hidden w-[306px] shrink-0 flex-col gap-3 xl:flex">
      <Panel title="System Status" icon={<ShieldCheck size={14} />}>
        <div className="flex items-center gap-2 text-sm text-slate-100">
          <span className={`h-2 w-2 rounded-full ${lmOnline && memoryReady ? 'bg-emerald-300' : 'bg-amber-300'} shadow-[0_0_16px_currentColor]`} />
          {lmOnline && memoryReady ? 'All systems operational' : 'Waiting on local services'}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <Mini label="LM Studio" value={lmOnline ? 'Online' : 'Offline'} tone={lmOnline ? 'good' : 'warn'} />
          <Mini label="Memory" value={memoryReady ? 'Ready' : 'Offline'} tone={memoryReady ? 'good' : 'warn'} />
          <Mini label="Agent" value={agentStatus.replaceAll('_', ' ')} />
          <Mini label="Unread" value={String(notificationCount)} />
        </div>
      </Panel>

      <Panel title="Model Orchestrator" icon={<BrainCircuit size={14} />}>
        <div className="space-y-2">
          {registry.map((entry) => {
            const loaded = loadedModels.some((model) => model.id === entry.id)
            const stat = stats[entry.id]
            return (
              <div key={`${entry.role}:${entry.id}`} className="system-model-row">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-slate-100">{entry.id || 'unset'}</div>
                  <div className="mt-0.5 text-[10px] uppercase text-slate-500">{entry.role}</div>
                </div>
                <div className="text-right">
                  <div className={`text-[11px] ${loaded ? 'text-emerald-300' : 'text-slate-500'}`}>{loaded ? 'warm' : 'idle'}</div>
                  <div className="text-[10px] text-slate-500">{stat?.lastFirstTokenMs ? `${Math.round(stat.lastFirstTokenMs)} ms` : 'n/a'}</div>
                </div>
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel title="Context" icon={<Database size={14} />}>
        <div className="mb-2 flex items-center justify-between text-xs text-slate-300">
          <span>Prompt budget</span>
          <span>{percent(contextUsage)}</span>
        </div>
        <div className="context-meter"><span style={{ width: percent(contextUsage) }} /></div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <Mini label="Messages" value={String(messages.length)} />
          <Mini label="Budget" value={`${Math.round((settings.contextBudgetChars || 18000) / 1000)}k chars`} />
        </div>
      </Panel>

      <Panel title="Safety Guards" icon={<ShieldCheck size={14} />}>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <Mini label="Files" value="System paths blocked" tone="good" />
          <Mini label="Command" value="90s timeout" tone="good" />
          <Mini label="Output" value="128 KB cap" tone="good" />
          <Mini label="Web fetch" value="2 MB text only" tone="good" />
        </div>
        <div className="mt-2 rounded-[12px] border border-white/10 bg-white/[0.03] p-2 text-[11px] text-slate-400">
          File writes, shell commands, and web fetches now have backend checks, not UI-only checks.
        </div>
      </Panel>

      <Panel title="Performance" icon={<Activity size={14} />}>
        <Perf label="RAM" icon={<MemoryStick size={13} />} value={resources ? `${mb(resources.ramAvailableMb)} free` : 'checking'} />
        <Perf label="Process" icon={<Cpu size={13} />} value={mb(resources?.processWorkingSetMb)} />
        <Perf label="VRAM" icon={<HardDrive size={13} />} value={resources?.vramTotalMb ? mb(resources.vramTotalMb) : 'best effort'} />
        <button className="system-refresh mt-3" type="button" onClick={refresh}>
          <RefreshCw size={12} />
          Refresh
        </button>
      </Panel>

      <Panel title="Recent Skills" icon={<Sparkles size={14} />}>
        {recentSkills.length > 0 ? (
          <div className="space-y-2">
            {recentSkills.map((skill) => (
              <div key={skill.skillId} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-slate-300">{skill.skillId}</span>
                <span className={skill.health === 'error' ? 'text-red-300' : 'text-emerald-300'}>{skill.usageCount}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyLine label="No skill runs yet" />
        )}
      </Panel>

      <Panel title="Active Agents" icon={<Bot size={14} />}>
        <Agent label="Planner" state={agentStatus === 'thinking' ? 'running' : 'idle'} />
        <Agent label="Executor" state={agentStatus === 'running_tool' ? 'running' : 'idle'} />
        <Agent label="Reviewer" state={agentStatus === 'reviewing' ? 'busy' : 'idle'} />
        <Agent label="Memory" state={memoryReady ? 'idle' : 'offline'} />
      </Panel>
    </aside>
  )
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="system-card">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-violet-200/80">
        {icon}
        {title}
      </div>
      {children}
    </section>
  )
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' }) {
  return (
    <div className="rounded-[12px] border border-white/10 bg-white/[0.035] p-2">
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
      <div className={`mt-1 truncate text-slate-200 ${tone === 'good' ? 'text-emerald-200' : tone === 'warn' ? 'text-amber-200' : ''}`}>{value}</div>
    </div>
  )
}

function Perf({ label, icon, value }: { label: string; icon: ReactNode; value: string }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 rounded-[12px] border border-white/10 bg-black/20 px-3 py-2 text-xs">
      <span className="inline-flex items-center gap-2 text-slate-400">{icon}{label}</span>
      <span className="text-slate-200">{value}</span>
    </div>
  )
}

function Agent({ label, state }: { label: string; state: 'idle' | 'running' | 'busy' | 'offline' }) {
  const tone = state === 'running' ? 'text-emerald-300 bg-emerald-300/10 border-emerald-300/20' : state === 'busy' ? 'text-amber-300 bg-amber-300/10 border-amber-300/20' : state === 'offline' ? 'text-red-300 bg-red-300/10 border-red-300/20' : 'text-slate-400 bg-white/[0.03] border-white/10'
  return (
    <div className="mb-2 flex items-center justify-between gap-2 text-xs">
      <span className="text-slate-300">{label}</span>
      <span className={`rounded-full border px-2 py-0.5 ${tone}`}>{state}</span>
    </div>
  )
}

function EmptyLine({ label }: { label: string }) {
  return <div className="rounded-[12px] border border-dashed border-white/10 bg-white/[0.02] p-3 text-xs text-slate-500">{label}</div>
}
