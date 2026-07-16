import type {
  NebulaRoutine,
  NebulaRoutineRiskLevel,
  NebulaRoutineRun,
  NebulaRoutineRunStatus,
  NebulaRoutineStep,
  NebulaRoutineStepType,
  NebulaRoutineTrigger,
  NebulaRoutineTriggerType,
} from '../types/nebula'

const ROUTINES_KEY = 'nebula-command-center-automations'
const RUNS_KEY = 'nebula-command-center-runs'
const CHANGE_EVENT = 'nebula-command-center-changed'
const runStatuses = ['queued', 'running', 'done', 'error', 'cancelled'] as const
const riskLevels = ['safe', 'needs_confirmation', 'high_risk', 'blocked'] as const

export const STEP_LABELS: Record<NebulaRoutineStepType, string> = {
  refresh_diagnostics: 'Refresh diagnostics',
  search_memory: 'Search Memory Core',
  summarize_project: 'Summarize active project',
  open_known_app: 'Open known app',
  web_search: 'Web search',
  web_fetch: 'Fetch webpage text',
  run_safe_command: 'Run safe command',
  send_notification: 'Send notification',
  ask_user: 'Ask for input',
  placeholder: 'Future connector placeholder',
}

export const TRIGGER_LABELS: Record<NebulaRoutineTriggerType, string> = {
  manual: 'Manual',
  app_startup: 'App startup',
  scheduled_time: 'Scheduled time',
  interval: 'Interval',
  lmstudio_online: 'LM Studio online',
  lmstudio_offline: 'LM Studio offline',
  project_opened: 'Project opened',
}

function fallbackId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function makeAutomationId(prefix: string) {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? `${prefix}-${crypto.randomUUID()}` : fallbackId(prefix)
}

function now() {
  return new Date().toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRunStatus(value: unknown): value is NebulaRoutineRunStatus {
  return typeof value === 'string' && runStatuses.includes(value as NebulaRoutineRunStatus)
}

function isRiskLevel(value: unknown): value is NebulaRoutineRiskLevel {
  return typeof value === 'string' && riskLevels.includes(value as NebulaRoutineRiskLevel)
}

function isTriggerType(value: unknown): value is NebulaRoutineTriggerType {
  return typeof value === 'string' && value in TRIGGER_LABELS
}

function readArray<T>(key: string): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function writeArray<T>(key: string, items: T[], limit = 200) {
  try {
    localStorage.setItem(key, JSON.stringify(items.slice(0, limit)))
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
  } catch {
    // Local automation state is best-effort.
  }
}

function stepRisk(type: NebulaRoutineStepType): NebulaRoutineRiskLevel {
  if (type === 'run_safe_command') return 'needs_confirmation'
  if (type === 'open_known_app') return 'needs_confirmation'
  if (type === 'placeholder') return 'blocked'
  return 'safe'
}

export function createRoutineStep(type: NebulaRoutineStepType, input = ''): NebulaRoutineStep {
  return {
    id: makeAutomationId('step'),
    type,
    label: STEP_LABELS[type],
    input,
    enabled: true,
    riskLevel: stepRisk(type),
    disabled: type === 'placeholder',
    note: type === 'placeholder' ? 'Requires future connector and approval system.' : undefined,
  }
}

function maxRisk(steps: NebulaRoutineStep[]): NebulaRoutineRiskLevel {
  if (steps.some((step) => step.riskLevel === 'blocked')) return 'blocked'
  if (steps.some((step) => step.riskLevel === 'high_risk')) return 'high_risk'
  if (steps.some((step) => step.riskLevel === 'needs_confirmation')) return 'needs_confirmation'
  return 'safe'
}

function normalizeTrigger(value: unknown): NebulaRoutineTrigger {
  const trigger = isRecord(value) ? value : {}
  const type = typeof trigger.type === 'string' && trigger.type in TRIGGER_LABELS ? (trigger.type as NebulaRoutineTriggerType) : 'manual'
  const intervalMinutes = Number(trigger.intervalMinutes)
  return {
    type,
    timeOfDay: typeof trigger.timeOfDay === 'string' ? trigger.timeOfDay : '09:00',
    intervalMinutes: Number.isFinite(intervalMinutes) ? Math.max(1, Math.round(intervalMinutes)) : 30,
  }
}

function normalizeStep(value: unknown): NebulaRoutineStep {
  const step = isRecord(value) ? value : {}
  const legacyKind = typeof step.kind === 'string' ? step.kind : ''
  const type =
    typeof step.type === 'string' && step.type in STEP_LABELS
      ? (step.type as NebulaRoutineStepType)
      : legacyKind === 'diagnostic'
        ? 'refresh_diagnostics'
        : legacyKind === 'memory'
          ? 'search_memory'
          : legacyKind === 'project'
            ? 'summarize_project'
            : legacyKind === 'model'
              ? 'send_notification'
              : legacyKind === 'placeholder'
                ? 'placeholder'
                : 'send_notification'
  const enabled = typeof step.enabled === 'boolean' ? step.enabled : !step.disabled
  const riskLevel = isRiskLevel(step.riskLevel) ? step.riskLevel : stepRisk(type)
  return {
    id: typeof step.id === 'string' ? step.id : makeAutomationId('step'),
    type,
    label: typeof step.label === 'string' ? step.label : STEP_LABELS[type],
    input: typeof step.input === 'string' ? step.input : '',
    enabled,
    riskLevel,
    disabled: step.disabled === true || riskLevel === 'blocked',
    note: typeof step.note === 'string' ? step.note : undefined,
  }
}

function normalizeRoutine(value: unknown): NebulaRoutine {
  const routine = isRecord(value) ? value : {}
  const timestamp = now()
  const steps = Array.isArray(routine.steps) ? routine.steps.map(normalizeStep) : [createRoutineStep('send_notification', '')]
  const riskLevel = isRiskLevel(routine.riskLevel) ? routine.riskLevel : maxRisk(steps)
  return {
    id: typeof routine.id === 'string' ? routine.id : makeAutomationId('routine'),
    name: typeof routine.name === 'string' ? routine.name : 'Untitled routine',
    description: typeof routine.description === 'string' ? routine.description : 'Local Nebula automation routine.',
    enabled: typeof routine.enabled === 'boolean' ? routine.enabled : true,
    trigger: normalizeTrigger(routine.trigger),
    steps,
    riskLevel,
    createdAt: typeof routine.createdAt === 'string' ? routine.createdAt : timestamp,
    updatedAt: typeof routine.updatedAt === 'string' ? routine.updatedAt : timestamp,
    runHistory: Array.isArray(routine.runHistory) ? routine.runHistory.filter((item): item is string => typeof item === 'string') : [],
    lastRunAt: typeof routine.lastRunAt === 'string' ? routine.lastRunAt : undefined,
    lastRunStatus: isRunStatus(routine.lastRunStatus) ? routine.lastRunStatus : undefined,
  }
}

const seedRoutines: NebulaRoutine[] = [
  {
    id: 'routine-system-check',
    name: 'System check',
    description: 'Refresh diagnostics, verify Memory Core, and report local service state.',
    enabled: true,
    trigger: { type: 'manual', timeOfDay: '09:00', intervalMinutes: 30 },
    riskLevel: 'safe',
    createdAt: now(),
    updatedAt: now(),
    runHistory: [],
    steps: [
      createRoutineStep('refresh_diagnostics'),
      createRoutineStep('search_memory', 'Nebula preferences project commands'),
      createRoutineStep('send_notification', 'Nebula Core system check finished.'),
    ],
  },
  {
    id: 'routine-project-warmup',
    name: 'Project warmup',
    description: 'Summarize active project context when a project opens.',
    enabled: true,
    trigger: { type: 'project_opened', timeOfDay: '09:00', intervalMinutes: 30 },
    riskLevel: 'safe',
    createdAt: now(),
    updatedAt: now(),
    runHistory: [],
    steps: [
      createRoutineStep('summarize_project'),
      createRoutineStep('search_memory', 'project fixes commands mistakes'),
      createRoutineStep('send_notification', 'Project warmup is ready.'),
    ],
  },
  {
    id: 'routine-open-notepad',
    name: 'Open Notepad beta',
    description: 'Desktop Control Beta sample for launching a known safe app.',
    enabled: false,
    trigger: { type: 'manual', timeOfDay: '09:00', intervalMinutes: 30 },
    riskLevel: 'needs_confirmation',
    createdAt: now(),
    updatedAt: now(),
    runHistory: [],
    steps: [createRoutineStep('open_known_app', 'notepad')],
  },
]

export function getNebulaRoutines() {
  const stored = readArray<unknown>(ROUTINES_KEY)
  if (stored.length > 0) {
    const normalized = stored.map(normalizeRoutine)
    if (JSON.stringify(stored) !== JSON.stringify(normalized)) writeArray(ROUTINES_KEY, normalized)
    return normalized
  }
  writeArray(ROUTINES_KEY, seedRoutines)
  return seedRoutines
}

export function saveNebulaRoutine(routine: NebulaRoutine) {
  const normalized = normalizeRoutine({ ...routine, updatedAt: now(), riskLevel: maxRisk(routine.steps) })
  const routines = getNebulaRoutines()
  const exists = routines.some((item) => item.id === normalized.id)
  writeArray(ROUTINES_KEY, exists ? routines.map((item) => (item.id === normalized.id ? normalized : item)) : [normalized, ...routines])
  return normalized
}

export function createNebulaRoutine(input: {
  name: string
  description: string
  trigger: NebulaRoutineTrigger
  steps: NebulaRoutineStep[]
  enabled?: boolean
}) {
  const timestamp = now()
  return saveNebulaRoutine({
    id: makeAutomationId('routine'),
    name: input.name.trim() || 'Untitled routine',
    description: input.description.trim() || 'Local Nebula automation routine.',
    trigger: normalizeTrigger(input.trigger),
    steps: input.steps.length > 0 ? input.steps : [createRoutineStep('send_notification')],
    enabled: input.enabled ?? true,
    riskLevel: maxRisk(input.steps),
    runHistory: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}

export function deleteNebulaRoutine(id: string) {
  writeArray(
    ROUTINES_KEY,
    getNebulaRoutines().filter((routine) => routine.id !== id),
  )
}

export function toggleNebulaRoutine(id: string, enabled: boolean) {
  const routine = getNebulaRoutines().find((item) => item.id === id)
  if (!routine) return null
  return saveNebulaRoutine({ ...routine, enabled })
}

export function getNebulaRoutineRuns() {
  return readArray<NebulaRoutineRun>(RUNS_KEY).map(normalizeRun)
}

export function saveNebulaRoutineRun(run: NebulaRoutineRun) {
  const normalized = normalizeRun(run)
  const runs = getNebulaRoutineRuns()
  const exists = runs.some((item) => item.id === normalized.id)
  writeArray(RUNS_KEY, exists ? runs.map((item) => (item.id === normalized.id ? normalized : item)) : [normalized, ...runs], 240)

  const routines = getNebulaRoutines()
  const routine = routines.find((item) => item.id === normalized.routineId)
  if (routine) {
    saveNebulaRoutine({
      ...routine,
      lastRunAt: normalized.completedAt ?? normalized.startedAt ?? normalized.createdAt,
      lastRunStatus: normalized.status,
      runHistory: [normalized.id, ...routine.runHistory.filter((id) => id !== normalized.id)].slice(0, 30),
    })
  }
  return normalized
}

function normalizeRun(value: unknown): NebulaRoutineRun {
  const run = isRecord(value) ? value : {}
  const status = isRunStatus(run.status) ? run.status : 'queued'
  const createdAt = typeof run.createdAt === 'string' ? run.createdAt : now()
  return {
    id: typeof run.id === 'string' ? run.id : makeAutomationId('run'),
    routineId: typeof run.routineId === 'string' ? run.routineId : '',
    routineName: typeof run.routineName === 'string' ? run.routineName : 'Unknown routine',
    triggerType: isTriggerType(run.triggerType) ? run.triggerType : 'manual',
    status,
    summary: typeof run.summary === 'string' ? run.summary : '',
    stepResults: Array.isArray(run.stepResults) ? run.stepResults : [],
    createdAt,
    startedAt: typeof run.startedAt === 'string' ? run.startedAt : undefined,
    completedAt: typeof run.completedAt === 'string' ? run.completedAt : undefined,
    error: typeof run.error === 'string' ? run.error : undefined,
  }
}

export function getRoutinesForTrigger(type: NebulaRoutineTriggerType) {
  return getNebulaRoutines().filter((routine) => routine.enabled && routine.trigger.type === type)
}
