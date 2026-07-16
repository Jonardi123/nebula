import { Play, Zap } from 'lucide-react'
import { getQuickActions } from '../lib/quickActions'

export function QuickActionsPanel({
  onRun,
}: {
  onRun: (actionId: string, target?: string, source?: string) => void
}) {
  return (
    <div className="space-y-3 p-3 text-xs">
      {getQuickActions().map((action) => (
        <section key={action.id} className="quick-action-list-card">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <Zap size={14} className="text-cyan-200" />
                {action.label}
              </div>
              <p className="mt-1 text-slate-400">{action.description}</p>
            </div>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${action.risk === 'safe' ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-200' : 'border-amber-300/25 bg-amber-300/10 text-amber-200'}`}>
              {action.risk}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {action.preferredSkills.map((skill) => (
              <span key={skill} className="rounded-full border border-white/10 bg-white/[0.035] px-2 py-1 text-[11px] text-slate-400">{skill}</span>
            ))}
          </div>
          <button className="nebula-button-primary mt-3 flex w-full items-center justify-center gap-2 px-3 py-2" onClick={() => onRun(action.id, undefined, 'quick-actions-panel')}>
            <Play size={13} />
            Run
          </button>
        </section>
      ))}
    </div>
  )
}
