import { Bug, Clock3, ListPlus, Play, RotateCcw, RotateCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getTaskRuns } from '../lib/tasks'
import { cancelQueuedTask, enqueueTask, getQueuedTasks, retryQueuedTask } from '../lib/taskQueue'
import type { QueuedTask, TaskRun } from '../types/nebula'

export function TasksPanel({
  onStartTask,
  onFixMyApp,
  onRunQueuedTask,
}: {
  onStartTask: (goal: string) => void
  onFixMyApp: (goal: string) => void
  onRunQueuedTask?: (id: string) => void
}) {
  const [goal, setGoal] = useState('')
  const [fixGoal, setFixGoal] = useState('')
  const [tasks, setTasks] = useState<TaskRun[]>([])
  const [queuedTasks, setQueuedTasks] = useState<QueuedTask[]>([])
  const [replayTaskId, setReplayTaskId] = useState('')
  const replayTask = tasks.find((task) => task.id === replayTaskId) ?? null

  function refresh() {
    setTasks(getTaskRuns())
    setQueuedTasks(getQueuedTasks())
  }

  function start() {
    const trimmed = goal.trim()
    if (!trimmed) return
    onStartTask(trimmed)
    setGoal('')
    window.setTimeout(refresh, 300)
  }

  function startFix() {
    const trimmed = fixGoal.trim() || 'Inspect this app, run safe checks, and produce a fix plan without editing files.'
    onFixMyApp(trimmed)
    setFixGoal('')
    window.setTimeout(refresh, 300)
  }

  function queueTask(kind: 'task' | 'fix') {
    const source = kind === 'fix' ? fixGoal : goal
    const fallback = kind === 'fix' ? 'Inspect this app, run safe checks, and propose a fix plan without editing files.' : ''
    const trimmed = source.trim() || fallback
    if (!trimmed) return
    enqueueTask(trimmed, kind, kind === 'fix' ? 'Fix My App' : 'Task')
    if (kind === 'fix') setFixGoal('')
    else setGoal('')
    refresh()
  }

  useEffect(() => {
    refresh()
    const listener = () => refresh()
    window.addEventListener('nebula-tasks-changed', listener)
    window.addEventListener('nebula-task-queue-changed', listener)
    return () => {
      window.removeEventListener('nebula-tasks-changed', listener)
      window.removeEventListener('nebula-task-queue-changed', listener)
    }
  }, [])

  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="rounded-md border border-slate-800 bg-slate-950 p-3">
        <textarea
          className="nebula-input min-h-24 w-full resize-none p-3 outline-none"
          placeholder="Describe a coding, research, or fixing task..."
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
        />
        <div className="mt-2 flex gap-2">
          <button className="nebula-button-primary flex flex-1 items-center justify-center gap-2 px-3 py-2" type="button" onClick={start}>
            <Play size={13} />
            Start Task
          </button>
          <button className="nebula-toggle flex items-center justify-center gap-1 px-3 py-2" type="button" onClick={() => queueTask('task')} title="Queue task">
            <ListPlus size={13} />
            Queue
          </button>
          <button className="nebula-toggle px-3 py-2" type="button" onClick={refresh}>
            <RotateCw size={13} />
          </button>
        </div>
      </div>

      <div className="rounded-md border border-cyan-300/20 bg-cyan-300/10 p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-cyan-50">
          <Bug size={14} />
          Fix My App
        </div>
        <textarea
          className="nebula-input min-h-20 w-full resize-none p-3 outline-none"
          placeholder="Paste an error, failing command, or goal. Nebula will inspect and propose a fix plan first."
          value={fixGoal}
          onChange={(event) => setFixGoal(event.target.value)}
        />
        <div className="mt-2 flex gap-2">
          <button className="nebula-button-primary flex flex-1 items-center justify-center gap-2 px-3 py-2" type="button" onClick={startFix}>
            <Play size={13} />
            Run Safe Diagnosis
          </button>
          <button className="nebula-toggle flex items-center justify-center gap-1 px-3 py-2" type="button" onClick={() => queueTask('fix')} title="Queue safe diagnosis">
            <ListPlus size={13} />
            Queue
          </button>
        </div>
      </div>

      <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Task Queue</h3>
            <p className="mt-1 text-[11px] text-slate-500">Queued tasks survive restarts. They only run when you start them.</p>
          </div>
          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-400">{queuedTasks.filter((task) => task.status === 'queued').length} waiting</span>
        </div>
        <div className="space-y-2">
          {queuedTasks.slice(-12).reverse().map((queued) => (
            <div key={queued.id} className="rounded-md border border-white/10 bg-black/20 p-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-200">{queued.label}</span>
                    <span className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] uppercase text-slate-500">{queued.status}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-400">{queued.goal}</p>
                  {queued.error && <p className="mt-1 text-[10px] text-amber-200">{queued.error}</p>}
                </div>
                {queued.status === 'queued' && <button className="nebula-toggle px-2 py-1" type="button" onClick={() => onRunQueuedTask?.(queued.id)} title="Run queued task"><Play size={11} /></button>}
                {queued.status === 'queued' && <button className="nebula-toggle px-2 py-1 text-slate-400" type="button" onClick={() => { cancelQueuedTask(queued.id); refresh() }} title="Cancel queued task"><X size={11} /></button>}
                {(queued.status === 'error' || queued.status === 'cancelled') && <button className="nebula-toggle px-2 py-1" type="button" onClick={() => { retryQueuedTask(queued.id); refresh() }} title="Retry queued task"><RotateCcw size={11} /></button>}
              </div>
            </div>
          ))}
          {queuedTasks.length === 0 && <div className="nebula-empty-state">Queue a task to run it later. Nebula will never resume it automatically after a restart.</div>}
        </div>
      </section>

      {replayTask && (
        <section className="rounded-md border border-fuchsia-300/25 bg-fuchsia-300/10 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-fuchsia-50">Run Replay</h3>
            <button className="nebula-toggle px-2 py-1" type="button" onClick={() => setReplayTaskId('')}>
              Close
            </button>
          </div>
          <div className="space-y-2">
            {(replayTask.timeline ?? []).map((event) => (
              <div key={event.id} className="rounded-md border border-white/10 bg-black/20 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-100">{event.label}</span>
                  <span className="text-[10px] text-slate-500">{new Date(event.timestamp).toLocaleTimeString()}</span>
                </div>
                <div className="mt-1 text-[11px] uppercase text-cyan-200/70">{event.type}</div>
                {event.detail && <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-300">{event.detail}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {tasks.map((task) => (
        <section key={task.id} className="skill-card rounded-md border border-slate-800 bg-slate-950 p-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-100">{task.goal}</h3>
            <span className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[11px] text-cyan-100">{task.status}</span>
          </div>
          <div className="mt-2 space-y-1">
            {task.steps.map((step) => (
              <div key={step.id} className="flex items-center gap-2 text-[11px] text-slate-400">
                <span className={`h-1.5 w-1.5 rounded-full ${step.status === 'done' ? 'bg-emerald-300' : step.status === 'active' ? 'bg-cyan-300' : step.status === 'error' ? 'bg-red-300' : 'bg-slate-600'}`} />
                {step.label}
              </div>
            ))}
          </div>
          {task.finalResult && <p className="mt-3 text-xs leading-5 text-slate-300">{task.finalResult}</p>}
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="text-[11px] text-slate-500">{new Date(task.createdAt).toLocaleString()}</div>
            <button className="nebula-toggle flex items-center gap-1 px-2 py-1 text-[11px]" type="button" onClick={() => setReplayTaskId(task.id)}>
              <Clock3 size={11} />
              Replay {(task.timeline ?? []).length}
            </button>
          </div>
        </section>
      ))}
    </div>
  )
}
