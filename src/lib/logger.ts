import type { LogEvent } from '../types/agent'

export type { LogEvent } from '../types/agent'

export function createLog(type: LogEvent['type'], message: string, details?: unknown): LogEvent {
  return {
    id: crypto.randomUUID(),
    type,
    message,
    details,
    createdAt: new Date().toISOString(),
  }
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
