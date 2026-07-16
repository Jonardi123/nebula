import type { LogEvent } from '../types/agent'
import type {
  TaskRun,
  WorkspaceAwarenessSnapshot,
  WorkspaceGitStatus,
  WorkspaceIssueSummary,
  WorkspaceTaskSummary,
  WorkspaceTodo,
} from '../types/nebula'
import type { AppSettings } from '../types/settings'
import type { FileNode } from './fileSystem'
import { readFile } from './fileSystem'
import { getNotifications } from './notifications'
import { recordDiagnosticEvent } from './orchestratorDiagnostics'
import { getProfileByFolder, getProjectProfile } from './projectProfiles'
import { runCommand } from './commandRunner'
import { getOrchestratorDiagnostics } from './orchestratorDiagnostics'
import { getTaskRuns } from './tasks'

const WORKSPACE_AWARENESS_KEY = 'nebula-workspace-awareness'
const TODO_FILES = ['README.md', 'readme.md', 'package.json', 'TODO.md', 'todo.md']
const METADATA_FILES = ['package.json', 'README.md', 'readme.md', 'src-tauri/tauri.conf.json']
const OBSERVATION_LIMIT = 8

export interface WorkspaceAwarenessHints {
  logs?: LogEvent[]
  openedFile?: { path: string; content: string } | null
  files?: FileNode[]
}

interface BuildOptions {
  refreshGit?: boolean
  gitCacheMaxMs?: number
}

function nowIso() {
  return new Date().toISOString()
}

function projectName(folder: string) {
  return folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder
}

function joinPath(folder: string, file: string) {
  return `${folder.replace(/[\\/]+$/, '')}\\${file.replace(/^[\\/]+/, '')}`
}

function normalizePath(path?: string) {
  if (!path) return ''
  return path.replace(/\//g, '\\')
}

function projectRelative(path: string, folder: string) {
  const normalizedPath = normalizePath(path)
  const normalizedFolder = normalizePath(folder).replace(/[\\]+$/, '')
  return normalizedPath.toLowerCase().startsWith(`${normalizedFolder.toLowerCase()}\\`)
    ? normalizedPath.slice(normalizedFolder.length + 1)
    : normalizedPath
}

function uniq(values: Array<string | undefined | null>) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const text = value?.trim()
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(text)
  }
  return result
}

function clip(value: string, max = 220) {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > max ? `${compact.slice(0, max).trimEnd()}...` : compact
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function readSnapshots() {
  try {
    return JSON.parse(localStorage.getItem(WORKSPACE_AWARENESS_KEY) ?? '{}') as Record<string, WorkspaceAwarenessSnapshot>
  } catch {
    return {}
  }
}

function writeSnapshots(snapshots: Record<string, WorkspaceAwarenessSnapshot>) {
  try {
    localStorage.setItem(WORKSPACE_AWARENESS_KEY, JSON.stringify(snapshots))
    window.dispatchEvent(new CustomEvent('nebula-workspace-awareness-changed'))
  } catch {
    // Workspace awareness can be rebuilt from observed project state.
  }
}

export function getStoredWorkspaceAwareness(projectFolder: string) {
  if (!projectFolder) return null
  return readSnapshots()[normalizePath(projectFolder).toLowerCase()] ?? null
}

function saveWorkspaceAwareness(snapshot: WorkspaceAwarenessSnapshot) {
  const snapshots = readSnapshots()
  snapshots[normalizePath(snapshot.projectFolder).toLowerCase()] = snapshot
  writeSnapshots(snapshots)
  return snapshot
}

async function tryRead(folder: string, file: string) {
  try {
    return await readFile(joinPath(folder, file))
  } catch {
    return ''
  }
}

function parsePackageJson(content: string) {
  if (!content.trim()) return null
  try {
    return JSON.parse(content) as {
      name?: string
      version?: string
      scripts?: Record<string, string>
    }
  } catch {
    return null
  }
}

function firstReadmeTitle(readme: string) {
  return readme
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find(Boolean)
}

function extractTodos(source: string, content: string, max = 8): WorkspaceTodo[] {
  return content
    .split(/\r?\n/)
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter((line) => /\b(todo|fixme|follow[- ]?up|next step|unfinished|pending)\b/i.test(line.text))
    .slice(0, max)
    .map((line) => ({ source, line: line.line, text: clip(line.text, 260) }))
}

function flattenFileTree(nodes: FileNode[] = []): string[] {
  const result: string[] = []
  const visit = (items: FileNode[]) => {
    for (const item of items) {
      if (!item.isDir) result.push(item.path)
      if (item.children) visit(item.children)
    }
  }
  visit(nodes)
  return result
}

function toolFromRecord(value: unknown) {
  const record = asRecord(value)
  return asString(record?.tool) ?? asString(asRecord(record?.toolRequest)?.tool)
}

function argsFromRecord(value: unknown) {
  const record = asRecord(value)
  return asRecord(record?.args) ?? asRecord(asRecord(record?.toolRequest)?.args) ?? null
}

function collectLogSignals(logs: LogEvent[], folder: string) {
  const recentFiles: string[] = []
  const editedFiles: string[] = []
  const commands: string[] = []
  const errors: WorkspaceIssueSummary[] = []
  const buildFailures: WorkspaceIssueSummary[] = []

  for (const log of logs.slice(-120)) {
    const parsed = parseMaybeJson(log.details ?? log.message)
    const tool = toolFromRecord(parsed)
    const args = argsFromRecord(parsed)
    const path = asString(args?.path)
    const command = asString(args?.command)

    if (path) {
      const relative = projectRelative(path, folder)
      if (/read|list|write|create|append/i.test(tool ?? log.message)) recentFiles.push(relative)
      if (/write_file|create_file|append_file/i.test(tool ?? '')) editedFiles.push(relative)
    }

    if (command) commands.push(command)
    if (log.type === 'error') {
      errors.push({ time: log.createdAt, title: 'Nebula error', detail: clip(log.message, 360) })
    }

    const output = asRecord(asRecord(parsed)?.output)
    const code = typeof output?.code === 'number' ? output.code : null
    if (tool === 'run_command' && code !== null && code !== 0) {
      buildFailures.push({ time: log.createdAt, title: `Command failed: ${command ?? 'run_command'}`, detail: clip(asString(output?.stderr) ?? asString(output?.stdout) ?? log.message, 360) })
    }
  }

  return {
    recentFiles,
    editedFiles,
    commands,
    errors,
    buildFailures,
  }
}

function collectTaskSignals(tasks: TaskRun[], folder: string) {
  const recentFiles: string[] = []
  const editedFiles: string[] = []
  const commands: string[] = []
  const errors: WorkspaceIssueSummary[] = []
  const buildFailures: WorkspaceIssueSummary[] = []

  for (const task of tasks.slice(0, 24)) {
    recentFiles.push(...(task.files ?? []).map((file) => projectRelative(file, folder)))
    commands.push(...(task.commands ?? []))
    if (task.status === 'error') {
      errors.push({ time: task.updatedAt, title: `Task error: ${task.goal}`, detail: task.finalResult })
    }

    for (const event of task.timeline ?? []) {
      const tool = toolFromRecord(event.data)
      const args = argsFromRecord(event.data)
      const path = asString(args?.path)
      const command = asString(args?.command)
      if (path) {
        const relative = projectRelative(path, folder)
        recentFiles.push(relative)
        if (event.type === 'file_write' || /write_file|create_file|append_file/i.test(tool ?? '')) editedFiles.push(relative)
      }
      if (command) commands.push(command)
      if (event.type === 'error') errors.push({ time: event.timestamp, title: event.label, detail: event.detail })
    }
  }

  return {
    recentFiles,
    editedFiles,
    commands,
    errors,
    buildFailures,
  }
}

function taskSummary(task: TaskRun): WorkspaceTaskSummary {
  return {
    id: task.id,
    goal: task.goal,
    status: task.status,
    updatedAt: task.updatedAt,
  }
}

function recentNotifications() {
  const errors: WorkspaceIssueSummary[] = []
  const buildFailures: WorkspaceIssueSummary[] = []

  for (const notification of getNotifications().slice(0, 24)) {
    if (notification.type === 'error') {
      errors.push({ time: notification.createdAt, title: notification.title, detail: notification.message })
    }
    if (notification.type === 'build_failed') {
      buildFailures.push({ time: notification.createdAt, title: notification.title, detail: notification.message })
    }
  }

  return { errors, buildFailures }
}

function recentDiagnosticErrors() {
  return getOrchestratorDiagnostics()
    .filter((event) => /error/i.test(`${event.type} ${event.label} ${event.detail ?? ''}`))
    .slice(0, 8)
    .map((event) => ({ time: event.createdAt, title: event.label, detail: event.detail }))
}

function parseGitStatus(output: string, checkedAt: string): WorkspaceGitStatus {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const branchLine = lines.find((line) => line.startsWith('## '))
  const changedFiles = lines
    .filter((line) => !line.startsWith('## '))
    .map((line) => line.replace(/^[ MADRCU?!]{1,2}\s+/, '').trim())
    .filter(Boolean)

  const branch = branchLine?.replace(/^##\s+/, '').split('...')[0]?.trim()
  return {
    available: true,
    branch: branch || undefined,
    statusSummary: changedFiles.length ? `${changedFiles.length} changed file${changedFiles.length === 1 ? '' : 's'}` : 'clean',
    changedFiles: changedFiles.slice(0, 12),
    checkedAt,
  }
}

async function getGitStatus(settings: AppSettings, existing: WorkspaceAwarenessSnapshot | null, options: BuildOptions): Promise<WorkspaceGitStatus | undefined> {
  if (!settings.projectFolder) return undefined
  const maxAge = options.gitCacheMaxMs ?? 60000
  const previous = existing?.git
  if (previous && options.refreshGit !== true && Date.now() - new Date(previous.checkedAt).getTime() < maxAge) {
    return previous
  }
  if (previous && Date.now() - new Date(previous.checkedAt).getTime() < maxAge) {
    return previous
  }

  const checkedAt = nowIso()
  try {
    const result = await runCommand('git status --short --branch', settings.projectFolder)
    const output = `${result.stdout}\n${result.stderr}`.trim()
    if (result.code !== 0 || /not a git repository/i.test(output)) {
      return {
        available: false,
        checkedAt,
        changedFiles: [],
        error: output ? clip(output, 260) : 'Git status unavailable.',
      }
    }
    return parseGitStatus(result.stdout, checkedAt)
  } catch (error) {
    return {
      available: false,
      checkedAt,
      changedFiles: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function welcomeLines(snapshot: Omit<WorkspaceAwarenessSnapshot, 'welcomeLines'>): string[] {
  const lines: string[] = []
  lines.push(`${snapshot.projectName}${snapshot.detectedFramework ? ` is active (${snapshot.detectedFramework})` : ' is active'}.`)

  if (snapshot.lastActiveTask) {
    lines.push(`Last worked on: ${snapshot.lastActiveTask.goal} (${snapshot.lastActiveTask.status}).`)
  } else if (snapshot.openedFile) {
    lines.push(`Opened file: ${snapshot.openedFile}.`)
  } else if (snapshot.recentFiles[0]) {
    lines.push(`Recent file: ${snapshot.recentFiles[0]}.`)
  }

  if (snapshot.unfinishedTasks.length > 0) {
    lines.push(`${snapshot.unfinishedTasks.length} unfinished task${snapshot.unfinishedTasks.length === 1 ? '' : 's'} found.`)
  }

  const issue = snapshot.recentBuildFailures[0] ?? snapshot.recentErrors[0]
  if (issue) {
    lines.push(`Recent issue: ${issue.title}.`)
  }

  if (snapshot.git?.available) {
    lines.push(`Git: ${snapshot.git.branch ?? 'branch unknown'}, ${snapshot.git.statusSummary ?? 'status unknown'}.`)
  }

  if (snapshot.pendingTodos.length > 0) {
    lines.push(`${snapshot.pendingTodos.length} TODO/follow-up item${snapshot.pendingTodos.length === 1 ? '' : 's'} observed.`)
  }

  return lines.slice(0, 5)
}

export async function buildWorkspaceAwareness(
  settings: AppSettings,
  hints: WorkspaceAwarenessHints = {},
  options: BuildOptions = {},
): Promise<WorkspaceAwarenessSnapshot | null> {
  if (!settings.projectFolder) return null

  const existing = getStoredWorkspaceAwareness(settings.projectFolder)
  const profile = getProjectProfile(settings.activeProjectProfileId) ?? getProfileByFolder(settings.projectFolder)
  const metadataFiles = uniq([...(profile?.metadataFiles ?? []), ...METADATA_FILES])
  const metadata = Object.fromEntries(await Promise.all(metadataFiles.map(async (file) => [file, await tryRead(settings.projectFolder, file)] as const)))
  const packageJson = parsePackageJson(metadata['package.json'] ?? '')
  const readme = metadata['README.md'] || metadata['readme.md'] || ''
  const tasks = getTaskRuns()
  const logSignals = collectLogSignals(hints.logs ?? [], settings.projectFolder)
  const taskSignals = collectTaskSignals(tasks, settings.projectFolder)
  const notificationSignals = recentNotifications()
  const diagnosticsErrors = recentDiagnosticErrors()
  const treeFiles = flattenFileTree(hints.files ?? [])
    .map((file) => projectRelative(file, settings.projectFolder))
    .filter((file) => /\.(ts|tsx|js|jsx|rs|json|md|css|html)$/i.test(file))
    .slice(0, 10)

  const openedFile = hints.openedFile?.path ? projectRelative(hints.openedFile.path, settings.projectFolder) : existing?.openedFile
  const recentFiles = uniq([
    openedFile,
    ...logSignals.recentFiles.reverse(),
    ...taskSignals.recentFiles,
    ...treeFiles,
    ...(existing?.recentFiles ?? []),
  ]).slice(0, OBSERVATION_LIMIT)
  const recentlyEditedFiles = uniq([
    ...logSignals.editedFiles.reverse(),
    ...taskSignals.editedFiles,
    ...(existing?.recentlyEditedFiles ?? []),
  ]).slice(0, OBSERVATION_LIMIT)
  const recentCommands = uniq([
    ...logSignals.commands.reverse(),
    ...taskSignals.commands,
    ...(existing?.recentCommands ?? []),
  ]).slice(0, OBSERVATION_LIMIT)

  const recentTasks = tasks
    .filter((task) => task.status === 'running' || task.status === 'stopped' || task.finalResult)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  const unfinishedTasks = recentTasks
    .filter((task) => task.status === 'running')
    .slice(0, 4)
    .map(taskSummary)
  const lastActiveTask = recentTasks[0] ? taskSummary(recentTasks[0]) : existing?.lastActiveTask

  const todoSources = [
    ...TODO_FILES.map((file) => ({ source: file, content: metadata[file] ?? '' })),
    ...(hints.openedFile ? [{ source: projectRelative(hints.openedFile.path, settings.projectFolder), content: hints.openedFile.content }] : []),
  ]
  const pendingTodos = todoSources.flatMap((source) => extractTodos(source.source, source.content)).slice(0, 10)
  const recentErrors = [
    ...logSignals.errors.reverse(),
    ...taskSignals.errors,
    ...notificationSignals.errors,
    ...diagnosticsErrors,
    ...(existing?.recentErrors ?? []),
  ]
    .filter((issue) => issue.title)
    .slice(0, OBSERVATION_LIMIT)
  const recentBuildFailures = [
    ...logSignals.buildFailures.reverse(),
    ...taskSignals.buildFailures,
    ...notificationSignals.buildFailures,
    ...(existing?.recentBuildFailures ?? []),
  ].slice(0, OBSERVATION_LIMIT)
  const git = await getGitStatus(settings, existing, options)
  const createdAt = existing?.createdAt ?? nowIso()

  const base: Omit<WorkspaceAwarenessSnapshot, 'welcomeLines'> = {
    id: existing?.id ?? crypto.randomUUID(),
    projectFolder: settings.projectFolder,
    projectName: profile?.name || projectName(settings.projectFolder),
    projectProfileId: profile?.id,
    detectedFramework: profile?.detectedFramework,
    packageManager: profile?.packageManager,
    packageName: packageJson?.name,
    packageVersion: packageJson?.version,
    readmeTitle: firstReadmeTitle(readme),
    projectSummary: profile?.summary,
    metadataFiles: metadataFiles.filter((file) => metadata[file]),
    commonScripts: profile?.commonScripts ?? Object.keys(packageJson?.scripts ?? {}),
    recentFiles,
    recentlyEditedFiles,
    recentCommands,
    openedFile,
    lastActiveTask,
    unfinishedTasks,
    pendingTodos,
    recentErrors,
    recentBuildFailures,
    git,
    createdAt,
    updatedAt: nowIso(),
  }

  return saveWorkspaceAwareness({
    ...base,
    welcomeLines: welcomeLines(base),
  })
}

export function formatWorkspaceAwarenessForPrompt(snapshot: WorkspaceAwarenessSnapshot | null) {
  if (!snapshot) return 'No active workspace awareness snapshot.'
  return [
    `Active project: ${snapshot.projectName}`,
    `Folder: ${snapshot.projectFolder}`,
    snapshot.detectedFramework ? `Framework: ${snapshot.detectedFramework}` : '',
    snapshot.packageManager ? `Package manager: ${snapshot.packageManager}` : '',
    snapshot.packageName ? `Package: ${snapshot.packageName}${snapshot.packageVersion ? `@${snapshot.packageVersion}` : ''}` : '',
    snapshot.git?.available ? `Git: ${snapshot.git.branch ?? 'unknown branch'}; ${snapshot.git.statusSummary ?? 'unknown status'}` : '',
    snapshot.openedFile ? `Opened file: ${snapshot.openedFile}` : '',
    snapshot.lastActiveTask ? `Last active task: ${snapshot.lastActiveTask.status} - ${snapshot.lastActiveTask.goal}` : '',
    snapshot.unfinishedTasks.length ? `Unfinished tasks:\n${snapshot.unfinishedTasks.map((task) => `- ${task.goal}`).join('\n')}` : '',
    snapshot.recentFiles.length ? `Recent files: ${snapshot.recentFiles.join(', ')}` : '',
    snapshot.recentlyEditedFiles.length ? `Recently edited files: ${snapshot.recentlyEditedFiles.join(', ')}` : '',
    snapshot.recentCommands.length ? `Recent commands: ${snapshot.recentCommands.join(' | ')}` : '',
    snapshot.pendingTodos.length ? `Observed TODOs:\n${snapshot.pendingTodos.slice(0, 6).map((todo) => `- ${todo.source}${todo.line ? `:${todo.line}` : ''} ${todo.text}`).join('\n')}` : '',
    snapshot.recentBuildFailures.length ? `Recent build/test failures:\n${snapshot.recentBuildFailures.slice(0, 4).map((issue) => `- ${issue.title}${issue.detail ? `: ${clip(issue.detail, 160)}` : ''}`).join('\n')}` : '',
    snapshot.recentErrors.length ? `Recent errors:\n${snapshot.recentErrors.slice(0, 4).map((issue) => `- ${issue.title}${issue.detail ? `: ${clip(issue.detail, 160)}` : ''}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function recordWorkspaceAwarenessDiagnostic(snapshot: WorkspaceAwarenessSnapshot, reason: string) {
  recordDiagnosticEvent({
    type: 'workspace',
    label: 'Workspace awareness refreshed',
    detail: reason,
    data: {
      project: snapshot.projectName,
      folder: snapshot.projectFolder,
      recentFiles: snapshot.recentFiles.slice(0, 5),
      recentlyEditedFiles: snapshot.recentlyEditedFiles.slice(0, 5),
      recentCommands: snapshot.recentCommands.slice(0, 4),
      unfinishedTasks: snapshot.unfinishedTasks.length,
      recentErrors: snapshot.recentErrors.length,
      recentBuildFailures: snapshot.recentBuildFailures.length,
      git: snapshot.git
        ? {
            available: snapshot.git.available,
            branch: snapshot.git.branch,
            statusSummary: snapshot.git.statusSummary,
          }
        : undefined,
    },
  })
}
