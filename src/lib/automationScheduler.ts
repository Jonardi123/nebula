import type { LogEvent } from '../types/agent'
import type { NebulaRoutine, NebulaRoutineTriggerType, WorkspaceAwarenessSnapshot } from '../types/nebula'
import type { AppSettings } from '../types/settings'
import { getNebulaRoutines, getRoutinesForTrigger } from './automationRoutines'
import { runNebulaRoutineQueued } from './automationRunner'

interface SchedulerContext {
  lmOnline: boolean
  workspaceAwareness?: WorkspaceAwarenessSnapshot | null
  onLog?: (type: LogEvent['type'], message: string, details?: unknown) => void
}

const startupRuns = new Set<string>()
const triggerGuards = new Map<string, string>()

function shouldRunScheduled(routine: NebulaRoutine, nowDate = new Date()) {
  const time = routine.trigger.timeOfDay ?? '09:00'
  const [hourText, minuteText] = time.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false
  return nowDate.getHours() === hour && nowDate.getMinutes() === minute
}

function runRoutine(routine: NebulaRoutine, settings: AppSettings, context: SchedulerContext, triggerType: NebulaRoutineTriggerType) {
  return runNebulaRoutineQueued(
    routine,
    settings,
    {
      lmOnline: context.lmOnline,
      projectFolder: settings.projectFolder,
      workspaceAwareness: context.workspaceAwareness,
    },
    { onLog: context.onLog },
    triggerType,
  )
}

export function runTriggeredRoutines(settings: AppSettings, triggerType: NebulaRoutineTriggerType, context: SchedulerContext) {
  if (!settings.nebulaCoreEnabled || !settings.automationSchedulerEnabled) return []
  if (settings.automationConfirmationMode === 'manual_only' && triggerType !== 'manual') return []
  const keyValue =
    triggerType === 'project_opened'
      ? settings.projectFolder
      : triggerType === 'lmstudio_online' || triggerType === 'lmstudio_offline'
        ? `${triggerType}:${context.lmOnline}`
        : triggerType
  const guardKey = `${triggerType}:${keyValue}`
  if (triggerGuards.get(triggerType) === guardKey && triggerType !== 'manual') return []
  triggerGuards.set(triggerType, guardKey)

  return getRoutinesForTrigger(triggerType).map((routine) => runRoutine(routine, settings, context, triggerType))
}

export function runStartupRoutines(settings: AppSettings, context: SchedulerContext) {
  if (!settings.nebulaCoreEnabled || !settings.automationSchedulerEnabled) return []
  if (settings.automationConfirmationMode === 'manual_only') return []
  return getRoutinesForTrigger('app_startup')
    .filter((routine) => {
      if (startupRuns.has(routine.id)) return false
      startupRuns.add(routine.id)
      return true
    })
    .map((routine) => runRoutine(routine, settings, context, 'app_startup'))
}

export function startAutomationScheduler(settings: AppSettings, context: SchedulerContext) {
  if (!settings.nebulaCoreEnabled || !settings.automationSchedulerEnabled) return () => undefined
  if (settings.automationConfirmationMode === 'manual_only') return () => undefined
  const timers: number[] = []

  timers.push(
    window.setInterval(() => {
      const routines = getNebulaRoutines()
      for (const routine of routines) {
        if (!routine.enabled) continue
        if (routine.trigger.type === 'scheduled_time' && shouldRunScheduled(routine)) {
          const guard = `${routine.id}:${new Date().toDateString()}:${routine.trigger.timeOfDay}`
          if (triggerGuards.get(routine.id) === guard) continue
          triggerGuards.set(routine.id, guard)
          void runRoutine(routine, settings, context, 'scheduled_time')
        }
      }
    }, 30_000),
  )

  for (const routine of getRoutinesForTrigger('interval')) {
    const minutes = Math.max(1, routine.trigger.intervalMinutes ?? 30)
    timers.push(
      window.setInterval(() => {
        void runRoutine(routine, settings, context, 'interval')
      }, minutes * 60_000),
    )
  }

  return () => {
    for (const timer of timers) window.clearInterval(timer)
  }
}
