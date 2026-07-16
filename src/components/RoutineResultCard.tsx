import { AlertTriangle, CheckCircle2, Clock3, RotateCcw } from 'lucide-react'
import type { NebulaRoutineRun, RoutineResultCardModel } from '../types/nebula'

function parseTime(value?: string) {
  if (!value) return undefined
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : undefined
}

function formatDuration(ms?: number) {
  if (ms === undefined) return 'n/a'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function routineRunToCard(run: NebulaRoutineRun): RoutineResultCardModel {
  const started = parseTime(run.startedAt ?? run.createdAt)
  const completed = parseTime(run.completedAt)
  const failedSteps = run.stepResults.filter((step) => step.status === 'error').length
  const warningSteps = run.stepResults.filter((step) => step.status === 'warning' || step.status === 'cancelled').length
  const completedSteps = run.stepResults.filter((step) => step.status === 'success').length
  return {
    id: run.id,
    routineName: run.routineName,
    status: run.status,
    durationMs: started !== undefined && completed !== undefined ? completed - started : undefined,
    summary: run.summary || run.error || 'Routine result recorded locally.',
    completedSteps,
    failedSteps,
    warningSteps,
    totalSteps: run.stepResults.length,
    createdAt: run.createdAt,
    nextAction: run.status === 'error' ? 'retry' : run.status === 'cancelled' ? 'inspect' : 'none',
  }
}

export function RoutineResultCard({
  run,
  onRetry,
  onInspect,
}: {
  run: NebulaRoutineRun
  onRetry?: () => void
  onInspect?: () => void
}) {
  const card = routineRunToCard(run)
  const Icon = card.status === 'done' ? CheckCircle2 : card.status === 'error' ? AlertTriangle : Clock3
  return (
    <section className={`routine-result-card routine-result-${card.status}`}>
      <div className="flex items-start gap-3">
        <Icon size={17} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <strong className="truncate">{card.routineName}</strong>
            <span>{card.status}</span>
          </div>
          <p>{card.summary}</p>
          <div className="routine-result-metrics">
            <span>{card.completedSteps}/{card.totalSteps} done</span>
            <span>{card.failedSteps} failed</span>
            <span>{card.warningSteps} warnings</span>
            <span>{formatDuration(card.durationMs)}</span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        {onInspect && (
          <button type="button" onClick={onInspect}>
            Inspect
          </button>
        )}
        {card.nextAction === 'retry' && onRetry && (
          <button type="button" onClick={onRetry}>
            <RotateCcw size={12} />
            Retry
          </button>
        )}
      </div>
    </section>
  )
}
