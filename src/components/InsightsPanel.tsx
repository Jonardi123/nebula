import { BarChart3, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getInsightMetrics } from '../lib/insights'
import type { LogEvent } from '../types/agent'
import type { InsightMetric } from '../types/nebula'

export function InsightsPanel({ logs }: { logs: LogEvent[] }) {
  const [metrics, setMetrics] = useState<InsightMetric[]>(() => getInsightMetrics(logs))

  function refresh() {
    setMetrics(getInsightMetrics(logs))
  }

  useEffect(() => {
    refresh()
    const events = ['nebula-diagnostics-changed', 'nebula-skills-runtime-changed', 'nebula-tasks-changed', 'nebula-quick-actions-changed']
    events.forEach((event) => window.addEventListener(event, refresh))
    return () => events.forEach((event) => window.removeEventListener(event, refresh))
  }, [logs])

  return (
    <div className="space-y-3 p-3 text-xs">
      <button className="nebula-button-primary flex w-full items-center justify-center gap-2 px-3 py-2" onClick={refresh}>
        <RefreshCw size={13} />
        Refresh Insights
      </button>
      <div className="grid grid-cols-2 gap-3">
        {metrics.map((metric, index) => (
          <section key={metric.id} className={`insight-card insight-${metric.tone ?? 'neutral'}`}>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-slate-500">
              <BarChart3 size={12} />
              {metric.label}
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-50">{metric.value}</div>
            {metric.detail && <div className="mt-1 truncate text-[11px] text-slate-500">{metric.detail}</div>}
            <div className="mt-3 h-1.5 rounded-full bg-white/5">
              <span className="block h-full rounded-full bg-gradient-to-r from-cyan-300 to-fuchsia-300" style={{ width: `${Math.min(100, 24 + index * 8)}%` }} />
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
