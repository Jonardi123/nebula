import type { LogEvent } from '../types/agent'
import type { CommandCenterEvent, MemoryCoreCategory } from '../types/nebula'
import {
  createNebulaRoutine,
  deleteNebulaRoutine,
  getNebulaRoutineRuns,
  getNebulaRoutines,
  saveNebulaRoutine,
  toggleNebulaRoutine,
} from './automationRoutines'

const EVENTS_KEY = 'nebula-command-center-events'
const CHANGE_EVENT = 'nebula-command-center-changed'

export {
  createNebulaRoutine,
  deleteNebulaRoutine,
  getNebulaRoutineRuns,
  getNebulaRoutines,
  saveNebulaRoutine,
  toggleNebulaRoutine,
}

function fallbackId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function makeId(prefix: string) {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? `${prefix}-${crypto.randomUUID()}` : fallbackId(prefix)
}

function safeParseArray<T>(key: string): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function writeArray<T>(key: string, items: T[], limit = 160) {
  try {
    localStorage.setItem(key, JSON.stringify(items.slice(0, limit)))
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
  } catch {
    // Command Center state is local convenience data. App stability wins over persistence.
  }
}

function now() {
  return new Date().toISOString()
}

const seedEvents: CommandCenterEvent[] = [
  {
    id: 'seed-coding-agent',
    title: 'Coding agent started',
    detail: 'Coding lane is available through Nebula routing when a task involves files, code, or tools.',
    type: 'agent',
    status: 'success',
    source: 'system',
    createdAt: new Date(Date.now() - 1000 * 60 * 7).toISOString(),
  },
  {
    id: 'seed-memory-updated',
    title: 'Memory updated',
    detail: 'Memory Core categories map to the existing local markdown memory files.',
    type: 'memory',
    status: 'success',
    source: 'memory',
    createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
  },
  {
    id: 'seed-automation-queued',
    title: 'Automation queued',
    detail: 'Nebula Core routines are ready for manual, scheduled, and event triggers.',
    type: 'automation',
    status: 'queued',
    source: 'automation',
    createdAt: new Date(Date.now() - 1000 * 60 * 3).toISOString(),
  },
  {
    id: 'seed-file-scan',
    title: 'File scan completed',
    detail: 'Project file discovery is available through the existing Nebula workspace scanner.',
    type: 'file',
    status: 'success',
    source: 'workspace',
    createdAt: new Date(Date.now() - 1000 * 60).toISOString(),
  },
]

export function getMemoryCoreCategories(): MemoryCoreCategory[] {
  return [
    {
      id: 'preferences',
      label: 'Preferences',
      description: 'User choices, UI preferences, model routing preferences, and workflow defaults.',
      file: 'preferences.md',
      examples: ['preferred models', 'UI choices', 'approval style'],
    },
    {
      id: 'projects',
      label: 'Projects',
      description: 'Project-specific context, architecture notes, active goals, and decisions.',
      file: 'projects.md',
      examples: ['Nebula app notes', 'project commands', 'framework choices'],
    },
    {
      id: 'people',
      label: 'People',
      description: 'Useful user-specific context that is not secret or temporary.',
      file: 'user.md',
      examples: ['name', 'communication style', 'accessibility needs'],
    },
    {
      id: 'commands',
      label: 'Commands',
      description: 'Useful commands, verified scripts, and repeated local workflows.',
      file: 'commands.md',
      examples: ['build commands', 'test commands', 'safe checks'],
    },
    {
      id: 'mistakes',
      label: 'Mistakes',
      description: 'Repeated bugs, failed fixes, and lessons Nebula should avoid repeating.',
      file: 'lessons_learned.md',
      examples: ['bad assumptions', 'fixed regressions', 'known pitfalls'],
    },
    {
      id: 'facts',
      label: 'Facts',
      description: 'Verified facts and web-learned information with source URLs and check dates.',
      file: 'web_learnings.md',
      examples: ['source URL', 'date checked', 'needs verification notes'],
    },
  ]
}

export function recordCommandCenterEvent(input: Omit<CommandCenterEvent, 'id' | 'createdAt'>) {
  const event: CommandCenterEvent = {
    id: makeId('event'),
    createdAt: now(),
    ...input,
  }
  writeArray(EVENTS_KEY, [event, ...readStoredEvents()])
  return event
}

export function getCommandCenterEvents(logs: LogEvent[] = []) {
  const stored = readStoredEvents()
  const base = stored.length > 0 ? stored : seedEvents
  const observed = logs.slice(-28).map(logToCommandEvent)
  return [...observed, ...base]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 80)
}

function readStoredEvents() {
  return safeParseArray<CommandCenterEvent>(EVENTS_KEY)
}

function logToCommandEvent(log: LogEvent): CommandCenterEvent {
  const type =
    log.type === 'error'
      ? 'error'
      : log.type === 'memory'
        ? 'memory'
        : log.type === 'command'
          ? 'automation'
          : log.type === 'tool_request' || log.type === 'tool_result'
            ? 'agent'
            : log.type === 'status'
              ? 'system'
              : 'agent'
  return {
    id: `log-${log.id}`,
    title: titleForLog(log),
    detail: log.message,
    type,
    status: log.type === 'error' ? 'error' : log.type === 'tool_request' ? 'running' : 'success',
    source: log.type,
    createdAt: log.createdAt,
  }
}

function titleForLog(log: LogEvent) {
  if (log.type === 'tool_request') return 'Agent action requested'
  if (log.type === 'tool_result') return 'Agent action completed'
  if (log.type === 'memory') return 'Memory updated'
  if (log.type === 'command') return 'Command recorded'
  if (log.type === 'error') return 'Nebula error'
  if (log.type === 'user_message') return 'User request'
  if (log.type === 'ai_response') return 'Nebula response'
  return 'System event'
}
