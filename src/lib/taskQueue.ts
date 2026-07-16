import type { QueuedTask, QueuedTaskKind, QueuedTaskStatus } from '../types/nebula'
import { writeLocalJson } from './safeStorage'

const TASK_QUEUE_KEY = 'nebula-task-queue'
const MAX_QUEUE_ITEMS = 80

function readQueue(): QueuedTask[] {
  try {
    const raw = localStorage.getItem(TASK_QUEUE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is QueuedTask => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.goal === 'string'))
      .map((item) => ({
        ...item,
        kind: ['task', 'fix', 'quick_action'].includes(item.kind) ? item.kind : 'task',
        status: ['queued', 'running', 'done', 'error', 'cancelled'].includes(item.status) ? item.status : 'queued',
        label: item.label || item.goal.slice(0, 72) || 'Queued task',
        attempts: Number.isFinite(item.attempts) ? Math.max(0, item.attempts) : 0,
      }))
      .slice(0, MAX_QUEUE_ITEMS)
  } catch {
    return []
  }
}

function writeQueue(items: QueuedTask[]) {
  try {
    writeLocalJson(TASK_QUEUE_KEY, items.slice(0, MAX_QUEUE_ITEMS))
    window.dispatchEvent(new CustomEvent('nebula-task-queue-changed'))
  } catch {
    // Queue persistence is optional and must not interrupt a running task.
  }
}

export function getQueuedTasks() {
  return readQueue()
}

export function enqueueTask(goal: string, kind: QueuedTaskKind = 'task', label?: string) {
  const createdAt = new Date().toISOString()
  const task: QueuedTask = {
    id: crypto.randomUUID(),
    kind,
    goal: goal.trim(),
    label: label?.trim() || (kind === 'fix' ? 'Fix My App' : kind === 'quick_action' ? 'Quick Action' : 'Task'),
    status: 'queued',
    createdAt,
    updatedAt: createdAt,
    attempts: 0,
  }
  writeQueue([...readQueue(), task])
  return task
}

export function updateQueuedTask(id: string, update: Partial<QueuedTask>) {
  const next = readQueue().map((task) => (task.id === id ? { ...task, ...update, updatedAt: new Date().toISOString() } : task))
  writeQueue(next)
  return next.find((task) => task.id === id) ?? null
}

export function cancelQueuedTask(id: string) {
  return updateQueuedTask(id, { status: 'cancelled', completedAt: new Date().toISOString() })
}

export function removeQueuedTask(id: string) {
  writeQueue(readQueue().filter((task) => task.id !== id))
}

export function retryQueuedTask(id: string) {
  return updateQueuedTask(id, { status: 'queued', error: undefined, startedAt: undefined, completedAt: undefined })
}

export function getNextQueuedTask() {
  return readQueue().find((task) => task.status === 'queued') ?? null
}

export function markInterruptedTasksRecoverable() {
  const tasks = readQueue()
  let changed = false
  const next = tasks.map((task) => {
    if (task.status !== 'running') return task
    changed = true
    return {
      ...task,
      status: 'queued' as QueuedTaskStatus,
      error: 'Nebula restarted before this queued task completed. It is ready to retry.',
      updatedAt: new Date().toISOString(),
    }
  })
  if (changed) writeQueue(next)
  return next
}
