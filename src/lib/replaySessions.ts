import { getTimelineItems } from './timeline'
import type { LogEvent } from '../types/agent'
import type { TimelineItem } from '../types/nebula'

export interface ReplaySession {
  id: string
  title: string
  startedAt: string
  endedAt: string
  items: TimelineItem[]
}

export function getReplaySessions(logs: LogEvent[] = []): ReplaySession[] {
  const items = getTimelineItems(logs).slice().reverse()
  const sessions: ReplaySession[] = []
  let current: TimelineItem[] = []

  for (const item of items) {
    const startsSession = item.title === 'User request' || item.type === 'user prompt' || item.title.includes('Task created')
    if (startsSession && current.length) {
      sessions.push(makeSession(current))
      current = []
    }
    current.push(item)
  }
  if (current.length) sessions.push(makeSession(current))
  return sessions.reverse().slice(0, 50)
}

function makeSession(items: TimelineItem[]): ReplaySession {
  const first = items[0]
  const last = items[items.length - 1]
  const title = first.details.find((detail) => detail.label === 'Summary' || detail.label === 'Task')?.value.slice(0, 80) || first.title
  return {
    id: `${first.id}:${last.id}`,
    title,
    startedAt: first.time,
    endedAt: last.time,
    items,
  }
}
