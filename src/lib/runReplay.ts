import type { TaskTimelineEvent } from '../types/nebula'
import { getTaskRun, updateTaskRun } from './tasks'

export function createTimelineEvent(update: Omit<TaskTimelineEvent, 'id' | 'timestamp'>): TaskTimelineEvent {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...update,
  }
}

export function appendTaskEvent(taskId: string | undefined, update: Omit<TaskTimelineEvent, 'id' | 'timestamp'>) {
  if (!taskId) return null
  const task = getTaskRun(taskId)
  if (!task) return null
  const event = createTimelineEvent(update)
  updateTaskRun(taskId, {
    timeline: [...(task.timeline ?? []), event],
  })
  return event
}

export function attachTaskSourceCard(taskId: string | undefined, sourceCardId: string) {
  if (!taskId) return null
  const task = getTaskRun(taskId)
  if (!task) return null
  const sourceCardIds = Array.from(new Set([...(task.sourceCardIds ?? []), sourceCardId]))
  return updateTaskRun(taskId, { sourceCardIds })
}

export function recordTaskArtifact(taskId: string | undefined, artifact: { file?: string; command?: string; tool?: string }) {
  if (!taskId) return null
  const task = getTaskRun(taskId)
  if (!task) return null

  return updateTaskRun(taskId, {
    files: artifact.file ? Array.from(new Set([...(task.files ?? []), artifact.file])) : task.files,
    commands: artifact.command ? Array.from(new Set([...(task.commands ?? []), artifact.command])) : task.commands,
    toolCalls: artifact.tool ? [...(task.toolCalls ?? []), artifact.tool].slice(-80) : task.toolCalls,
  })
}
