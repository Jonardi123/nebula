import type { TaskRun } from '../types/nebula'
import { writeLocalJson } from './safeStorage'

const TASKS_KEY = 'nebula-task-runs'

function readTasks() {
  try {
    return JSON.parse(localStorage.getItem(TASKS_KEY) ?? '[]') as TaskRun[]
  } catch {
    return []
  }
}

function writeTasks(tasks: TaskRun[]) {
  try {
    writeLocalJson(TASKS_KEY, tasks.slice(0, 60))
    window.dispatchEvent(new CustomEvent('nebula-tasks-changed'))
  } catch {
    // Task history is recoverable; keep active workflows alive.
  }
}

export function getTaskRuns() {
  return readTasks()
}

export function createTaskRun(goal: string): TaskRun {
  const now = new Date().toISOString()
  const task: TaskRun = {
    id: crypto.randomUUID(),
    goal,
    status: 'running',
    steps: [
      { id: crypto.randomUUID(), label: 'Understand goal', status: 'done' },
      { id: crypto.randomUUID(), label: 'Plan work', status: 'active' },
      { id: crypto.randomUUID(), label: 'Use tools if needed', status: 'pending' },
      { id: crypto.randomUUID(), label: 'Summarize result', status: 'pending' },
    ],
    files: [],
    commands: [],
    toolCalls: [],
    timeline: [
      {
        id: crypto.randomUUID(),
        type: 'user_prompt',
        label: 'Task created',
        detail: goal,
        timestamp: now,
      },
    ],
    sourceCardIds: [],
    createdAt: now,
    updatedAt: now,
  }
  writeTasks([task, ...readTasks()])
  return task
}

export function updateTaskRun(id: string, update: Partial<TaskRun>) {
  const tasks = readTasks()
  const next = tasks.map((task) =>
    task.id === id
      ? {
          ...task,
          ...update,
          updatedAt: new Date().toISOString(),
        }
      : task,
  )
  writeTasks(next)
  return next.find((task) => task.id === id)
}

export function getTaskRun(id: string) {
  return readTasks().find((task) => task.id === id) ?? null
}

export function recoverInterruptedTaskRuns() {
  const tasks = readTasks()
  let changed = false
  const now = new Date().toISOString()
  const next = tasks.map((task) => {
    if (task.status !== 'running') return task
    changed = true
    return {
      ...task,
      status: 'stopped' as const,
      finalResult: task.finalResult || 'Nebula restarted before this task finished. Review the replay timeline, then retry the remaining work as a new task.',
      timeline: [
        ...(task.timeline ?? []),
        {
          id: crypto.randomUUID(),
          type: 'notification' as const,
          label: 'Task recovered after restart',
          detail: 'The unfinished task was safely stopped instead of resuming an old tool workflow automatically.',
          timestamp: now,
        },
      ],
      updatedAt: now,
    }
  })
  if (changed) writeTasks(next)
  return next
}
