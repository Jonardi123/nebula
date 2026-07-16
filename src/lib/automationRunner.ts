import type { LogEvent } from '../types/agent'
import type { NebulaRoutine, NebulaRoutineRun, NebulaRoutineStep, NebulaRoutineStepResult, NebulaRoutineTriggerType, WorkspaceAwarenessSnapshot } from '../types/nebula'
import type { AppSettings } from '../types/settings'
import { runCommand } from './commandRunner'
import { classifyCommand } from './commandSafety'
import { openKnownDesktopApp, runBrowserBetaAction } from './desktopControlBeta'
import { searchMemoryIndex } from './memoryIndex'
import { notify } from './notifications'
import { getResourceSnapshot } from './resourceDiagnostics'
import { webFetch, webSearch } from './web'
import { makeAutomationId, saveNebulaRoutineRun } from './automationRoutines'
import { recordCommandCenterEvent } from './commandCenter'

export interface AutomationRunnerContext {
  projectFolder?: string
  lmOnline?: boolean
  workspaceAwareness?: WorkspaceAwarenessSnapshot | null
}

interface AutomationRunnerCallbacks {
  onLog?: (type: LogEvent['type'], message: string, details?: unknown) => void
}

let queue: Promise<unknown> = Promise.resolve()
let activeRunId = ''
let stopRequested = false

function now() {
  return new Date().toISOString()
}

function clip(value: string, limit = 1200) {
  const trimmed = value.trim()
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}...` : trimmed
}

export function stopAutomationRunner() {
  stopRequested = true
  return activeRunId
}

export function runNebulaRoutineQueued(
  routine: NebulaRoutine,
  settings: AppSettings,
  context: AutomationRunnerContext,
  callbacks: AutomationRunnerCallbacks = {},
  triggerType: NebulaRoutineTriggerType = routine.trigger.type,
) {
  const next = queue.then(() => runNebulaRoutine(routine, settings, context, callbacks, triggerType))
  queue = next.catch(() => undefined)
  return next
}

async function runNebulaRoutine(
  routine: NebulaRoutine,
  settings: AppSettings,
  context: AutomationRunnerContext,
  callbacks: AutomationRunnerCallbacks,
  triggerType: NebulaRoutineTriggerType,
) {
  if (settings.automationConfirmationMode === 'manual_only' && triggerType !== 'manual') {
    throw new Error('Automation confirmation mode is manual only.')
  }

  stopRequested = false
  const timestamp = now()
  const run: NebulaRoutineRun = {
    id: makeAutomationId('run'),
    routineId: routine.id,
    routineName: routine.name,
    triggerType,
    status: 'running',
    summary: 'Routine running.',
    stepResults: routine.steps.map((step) => ({
      id: makeAutomationId('result'),
      stepId: step.id,
      label: step.label,
      type: step.type,
      status: step.enabled && !step.disabled ? 'pending' : 'skipped',
    })),
    createdAt: timestamp,
    startedAt: timestamp,
  }

  activeRunId = run.id
  saveNebulaRoutineRun(run)
  recordCommandCenterEvent({
    title: 'Routine started',
    detail: routine.name,
    type: 'automation',
    status: 'running',
    source: 'automation',
  })
  callbacks.onLog?.('status', `Routine started: ${routine.name}`, run)

  for (const [index, step] of routine.steps.entries()) {
    if (stopRequested) {
      run.status = 'cancelled'
      run.summary = 'Routine cancelled by user.'
      markResult(run, index, { status: 'cancelled', completedAt: now(), error: 'Cancelled.' })
      break
    }

    if (!step.enabled || step.disabled) {
      markResult(run, index, { status: 'skipped', completedAt: now(), output: step.note ?? 'Step disabled.' })
      continue
    }

    markResult(run, index, { status: 'running', startedAt: now() })
    saveNebulaRoutineRun(run)

    try {
      const output = await executeStep(step, settings, context)
      markResult(run, index, { status: 'success', output: clip(output), completedAt: now() })
      callbacks.onLog?.('status', `Routine step finished: ${step.label}`, { routine: routine.name, output })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      markResult(run, index, { status: 'error', error: message, completedAt: now() })
      run.status = 'error'
      run.error = message
      run.summary = `Routine failed at "${step.label}": ${message}`
      callbacks.onLog?.('error', run.summary, { routine: routine.name, step })
      break
    }
  }

  if (run.status === 'running') {
    run.status = 'done'
    run.summary = `${routine.name} completed.`
  }
  run.completedAt = now()
  activeRunId = ''
  saveNebulaRoutineRun(run)
  recordCommandCenterEvent({
    title: run.status === 'done' ? 'Routine completed' : run.status === 'cancelled' ? 'Routine cancelled' : 'Routine failed',
    detail: run.summary,
    type: 'automation',
    status: run.status === 'done' ? 'success' : run.status === 'cancelled' ? 'warning' : 'error',
    source: 'automation',
  })
  callbacks.onLog?.(run.status === 'error' ? 'error' : 'status', run.summary, run)
  return run
}

function markResult(run: NebulaRoutineRun, index: number, update: Partial<NebulaRoutineStepResult>) {
  run.stepResults = run.stepResults.map((result, resultIndex) => (resultIndex === index ? { ...result, ...update } : result))
}

async function executeStep(step: NebulaRoutineStep, settings: AppSettings, context: AutomationRunnerContext) {
  const input = step.input?.trim() ?? ''
  if (step.riskLevel === 'blocked') throw new Error(step.note ?? 'Step is blocked.')
  if (settings.automationConfirmationMode === 'safe_only' && step.riskLevel !== 'safe') {
    throw new Error(`Step requires confirmation but automation mode is safe-only: ${step.label}`)
  }

  if (step.type === 'refresh_diagnostics') {
    const snapshot = await getResourceSnapshot()
    return `CPU ${snapshot.cpuLoadPercent ?? 'n/a'}%, RAM free ${snapshot.ramAvailableMb ?? 'n/a'} MB, process ${snapshot.processWorkingSetMb ?? 'n/a'} MB.`
  }

  if (step.type === 'search_memory') {
    const query = input || step.label
    const results = await searchMemoryIndex(settings.memoryFolder, query, 6)
    return results.map((result) => `${result.file}:${result.line} ${result.text}`).join('\n') || 'No memory matches.'
  }

  if (step.type === 'summarize_project') {
    const workspace = context.workspaceAwareness
    if (!workspace) return `No active project snapshot. Project folder: ${settings.projectFolder || 'none'}`
    return [
      `Project: ${workspace.projectName}`,
      `Framework: ${workspace.detectedFramework ?? 'unknown'}`,
      `Package manager: ${workspace.packageManager ?? 'unknown'}`,
      `Recent files: ${workspace.recentFiles.slice(0, 5).join(', ') || 'none'}`,
      `Recent errors: ${workspace.recentErrors.map((item) => item.title).slice(0, 3).join(', ') || 'none'}`,
    ].join('\n')
  }

  if (step.type === 'open_known_app') {
    return openKnownDesktopApp(input || 'notepad', settings)
  }

  if (step.type === 'web_search') {
    const results = await webSearch(input || step.label, 4)
    return results.map((result) => `${result.title} - ${result.url}`).join('\n') || 'No web results.'
  }

  if (step.type === 'web_fetch') {
    if (!input) throw new Error('web_fetch step requires a URL.')
    const result = await webFetch(input, settings.memoryFolder)
    return `${result.title}: ${result.summary}`
  }

  if (step.type === 'run_safe_command') {
    if (!input) throw new Error('Command step requires a command.')
    const safety = classifyCommand(input)
    if (safety.level === 'blocked' || safety.level === 'high_risk') throw new Error(`Blocked command: ${safety.reason}`)
    if (safety.level !== 'safe') throw new Error(`Command requires manual confirmation: ${safety.reason}`)
    const cwd = settings.projectFolder || context.projectFolder || ''
    if (!cwd) throw new Error('No project folder is selected for command execution.')
    const result = await runCommand(input, cwd)
    return [`exit=${result.code ?? 'n/a'}`, result.stdout, result.stderr].filter(Boolean).join('\n')
  }

  if (step.type === 'send_notification') {
    const message = input || `${step.label} completed.`
    await notify({ type: 'info', title: 'Nebula Core', message })
    return message
  }

  if (step.type === 'ask_user') {
    const message = input || 'Routine needs user input.'
    await notify({ type: 'needs_input', title: 'Nebula Core needs input', message })
    return `Needs input: ${message}`
  }

  if (step.type === 'placeholder') {
    if (/^https?:\/\//i.test(input) || input) return runBrowserBetaAction(input, settings)
    throw new Error(step.note ?? 'Future connector placeholder.')
  }

  return 'No-op.'
}
