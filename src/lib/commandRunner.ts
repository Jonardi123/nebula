import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { CommandEvent, CommandJob, CommandJobStatus, InstalledApp } from '../types/execution'
import { isTauriRuntime } from './runtime'

export interface CommandOutput {
  code: number | null
  stdout: string
  stderr: string
  jobId?: string | null
  truncated?: boolean
}

interface NativeCommandJobState {
  id: string
  command: string
  cwd: string
  pid: number
  status: string
  startedAt: string
}

interface PendingCommand {
  resolve: (output: CommandOutput) => void
  reject: (error: Error) => void
}

const jobs = new Map<string, CommandJob>()
const pending = new Map<string, PendingCommand>()
const subscribers = new Set<() => void>()
const RECENT_APPS_KEY = 'nebula-recent-apps-v1'
let listenerPromise: Promise<UnlistenFn> | null = null

function commandId() {
  return `command-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function eventTime(value?: string) {
  const timestamp = Number(value)
  return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : new Date().toISOString()
}

function notify() {
  subscribers.forEach((subscriber) => subscriber())
}

function finalStatus(type: CommandEvent['type']): CommandJobStatus {
  if (type === 'cancelled') return 'cancelled'
  if (type === 'timed_out') return 'timed_out'
  if (type === 'error') return 'failed'
  return 'completed'
}

function parseFinalOutput(data?: string) {
  try {
    const parsed = JSON.parse(data ?? '{}') as { stdout?: unknown; stderr?: unknown }
    return {
      stdout: typeof parsed.stdout === 'string' ? parsed.stdout : '',
      stderr: typeof parsed.stderr === 'string' ? parsed.stderr : '',
    }
  } catch {
    return { stdout: '', stderr: data ?? '' }
  }
}

function handleCommandEvent(event: CommandEvent) {
  const current = jobs.get(event.jobId)
  if (!current) return

  if (event.type === 'output') {
    const key = event.stream === 'stderr' ? 'stderr' : 'stdout'
    jobs.set(event.jobId, {
      ...current,
      [key]: `${current[key]}${event.data ?? ''}`,
      truncated: Boolean(current.truncated || event.truncated),
    })
    notify()
    return
  }

  if (!['completed', 'cancelled', 'timed_out', 'error'].includes(event.type)) return
  const output = parseFinalOutput(event.data)
  const status = finalStatus(event.type)
  const finished: CommandJob = {
    ...current,
    ...output,
    code: event.code ?? null,
    status,
    truncated: Boolean(current.truncated || event.truncated),
    finishedAt: eventTime(event.createdAt),
  }
  jobs.set(event.jobId, finished)
  const waiter = pending.get(event.jobId)
  pending.delete(event.jobId)
  waiter?.resolve({
    code: finished.code ?? null,
    stdout: finished.stdout,
    stderr: finished.stderr || (status === 'timed_out' ? 'Command timed out after 90 seconds.' : ''),
    jobId: event.jobId,
    truncated: finished.truncated,
  })
  notify()
}

async function ensureCommandListener() {
  if (!isTauriRuntime()) return
  if (!listenerPromise) {
    listenerPromise = listen<CommandEvent>('nebula-command-event', ({ payload }) => handleCommandEvent(payload))
  }
  await listenerPromise
}

export function getCommandJobs() {
  return [...jobs.values()].sort((left, right) => right.startedAt.localeCompare(left.startedAt))
}

export function subscribeCommandJobs(subscriber: () => void) {
  subscribers.add(subscriber)
  void ensureCommandListener()
  return () => subscribers.delete(subscriber)
}

export async function startCommandJob(command: string, cwd: string) {
  if (!isTauriRuntime()) {
    throw new Error(`Command "${command}" requires the Tauri desktop app. cwd=${cwd}`)
  }
  await ensureCommandListener()
  const id = commandId()
  const startedAt = new Date().toISOString()
  jobs.set(id, { id, command, cwd, status: 'running', startedAt, stdout: '', stderr: '', truncated: false })
  notify()
  try {
    const native = await invoke<NativeCommandJobState>('start_command', { jobId: id, command, cwd })
    jobs.set(id, { ...jobs.get(id)!, pid: native.pid, cwd: native.cwd, startedAt: eventTime(native.startedAt) })
    notify()
    return jobs.get(id)!
  } catch (error) {
    jobs.set(id, { ...jobs.get(id)!, status: 'failed', stderr: String(error), finishedAt: new Date().toISOString() })
    notify()
    throw error
  }
}

export async function runCommand(command: string, cwd: string) {
  if (!isTauriRuntime()) {
    return { code: null, stdout: '', stderr: `Command "${command}" requires the Tauri desktop app. cwd=${cwd}`, jobId: null, truncated: false }
  }
  await ensureCommandListener()
  const id = commandId()
  const startedAt = new Date().toISOString()
  jobs.set(id, { id, command, cwd, status: 'running', startedAt, stdout: '', stderr: '', truncated: false })
  notify()

  const result = new Promise<CommandOutput>((resolve, reject) => pending.set(id, { resolve, reject }))
  try {
    const native = await invoke<NativeCommandJobState>('start_command', { jobId: id, command, cwd })
    jobs.set(id, { ...jobs.get(id)!, pid: native.pid, cwd: native.cwd, startedAt: eventTime(native.startedAt) })
    notify()
  } catch (error) {
    pending.delete(id)
    jobs.set(id, { ...jobs.get(id)!, status: 'failed', stderr: String(error), finishedAt: new Date().toISOString() })
    notify()
    throw error
  }
  return result
}

export async function stopRunningCommand() {
  if (!isTauriRuntime()) return
  return invoke('stop_running_command')
}

export async function getCommandHealth() {
  if (!isTauriRuntime()) return null
  return invoke<NativeCommandJobState | null>('command_health')
}

export async function getSystemInfo() {
  if (!isTauriRuntime()) return `Browser preview\n${navigator.userAgent}`
  return invoke<string>('get_system_info')
}

export async function sleepPc() {
  if (!isTauriRuntime()) throw new Error('sleep_pc requires the Tauri desktop app.')
  return invoke('sleep_pc')
}

export async function openApp(app: string) {
  if (!isTauriRuntime()) throw new Error(`open_app(${app}) requires the Tauri desktop app.`)
  const result = await invoke('open_app', { app })
  try {
    const current = getRecentApps().filter((item) => item.toLowerCase() !== app.toLowerCase())
    localStorage.setItem(RECENT_APPS_KEY, JSON.stringify([app, ...current].slice(0, 8)))
  } catch {
    // Recent launch history is optional and never blocks app control.
  }
  return result
}

export function getRecentApps(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_APPS_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 8) : []
  } catch {
    return []
  }
}

export async function listInstalledApps() {
  if (!isTauriRuntime()) return []
  return invoke<InstalledApp[]>('list_installed_apps')
}

export async function openPathInExplorer(path: string) {
  if (!isTauriRuntime()) throw new Error(`open_path_in_explorer(${path}) requires the Tauri desktop app.`)
  return invoke('open_path_in_explorer', { path })
}
