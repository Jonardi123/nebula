import type { AppSettings } from '../types/settings'
import type { ToolName, ToolRequest, ToolResult } from '../types/tools'
import { appendFile, createFile, listFiles, readFile, writeFile } from './fileSystem'
import { getSystemInfo, openApp, runCommand, sleepPc, stopRunningCommand } from './commandRunner'
import { appendMemory, searchMemory } from './memory'
import { queuePatchFromTool } from './patchQueue'
import { captureScreen } from './screen'
import { webFetch, webSearch } from './web'
import { throwIfRunCancelled } from './agentRun'
import { getRuntimeExecutionGrant } from './runtimeExecution'

const PROJECT_FILE_TOOLS = new Set(['list_files', 'read_file', 'write_file', 'create_file', 'append_file'])

export const SUPPORTED_TOOLS = [
  'sleep_pc',
  'open_app',
  'list_files',
  'read_file',
  'write_file',
  'create_file',
  'append_file',
  'run_command',
  'search_memory',
  'write_memory',
  'get_system_info',
  'get_current_time',
  'capture_screen',
  'stop_agent',
  'web_search',
  'web_fetch',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stripJsonFence(content: string) {
  const trimmed = content.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced?.[1]?.trim() ?? trimmed
}

function extractJsonObject(content: string) {
  const stripped = stripJsonFence(content)
  if (stripped.startsWith('{') && stripped.endsWith('}')) return stripped

  const firstBrace = stripped.indexOf('{')
  const lastBrace = stripped.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace <= firstBrace) return null
  return stripped.slice(firstBrace, lastBrace + 1)
}

function parseArgs(rawArgs: unknown, parsed: Record<string, unknown>) {
  if (isRecord(rawArgs)) return rawArgs

  if (typeof rawArgs === 'string' && rawArgs.trim()) {
    try {
      const decoded = JSON.parse(rawArgs)
      if (isRecord(decoded)) return decoded
    } catch {
      return {}
    }
  }

  const argsFromTopLevel = { ...parsed }
  for (const key of ['tool', 'tool_name', 'name', 'function_name', 'function', 'args', 'arguments', 'parameters', 'input']) {
    delete argsFromTopLevel[key]
  }
  return argsFromTopLevel
}

export function parseToolRequest(content: string): ToolRequest | null {
  const jsonContent = extractJsonObject(content)
  if (!jsonContent) return null

  try {
    const parsed = JSON.parse(jsonContent)
    if (!isRecord(parsed)) return null

    const functionObject = isRecord(parsed.function) ? parsed.function : {}
    const tool =
      parsed.tool ??
      parsed.tool_name ??
      parsed.name ??
      parsed.function_name ??
      functionObject.name

    if (typeof tool !== 'string') return null
    if (!SUPPORTED_TOOLS.includes(tool as ToolName)) return null

    const args = parseArgs(
      parsed.args ?? parsed.parameters ?? parsed.input ?? parsed.arguments ?? functionObject.arguments,
      parsed,
    )

    return { tool: tool as ToolName, args }
  } catch {
    return null
  }
}

function hasDriveOrRoot(path: string) {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/') || path.startsWith('\\')
}

function resolveProjectPath(path: string, settings: AppSettings) {
  const trimmed = path.trim()
  const projectFolder = settings.projectFolder.trim()

  if (!projectFolder) {
    throw new Error(
      'No project folder is selected. Choose a project folder from the Files tab or Settings before using file tools.',
    )
  }

  if (!trimmed || trimmed === '.') return projectFolder
  if (hasDriveOrRoot(trimmed)) return trimmed

  return `${projectFolder.replace(/[\\/]+$/, '')}\\${trimmed.replace(/^[\\/]+/, '')}`
}

export async function executeTool(request: ToolRequest, settings: AppSettings, signal?: AbortSignal): Promise<ToolResult> {
  try {
    throwIfRunCancelled(signal)
    const args = request.args
    if (PROJECT_FILE_TOOLS.has(request.tool)) {
      const rawPath = String(args.path ?? '')
      args.path = resolveProjectPath(rawPath, settings)
    }

    switch (request.tool) {
      case 'sleep_pc':
        await sleepPc()
        return { ok: true, tool: request.tool, output: 'Sleep command sent.' }
      case 'open_app':
        {
          const requested = String(args.app ?? args.path ?? '').trim()
          const target = settings.trustedAppAliases?.[requested.toLowerCase()] || requested
          await openApp(target)
        }
        return { ok: true, tool: request.tool, output: 'App opened.' }
      case 'list_files':
        return { ok: true, tool: request.tool, output: await listFiles(String(args.path ?? settings.projectFolder)) }
      case 'read_file':
        return { ok: true, tool: request.tool, output: await readFile(String(args.path ?? '')) }
      case 'write_file':
      case 'create_file':
      case 'append_file': {
        if (getRuntimeExecutionGrant().mode === 'full') {
          const path = String(args.path ?? '')
          const content = String(args.content ?? '')
          if (request.tool === 'write_file') await writeFile(path, content)
          else if (request.tool === 'create_file') await createFile(path, content)
          else await appendFile(path, content)
          return { ok: true, tool: request.tool, output: { path, operation: request.tool, applied: true } }
        }
        const proposal = await queuePatchFromTool(
          request.tool,
          String(args.path ?? ''),
          String(args.content ?? ''),
          {
            reason: `${request.tool} requested by the local model. Review the diff before applying.`,
            riskLevel: 'needs_approval',
          },
        )
        return {
          ok: true,
          tool: request.tool,
          output: {
            patchQueued: true,
            patchId: proposal.id,
            path: proposal.path,
            operation: proposal.operation,
            status: proposal.status,
            message: 'Patch queued for review. The file has not been changed yet.',
          },
        }
      }
      case 'run_command':
        return {
          ok: true,
          tool: request.tool,
          output: await runCommand(String(args.command ?? ''), String(args.cwd ?? settings.projectFolder)),
        }
      case 'search_memory':
        return { ok: true, tool: request.tool, output: await searchMemory(settings.memoryFolder, String(args.query ?? '')) }
      case 'write_memory':
        await appendMemory(settings.memoryFolder, String(args.file ?? 'lessons_learned.md') as never, String(args.content ?? ''))
        return { ok: true, tool: request.tool, output: 'Memory updated.' }
      case 'get_system_info':
        return { ok: true, tool: request.tool, output: await getSystemInfo() }
      case 'get_current_time':
        return { ok: true, tool: request.tool, output: new Date().toString() }
      case 'capture_screen':
        return { ok: true, tool: request.tool, output: await captureScreen() }
      case 'stop_agent':
        await stopRunningCommand()
        return { ok: true, tool: request.tool, output: 'Agent stopped.' }
      case 'web_search':
        return {
          ok: true,
          tool: request.tool,
          output: await webSearch(String(args.query ?? ''), Number(args.maxResults ?? 5)),
        }
      case 'web_fetch':
        return {
          ok: true,
          tool: request.tool,
          output: await webFetch(String(args.url ?? ''), settings.memoryFolder),
        }
    }
  } catch (error) {
    return {
      ok: false,
      tool: request.tool,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
