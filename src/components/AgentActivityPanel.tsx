import { Activity, Bot, BrainCircuit, Clock3, Cpu, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getAgentActivity } from '../lib/agentActivity'
import type { AgentStatus, LogEvent } from '../types/agent'
import type { AgentActivityState } from '../types/nebula'

export function AgentActivityPanel({ agentStatus, logs }: { agentStatus: AgentStatus; logs: LogEvent[] }) {
  const [items, setItems] = useState<AgentActivityState[]>(() => getAgentActivity(agentStatus, logs))

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setItems(getAgentActivity(agentStatus, logs)) }
    refresh()
    const timer = window.setInterval(refresh, 1000)
    window.addEventListener('nebula-diagnostics-changed', refresh)
    window.addEventListener('nebula-skills-runtime-changed', refresh)
    window.addEventListener('nebula-quick-actions-changed', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('nebula-diagnostics-changed', refresh)
      window.removeEventListener('nebula-skills-runtime-changed', refresh)
      window.removeEventListener('nebula-quick-actions-changed', refresh)
    }
  }, [agentStatus, logs])

  return (
    <div className="space-y-3 p-3 text-xs">
      <section className="nebula-note p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Activity size={15} className="text-cyan-200" />
          Live Agent Activity
        </div>
        <p className="mt-1 text-slate-400">Operational state only. Nebula never exposes hidden reasoning here.</p>
      </section>
      {items.map((agent) => (
        <section key={agent.id} className="agent-activity-card">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                {agent.id === 'planner' ? <BrainCircuit size={14} /> : agent.id === 'future' ? <Sparkles size={14} /> : <Bot size={14} />}
                {agent.name}
              </div>
              {agent.currentTask && <p className="mt-1 line-clamp-2 text-slate-400">{agent.currentTask}</p>}
              {agent.note && <p className="mt-1 text-slate-500">{agent.note}</p>}
            </div>
            <span className={`agent-state agent-state-${agent.state}`}>{agent.state}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Mini icon={<Cpu size={11} />} label="Model" value={agent.selectedModel ?? 'n/a'} />
            <Mini icon={<Sparkles size={11} />} label="Skill" value={agent.activeSkill ?? 'n/a'} />
            <Mini icon={<Clock3 size={11} />} label="Duration" value={agent.durationMs ? `${Math.round(agent.durationMs / 1000)}s` : 'n/a'} />
            <Mini icon={<Activity size={11} />} label="ETA" value={agent.estimatedCompletion ?? 'n/a'} />
          </div>
        </section>
      ))}
    </div>
  )
}

function Mini({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-white/10 bg-black/20 p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase text-slate-500">{icon}{label}</div>
      <div className="mt-1 truncate text-slate-200">{value}</div>
    </div>
  )
}
