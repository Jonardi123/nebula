import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Code2,
  Cpu,
  Database,
  Filter,
  RefreshCw,
  Sparkles,
  TerminalSquare,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { filterTimelineItems, getTimelineItems } from '../lib/timeline'
import type { LogEvent } from '../types/agent'
import type { TimelineFilter, TimelineItem, TimelineStatus } from '../types/nebula'

const filters: Array<{ id: TimelineFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'chat', label: 'Chat' },
  { id: 'code', label: 'Code' },
  { id: 'review', label: 'Review' },
  { id: 'skills', label: 'Skills' },
  { id: 'errors', label: 'Errors' },
  { id: 'system', label: 'System' },
]

const statusTone: Record<TimelineStatus, string> = {
  success: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  warning: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  error: 'border-red-400/30 bg-red-400/10 text-red-200',
  running: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100',
}

const statusIcon: Record<TimelineStatus, ReactNode> = {
  success: <CheckCircle2 size={12} />,
  warning: <AlertTriangle size={12} />,
  error: <XCircle size={12} />,
  running: <Activity size={12} />,
}

function iconFor(item: TimelineItem) {
  if (item.filter === 'chat') return <Bot size={14} />
  if (item.filter === 'code') {
    if (/command|terminal|run_command/i.test(item.type + item.title)) return <TerminalSquare size={14} />
    return <Code2 size={14} />
  }
  if (item.filter === 'review') return <CheckCircle2 size={14} />
  if (item.filter === 'skills') return <Sparkles size={14} />
  if (item.filter === 'errors') return <XCircle size={14} />
  if (/memory/i.test(item.type + item.title)) return <Database size={14} />
  if (/model|route/i.test(item.type + item.title)) return <Cpu size={14} />
  return <Activity size={14} />
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

interface Props {
  logs: LogEvent[]
}

export function TimelinePanel({ logs }: Props) {
  const [filter, setFilter] = useState<TimelineFilter>('all')
  const [items, setItems] = useState<TimelineItem[]>(() => getTimelineItems(logs))
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  function refresh() {
    setItems(getTimelineItems(logs))
  }

  useEffect(() => {
    refresh()
  }, [logs])

  useEffect(() => {
    const events = [
      'nebula-diagnostics-changed',
      'nebula-model-manager',
      'nebula-skills-runtime-changed',
      'nebula-skill-executed',
      'nebula-tasks-changed',
      'nebula-notifications-changed',
      'nebula-memory-inbox-changed',
      'nebula-sources-changed',
    ]
    const listener = () => refresh()
    events.forEach((event) => window.addEventListener(event, listener))
    return () => events.forEach((event) => window.removeEventListener(event, listener))
  }, [logs])

  const filteredItems = useMemo(() => filterTimelineItems(items, filter), [items, filter])
  const counts = useMemo(
    () =>
      Object.fromEntries(
        filters.map((entry) => [entry.id, filterTimelineItems(items, entry.id).length]),
      ) as Record<TimelineFilter, number>,
    [items],
  )

  return (
    <div className="timeline-panel space-y-3 p-3 text-xs">
      <section className="timeline-header rounded-[18px] border border-violet-300/20 bg-violet-300/[0.08] p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-violet-50">
              <Activity size={15} />
              Activity Feed
            </div>
            <p className="mt-1 text-[11px] leading-5 text-slate-400">
              Safe summaries of requests, routes, skills, tools, tasks, memory, and errors.
            </p>
          </div>
          <button className="nebula-toggle flex shrink-0 items-center gap-1 px-2 py-1" type="button" onClick={refresh} title="Refresh activity feed">
            <RefreshCw size={12} />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <Metric label="Events" value={items.length.toString()} />
          <Metric label="Errors" value={counts.errors.toString()} />
          <Metric label="Running" value={items.filter((item) => item.status === 'running').length.toString()} />
        </div>
      </section>

      <section className="rounded-[14px] border border-white/10 bg-white/[0.035] p-2">
        <div className="mb-2 flex items-center gap-2 px-1 text-[11px] uppercase tracking-[0.1em] text-slate-500">
          <Filter size={11} />
          Filters
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filters.map((entry) => (
            <button
              key={entry.id}
              className={`timeline-filter rounded-full border px-2.5 py-1 text-[11px] transition ${filter === entry.id ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-50' : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-100'}`}
              type="button"
              onClick={() => setFilter(entry.id)}
            >
              {entry.label}
              <span className="ml-1 text-[10px] opacity-60">{counts[entry.id]}</span>
            </button>
          ))}
        </div>
      </section>

      {filteredItems.length === 0 ? (
        <section className="timeline-empty rounded-[18px] border border-dashed border-white/10 bg-white/[0.03] p-4 text-center">
          <Clock3 size={20} className="mx-auto text-slate-500" />
          <div className="mt-2 text-sm font-semibold text-slate-200">No activity yet</div>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">Run a chat, task, skill, model route, command, or memory action and it will appear here.</p>
        </section>
      ) : (
        <div className="timeline-list relative space-y-2">
          {filteredItems.map((item) => (
            <TimelineCard
              key={item.id}
              item={item}
              expanded={!!expanded[item.id]}
              onToggle={() => setExpanded((current) => ({ ...current, [item.id]: !current[item.id] }))}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-white/10 bg-black/20 p-2">
      <div className="text-[10px] uppercase tracking-[0.08em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-100">{value}</div>
    </div>
  )
}

function TimelineCard({
  item,
  expanded,
  onToggle,
}: {
  item: TimelineItem
  expanded: boolean
  onToggle: () => void
}) {
  const hasDetails = item.details.length > 0

  return (
    <article className="timeline-card rounded-[16px] border border-white/10 bg-slate-950/70 p-3 transition duration-200 hover:border-cyan-300/25 hover:bg-slate-950/90">
      <div className="flex gap-3">
        <div className={`timeline-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] border ${statusTone[item.status]}`}>
          {iconFor(item)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-[0.08em] text-slate-500">{item.type}</span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase ${statusTone[item.status]}`}>
                  {statusIcon[item.status]}
                  {item.status}
                </span>
              </div>
              <h3 className="mt-1 break-words text-sm font-semibold leading-5 text-slate-100">{item.title}</h3>
            </div>
            <div className="shrink-0 text-right">
              <div className="terminal-font text-[10px] text-slate-400">{formatTime(item.time)}</div>
              <div className="mt-0.5 text-[10px] text-slate-600">{formatDate(item.time)}</div>
            </div>
          </div>

          {(item.relatedSkill || item.relatedModel) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.relatedSkill && <Tag label={item.relatedSkill} />}
              {item.relatedModel && <Tag label={item.relatedModel} />}
            </div>
          )}

          {hasDetails && (
            <button className="mt-3 flex items-center gap-1 text-[11px] text-cyan-200 hover:text-cyan-100" type="button" onClick={onToggle}>
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {expanded ? 'Hide details' : 'Show details'}
            </button>
          )}

          {expanded && hasDetails && (
            <div className="mt-3 space-y-2">
              {item.details.map((entry, index) => (
                <div key={`${entry.label}:${index}`} className="rounded-[12px] border border-white/10 bg-black/20 p-2">
                  <div className="text-[10px] uppercase tracking-[0.08em] text-slate-500">{entry.label}</div>
                  <pre className="terminal-font mt-1 whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-300">{entry.value}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function Tag({ label }: { label: string }) {
  return (
    <span className="max-w-full truncate rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-0.5 text-[10px] text-cyan-100">
      {label}
    </span>
  )
}
