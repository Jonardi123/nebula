import type { LogEvent } from '../types/agent'
import { formatTime } from '../lib/logger'

export function TerminalPanel({ logs }: { logs: LogEvent[] }) {
  return (
    <section className="terminal-shell h-52 shrink-0">
      <div className="terminal-header flex h-9 items-center justify-between px-4 text-xs text-slate-400">
        <span className="uppercase text-cyan-100/55">Action Bus</span>
        <span className="event-count">{logs.length} events</span>
      </div>
      <div className="terminal-font h-[calc(100%-2.25rem)] overflow-auto px-4 py-2 text-xs leading-5">
        {logs.map((log) => (
          <div key={log.id} className="log-row grid grid-cols-[96px_110px_1fr] gap-3 py-1 text-slate-300">
            <span className="text-slate-500">{formatTime(log.createdAt)}</span>
            <span className="text-cyan-200">{log.type}</span>
            <span className="whitespace-pre-wrap break-words">{log.message}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
