import { Clock3, PlayCircle, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getReplaySessions, type ReplaySession } from '../lib/replaySessions'
import type { LogEvent } from '../types/agent'

export function ReplayPanel({ logs }: { logs: LogEvent[] }) {
  const [sessions, setSessions] = useState<ReplaySession[]>(() => getReplaySessions(logs))
  const [selectedId, setSelectedId] = useState('')
  const selected = sessions.find((session) => session.id === selectedId) ?? sessions[0]

  function refresh() {
    const next = getReplaySessions(logs)
    setSessions(next)
    if (!selectedId && next[0]) setSelectedId(next[0].id)
  }

  useEffect(() => {
    refresh()
    const events = ['nebula-tasks-changed', 'nebula-diagnostics-changed', 'nebula-skills-runtime-changed']
    events.forEach((event) => window.addEventListener(event, refresh))
    return () => events.forEach((event) => window.removeEventListener(event, refresh))
  }, [logs])

  return (
    <div className="space-y-3 p-3 text-xs">
      <button className="nebula-button-primary flex w-full items-center justify-center gap-2 px-3 py-2" onClick={refresh}>
        <RefreshCw size={13} />
        Refresh Replay
      </button>
      <div className="space-y-2">
        {sessions.map((session) => (
          <button key={session.id} className={`replay-session ${selected?.id === session.id ? 'replay-session-active' : ''}`} onClick={() => setSelectedId(session.id)}>
            <PlayCircle size={14} />
            <span className="min-w-0 flex-1 truncate">{session.title}</span>
            <span>{session.items.length}</span>
          </button>
        ))}
      </div>
      {selected ? (
        <section className="rounded-[18px] border border-white/10 bg-white/[0.035] p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Clock3 size={14} />
            {selected.title}
          </div>
          <div className="space-y-2">
            {selected.items.map((item) => (
              <div key={item.id} className="rounded-[12px] border border-white/10 bg-black/20 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-100">{item.title}</span>
                  <span className="terminal-font text-[10px] text-slate-500">{new Date(item.time).toLocaleTimeString()}</span>
                </div>
                <div className="mt-1 text-[10px] uppercase text-cyan-200/70">{item.type}</div>
                {item.details[0] && <p className="mt-1 line-clamp-3 text-slate-400">{item.details[0].value}</p>}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className="nebula-note p-3 text-slate-500">No replay sessions yet.</div>
      )}
    </div>
  )
}
