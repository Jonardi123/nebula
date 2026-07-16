import type { AgentTimelineItem } from '../types/agent'

export function StatusTimeline({ items }: { items: AgentTimelineItem[] }) {
  return (
    <div className="timeline-grid grid grid-cols-4 gap-2 p-2">
      {items.map((item) => (
        <div key={item.id} className={`timeline-card flex items-center gap-2 px-3 py-2 text-xs timeline-${item.status}`}>
          <span
            className={
              item.status === 'active'
                ? 'timeline-bar h-1.5 w-5 rounded-full bg-cyan-200'
                : item.status === 'done'
                  ? 'timeline-bar h-1.5 w-5 rounded-full bg-emerald-300'
                  : item.status === 'error'
                    ? 'timeline-bar h-1.5 w-5 rounded-full bg-red-300'
                    : 'timeline-bar h-1.5 w-5 rounded-full bg-slate-700'
            }
          />
          <span className="truncate text-slate-400">{item.label}</span>
        </div>
      ))}
    </div>
  )
}
