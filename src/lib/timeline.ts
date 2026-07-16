import { getMemoryProposals } from './memoryInbox'
import { getNotifications } from './notifications'
import { getOrchestratorDiagnostics } from './orchestratorDiagnostics'
import { getSourceCards } from './sourceCards'
import { getTaskRuns } from './tasks'
import { getQuickActionRuns } from './quickActions'
import { getNebulaRoutineRuns } from './automationRoutines'
import { getSkillRuntimeStats } from '../skills'
import type { LogEvent } from '../types/agent'
import type {
  MemoryProposal,
  NebulaDiagnosticEvent,
  NebulaNotification,
  NebulaRoutineRun,
  QuickActionRun,
  SourceCard,
  TaskRun,
  TaskTimelineEvent,
  TimelineDetail,
  TimelineFilter,
  TimelineItem,
  TimelineStatus,
} from '../types/nebula'
import type { SkillRuntimeStat } from '../skills/types'

const DETAIL_LIMIT = 1400
const OUTPUT_LIMIT = 900

const codeTools = new Set(['read_file', 'write_file', 'create_file', 'append_file', 'list_files', 'run_command'])
const fileTools = new Set(['read_file', 'write_file', 'create_file', 'append_file', 'list_files'])
const commandNames = new Set(['run_command'])

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

function clip(value: string, limit = DETAIL_LIMIT) {
  const compact = value.replace(/\r\n/g, '\n').trim()
  return compact.length > limit ? `${compact.slice(0, limit)}...` : compact
}

function detail(label: string, value: unknown, limit = DETAIL_LIMIT): TimelineDetail | null {
  if (value === undefined || value === null || value === '') return null
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (!text.trim()) return null
  return { label, value: clip(text, limit) }
}

function detailsOf(items: Array<TimelineDetail | null>) {
  return items.filter(Boolean) as TimelineDetail[]
}

function stringifySafe(value: unknown, limit = DETAIL_LIMIT) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return clip(value, limit)
  return clip(JSON.stringify(value, null, 2), limit)
}

function getToolName(value: unknown) {
  const record = asRecord(value)
  return asString(record?.tool) ?? asString(asRecord(record?.toolRequest)?.tool)
}

function getToolArgs(value: unknown) {
  const record = asRecord(value)
  return asRecord(record?.args) ?? asRecord(asRecord(record?.toolRequest)?.args) ?? null
}

function summarizeCommandOutput(output: unknown) {
  const record = asRecord(output)
  if (!record) return ''
  const chunks = [
    asString(record.stdout),
    asString(record.stderr),
    asString(record.output),
  ].filter(Boolean)
  if (!chunks.length) return ''
  return clip(chunks.join('\n'), OUTPUT_LIMIT)
}

function classifyTool(tool?: string): Exclude<TimelineFilter, 'all'> {
  if (!tool) return 'system'
  if (commandNames.has(tool) || fileTools.has(tool)) return 'code'
  if (tool === 'web_search' || tool === 'web_fetch' || tool === 'search_memory' || tool === 'write_memory') return 'skills'
  return codeTools.has(tool) ? 'code' : 'system'
}

function statusForLog(log: LogEvent): TimelineStatus {
  if (log.type === 'error') return 'error'
  if (log.type === 'approval') return /rejected|waiting/i.test(log.message) ? 'warning' : 'success'
  if (log.type === 'tool_request') return 'running'
  return 'success'
}

function titleForLog(log: LogEvent, tool?: string) {
  if (log.type === 'user_message') return 'User request'
  if (log.type === 'ai_response') return 'Assistant response'
  if (log.type === 'tool_request') return tool ? `Tool requested: ${tool}` : 'Tool requested'
  if (log.type === 'tool_result') return tool ? `Tool finished: ${tool}` : 'Tool result'
  if (log.type === 'command') return 'Command run'
  if (log.type === 'memory') return 'Memory activity'
  if (log.type === 'approval') return 'Approval decision'
  if (log.type === 'error') return 'Error'
  return 'System event'
}

function logFilter(log: LogEvent, tool?: string): Exclude<TimelineFilter, 'all'> {
  if (log.type === 'error') return 'errors'
  if (log.type === 'user_message' || log.type === 'ai_response') return 'chat'
  if (tool) return classifyTool(tool)
  if (log.type === 'command') return 'code'
  if (log.type === 'memory' || log.type === 'tool_request' || log.type === 'tool_result') return 'skills'
  return 'system'
}

function mapLog(log: LogEvent): TimelineItem {
  const parsed = parseMaybeJson(log.details ?? log.message)
  const record = asRecord(parsed)
  const tool = getToolName(parsed)
  const args = getToolArgs(parsed)
  const output = record?.output
  const commandOutput = tool === 'run_command' ? summarizeCommandOutput(output) : ''
  const filePath = asString(args?.path)
  const command = asString(args?.command)

  const details = detailsOf([
    detail('Summary', log.message, log.type === 'tool_result' ? 600 : DETAIL_LIMIT),
    tool ? detail('Tool', tool, 120) : null,
    filePath ? detail('File', filePath, 360) : null,
    command ? detail('Command', command, 500) : null,
    commandOutput ? detail('Command output summary', commandOutput, OUTPUT_LIMIT) : null,
    record?.error ? detail('Error', record.error) : null,
  ])

  if (log.type === 'tool_result' && tool && !commandOutput && output !== undefined) {
    details.push({
      label: 'Result',
      value: fileTools.has(tool)
        ? 'Result recorded. File contents are intentionally omitted from the activity feed.'
        : stringifySafe(output, 700),
    })
  }

  return {
    id: `log:${log.id}`,
    time: log.createdAt,
    filter: logFilter(log, tool),
    type: log.type.replace(/_/g, ' '),
    title: titleForLog(log, tool),
    status: statusForLog(log),
    source: log.type === 'user_message' || log.type === 'ai_response' ? 'chat' : 'log',
    relatedSkill: tool,
    details,
  }
}

function taskEventFilter(event: TaskTimelineEvent): Exclude<TimelineFilter, 'all'> {
  if (event.type === 'error') return 'errors'
  if (event.type === 'user_prompt' || event.type === 'final') return 'chat'
  if (event.type === 'model_route') return 'chat'
  if (event.type === 'file_read' || event.type === 'file_write' || event.type === 'command') return 'code'
  if (event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'web_source') return 'skills'
  return 'system'
}

function taskEventStatus(task: TaskRun, event: TaskTimelineEvent): TimelineStatus {
  if (event.type === 'error' || task.status === 'error') return 'error'
  if (task.status === 'running' && event.type === 'tool_call') return 'running'
  if (task.status === 'stopped') return 'warning'
  return 'success'
}

function mapTaskEvent(task: TaskRun, event: TaskTimelineEvent): TimelineItem {
  const data = asRecord(event.data)
  const tool = getToolName(event.data)
  const args = getToolArgs(event.data)
  const details = detailsOf([
    detail('Task', task.goal),
    detail('Detail', event.detail),
    tool ? detail('Tool', tool, 120) : null,
    detail('File', asString(args?.path) ?? (event.type === 'file_read' || event.type === 'file_write' ? event.detail : undefined), 360),
    detail('Command', asString(args?.command), 500),
    data?.error ? detail('Error', data.error) : null,
  ])

  return {
    id: `task:${task.id}:${event.id}`,
    time: event.timestamp,
    filter: taskEventFilter(event),
    type: event.type.replace(/_/g, ' '),
    title: event.label,
    status: taskEventStatus(task, event),
    source: 'task',
    relatedSkill: tool,
    details,
  }
}

function roleLabel(role?: string) {
  return role ? `${role} model` : undefined
}

function mapDiagnostic(event: NebulaDiagnosticEvent): TimelineItem[] {
  const record = asRecord(event.data)
  const selectedSkills = Array.isArray(record?.selectedSkills) ? (record.selectedSkills as unknown[]) : []
  const filter: Exclude<TimelineFilter, 'all'> =
    event.type === 'review'
      ? 'review'
      : event.type === 'metric' && /^Skill executed:/i.test(event.label)
        ? 'skills'
        : event.type === 'route'
          ? 'chat'
          : 'system'

  const status: TimelineStatus =
    event.type === 'model_lifecycle' && /error/i.test(event.label)
      ? 'error'
      : event.type === 'model_lifecycle' && /loading|switching/i.test(event.label)
        ? 'running'
        : 'success'

  const base: TimelineItem = {
    id: `diagnostic:${event.id}`,
    time: event.createdAt,
    filter,
    type: event.type.replace(/_/g, ' '),
    title: event.type === 'route' ? 'Model routing decision' : event.label,
    status,
    source: 'diagnostics',
    relatedModel: event.model ?? roleLabel(event.role),
    details: detailsOf([
      detail('Summary', event.label),
      detail('Detail', event.detail),
      detail('Model', event.model),
      detail('Role', event.role),
    ]),
  }

  const skillItems: TimelineItem[] = selectedSkills
    .map((raw, index) => asRecord(raw) ? { record: asRecord(raw)!, index } : null)
    .filter(Boolean)
    .map((entry) => ({
      id: `diagnostic:${event.id}:skill:${entry!.index}`,
      time: event.createdAt,
      filter: 'skills' as const,
      type: 'selected skill',
      title: `Selected skill: ${asString(entry!.record.name) ?? asString(entry!.record.id) ?? 'unknown'}`,
      status: 'success' as const,
      source: 'diagnostics' as const,
      relatedSkill: asString(entry!.record.name) ?? asString(entry!.record.id),
      relatedModel: event.model,
      details: detailsOf([
        detail('Reason', entry!.record.reason),
        detail('Confidence', entry!.record.confidence),
      ]),
    }))

  return [base, ...skillItems]
}

function mapSkillStat(stat: SkillRuntimeStat): TimelineItem {
  const status: TimelineStatus = stat.health === 'error' ? 'error' : stat.health === 'warning' ? 'warning' : 'success'
  return {
    id: `skill-stat:${stat.skillId}:${stat.updatedAt}`,
    time: stat.updatedAt,
    filter: status === 'error' ? 'errors' : 'skills',
    type: 'skill runtime',
    title: `Skill health: ${stat.skillId}`,
    status,
    source: 'skills',
    relatedSkill: stat.skillId,
    details: detailsOf([
      detail('Usage count', stat.usageCount),
      detail('Error count', stat.errorCount),
      detail('Average runtime', stat.averageRuntimeMs ? `${stat.averageRuntimeMs} ms` : 'n/a'),
      detail('Last runtime', stat.lastRuntimeMs ? `${stat.lastRuntimeMs} ms` : undefined),
      detail('Last error', stat.lastError),
      detail('Memory usage', stat.memoryUsageMb ? `${stat.memoryUsageMb} MB` : undefined),
    ]),
  }
}

function mapNotification(notification: NebulaNotification): TimelineItem {
  const status: TimelineStatus =
    notification.type === 'error' || notification.type === 'build_failed'
      ? 'error'
      : notification.type === 'needs_input'
        ? 'warning'
        : 'success'
  return {
    id: `notification:${notification.id}`,
    time: notification.createdAt,
    filter: status === 'error' ? 'errors' : notification.type === 'build_failed' ? 'code' : 'system',
    type: notification.type.replace(/_/g, ' '),
    title: notification.title,
    status,
    source: 'notifications',
    details: detailsOf([
      detail('Message', notification.message),
      detail('Data', notification.data, 700),
    ]),
  }
}

function mapMemoryProposal(proposal: MemoryProposal): TimelineItem {
  const status: TimelineStatus =
    proposal.status === 'approved' ? 'success' : proposal.status === 'rejected' ? 'warning' : 'running'
  return {
    id: `memory:${proposal.id}:${proposal.status}`,
    time: proposal.createdAt,
    filter: 'system',
    type: proposal.status === 'approved' ? 'memory save' : 'memory proposal',
    title: proposal.status === 'approved' ? `Memory saved: ${proposal.file}` : `Memory proposal: ${proposal.file}`,
    status,
    source: 'memory',
    details: detailsOf([
      detail('Reason', proposal.reason),
      detail('Content', proposal.content, 900),
      detail('Source', proposal.sourceId),
    ]),
  }
}

function mapSourceCard(card: SourceCard): TimelineItem {
  return {
    id: `source:${card.id}`,
    time: card.createdAt,
    filter: 'skills',
    type: 'web source',
    title: `Source captured: ${card.title}`,
    status: 'success',
    source: 'sources',
    relatedSkill: 'web research',
    details: detailsOf([
      detail('URL', card.url, 500),
      detail('Checked', card.dateChecked),
      detail('Summary', card.summary || card.snippet, 900),
      detail('Trust hints', card.trustHints.join(', ')),
    ]),
  }
}

function mapQuickAction(run: QuickActionRun): TimelineItem {
  const status: TimelineStatus =
    run.status === 'error' ? 'error' : run.status === 'running' || run.status === 'queued' ? 'running' : 'success'
  return {
    id: `quick:${run.id}`,
    time: run.updatedAt,
    filter: run.status === 'error' ? 'errors' : 'system',
    type: 'quick action',
    title: `Quick Action: ${run.label}`,
    status,
    source: 'log',
    details: detailsOf([
      detail('Source', run.source),
      detail('Target', run.target),
      detail('Task', run.taskId),
      detail('Error', run.error),
    ]),
  }
}

function mapRoutineRun(run: NebulaRoutineRun): TimelineItem {
  const status: TimelineStatus =
    run.status === 'error' ? 'error' : run.status === 'cancelled' ? 'warning' : run.status === 'running' || run.status === 'queued' ? 'running' : 'success'
  return {
    id: `routine:${run.id}`,
    time: run.completedAt ?? run.startedAt ?? run.createdAt,
    filter: status === 'error' ? 'errors' : 'system',
    type: 'nebula routine',
    title: `Routine: ${run.routineName}`,
    status,
    source: 'log',
    relatedSkill: 'automation',
    details: detailsOf([
      detail('Trigger', run.triggerType),
      detail('Summary', run.summary),
      detail('Status', run.status),
      detail('Error', run.error),
      detail(
        'Steps',
        run.stepResults
          .map((step) => `${step.status}: ${step.label}${step.error ? ` - ${step.error}` : step.output ? ` - ${step.output}` : ''}`)
          .join('\n'),
        1200,
      ),
    ]),
  }
}

function safeRead<T>(reader: () => T, fallback: T) {
  try {
    return reader()
  } catch {
    return fallback
  }
}

function dedupe(items: TimelineItem[]) {
  const seen = new Set<string>()
  const result: TimelineItem[] = []

  for (const item of items) {
    const primaryDetail = item.details[0]?.value.slice(0, 120) ?? ''
    const key = `${item.time.slice(0, 19)}|${item.title}|${item.relatedSkill ?? ''}|${item.relatedModel ?? ''}|${primaryDetail}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }

  return result
}

export function getTimelineItems(logs: LogEvent[] = []) {
  const tasks = safeRead(getTaskRuns, [])
  const diagnostics = safeRead(getOrchestratorDiagnostics, [])
  const skillStats = Object.values(safeRead(getSkillRuntimeStats, {}))
  const notifications = safeRead(getNotifications, [])
  const memoryProposals = safeRead(getMemoryProposals, [])
  const sourceCards = safeRead(getSourceCards, [])
  const quickActions = safeRead(getQuickActionRuns, [])
  const routineRuns = safeRead(getNebulaRoutineRuns, [])

  return dedupe([
    ...logs.map(mapLog),
    ...tasks.flatMap((task) => (task.timeline ?? []).map((event) => mapTaskEvent(task, event))),
    ...diagnostics.flatMap(mapDiagnostic),
    ...skillStats.map(mapSkillStat),
    ...notifications.map(mapNotification),
    ...memoryProposals.map(mapMemoryProposal),
    ...sourceCards.map(mapSourceCard),
    ...quickActions.map(mapQuickAction),
    ...routineRuns.map(mapRoutineRun),
  ]).sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
}

export function filterTimelineItems(items: TimelineItem[], filter: TimelineFilter) {
  if (filter === 'all') return items
  return items.filter((item) => item.filter === filter)
}
