import type { TrainingDatasetBundle, TrainingLogEntry } from '../types/nebula'
import { NEBULA_TRAINING_SYSTEM_PROMPT } from './nebulaIdentity'
import { writeLocalJson } from './safeStorage'

const TRAINING_LOGS_KEY = 'nebula-training-logs'
const MAX_TRAINING_LOGS = 1000
const REDACTION = '[REDACTED]'
const SAFE_GEMMA_TOOLS = new Set([
  'get_current_time',
  'get_system_info',
  'list_files',
  'read_file',
  'search_memory',
  'web_fetch',
  'web_search',
])

type TrainingMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string }

export interface TrainingEntryAssessment {
  eligible: boolean
  score: number
  reasons: string[]
  redacted: boolean
  sensitive: boolean
  identityLeak: boolean
  malformedTool: boolean
  unsafeTool: boolean
  routeMismatch: boolean
}

interface SanitizedText {
  value: string
  changed: boolean
  blocked: boolean
}

interface ParsedToolCall {
  tool: string
  args: Record<string, unknown>
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeLogs(logs: TrainingLogEntry[]) {
  try {
    writeLocalJson(TRAINING_LOGS_KEY, logs.slice(0, MAX_TRAINING_LOGS))
    window.dispatchEvent(new CustomEvent('nebula-training-logs-changed'))
  } catch {
    // Training logs are optional export data; storage failures must not break Nebula.
  }
}

function clip(value: string, limit: number) {
  const trimmed = value.trim()
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 3)}...` : trimmed
}

export function sanitizeTrainingText(input: string): SanitizedText {
  const rules: Array<{ pattern: RegExp; replacement: string; blocked?: boolean }> = [
    { pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replacement: REDACTION, blocked: true },
    { pattern: /\b(?:ghp|github_pat|xox[baprs]|rk_live|pk_live)_[A-Za-z0-9_-]{8,}\b/gi, replacement: REDACTION, blocked: true },
    { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: REDACTION, blocked: true },
    { pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replacement: REDACTION, blocked: true },
    { pattern: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd)\s*[:=]\s*[^\s,;"']+/gi, replacement: REDACTION, blocked: true },
    { pattern: /\b[A-Za-z]:\\Users\\[^\\\s]+/gi, replacement: '[USER_HOME]' },
    { pattern: /\\\\[^\\\s]+\\[^\s]+/g, replacement: '[NETWORK_PATH]' },
    { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: '[EMAIL]' },
    { pattern: /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/g, replacement: '[PRIVATE_IP]' },
    { pattern: /([?&](?:key|token|secret|signature|sig|auth)=)[^&#\s]+/gi, replacement: '$1[REDACTED]', blocked: true },
  ]

  let value = input
  let changed = false
  let blocked = false
  for (const rule of rules) {
    const next = value.replace(rule.pattern, rule.replacement)
    if (next !== value) {
      changed = true
      blocked ||= Boolean(rule.blocked)
      value = next
    }
  }
  return { value, changed, blocked }
}

function stableHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/jsonl;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function modelRole(entry: TrainingLogEntry): 'daily' | 'code' | 'review' | 'unknown' {
  const value = `${entry.model} ${entry.routeLabel ?? ''}`.toLowerCase()
  if (/review|gpt-?oss|critic/.test(value)) return 'review'
  if (/qwen|coder|coding|code route/.test(value)) return 'code'
  if (/gemma|daily|fast|nebula unified/.test(value)) return 'daily'
  return 'unknown'
}

function parseToolCall(value: string): ParsedToolCall | null {
  const trimmed = value.trim().replace(/^Tool call:\s*/i, '')
  try {
    const direct = JSON.parse(trimmed) as unknown
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      const record = direct as Record<string, unknown>
      if (typeof record.tool === 'string' && record.args && typeof record.args === 'object' && !Array.isArray(record.args)) {
        return { tool: record.tool, args: record.args as Record<string, unknown> }
      }
    }
  } catch {
    // Nebula's runtime log format is usually `tool_name: {args}` rather than direct JSON.
  }

  const match = trimmed.match(/^([a-z][a-z0-9_]*)\s*:\s*([\s\S]+)$/i)
  if (!match) return null
  try {
    const args = JSON.parse(match[2]) as unknown
    return args && typeof args === 'object' && !Array.isArray(args)
      ? { tool: match[1], args: args as Record<string, unknown> }
      : null
  } catch {
    return null
  }
}

function hasIdentityLeak(value: string) {
  return /\b(?:i am|i'm|my (?:underlying )?model is|i run on|as an?)\s+(?:google'?s?\s+|alibaba'?s?\s+|openai'?s?\s+)?(?:gemma|qwen|gpt(?:-?oss)?|llama|mistral|claude)\b/i.test(value)
}

function stripLoggedToolCalls(response: string, calls: ParsedToolCall[]) {
  let value = response
  for (const call of calls) {
    const json = JSON.stringify({ tool: call.tool, args: call.args })
    const args = JSON.stringify(call.args)
    value = value.replace(json, '')
    value = value.replace(`Tool call: ${call.tool} ${args}`, '')
  }
  return value.trim()
}

function buildTrainingMessages(entry: TrainingLogEntry): { messages: TrainingMessage[]; sanitizers: SanitizedText[]; calls: ParsedToolCall[] } {
  const prompt = sanitizeTrainingText(entry.prompt)
  const response = sanitizeTrainingText(entry.response)
  const toolCalls = entry.toolCalls.map((value) => sanitizeTrainingText(value))
  const toolResults = entry.toolResults.map((value) => sanitizeTrainingText(value))
  const calls = toolCalls.map((value) => parseToolCall(value.value)).filter((value): value is ParsedToolCall => Boolean(value))
  const messages: TrainingMessage[] = [
    { role: 'system', content: NEBULA_TRAINING_SYSTEM_PROMPT },
    { role: 'user', content: prompt.value },
  ]

  calls.forEach((call, index) => {
    messages.push({ role: 'assistant', content: JSON.stringify({ tool: call.tool, args: call.args }) })
    if (toolResults[index]?.value) messages.push({ role: 'tool', content: toolResults[index].value })
  })

  const finalResponse = stripLoggedToolCalls(response.value, calls)
  if (finalResponse) messages.push({ role: 'assistant', content: finalResponse })
  return { messages, sanitizers: [prompt, response, ...toolCalls, ...toolResults], calls }
}

export function assessTrainingEntry(entry: TrainingLogEntry): TrainingEntryAssessment {
  const built = buildTrainingMessages(entry)
  const reasons: string[] = []
  const role = modelRole(entry)
  const redacted = built.sanitizers.some((value) => value.changed)
  const sensitive = built.sanitizers.some((value) => value.blocked)
  const identityLeak = hasIdentityLeak(entry.response)
  const malformedTool = entry.toolCalls.length !== built.calls.length
  const unsafeTool = built.calls.some((call) => !SAFE_GEMMA_TOOLS.has(call.tool))
  const routeMismatch = role === 'code' || role === 'review'
  const finalAssistant = [...built.messages].reverse().find((message) => message.role === 'assistant')?.content ?? ''

  if (!entry.prompt.trim() || !finalAssistant.trim()) reasons.push('empty prompt or answer')
  if (entry.errors.length > 0) reasons.push('runtime error recorded')
  if (sensitive) reasons.push('credential-like data detected')
  if (identityLeak) reasons.push('underlying model identity leaked')
  if (malformedTool) reasons.push('malformed tool call')
  if (unsafeTool) reasons.push('tool is outside Gemma safe scope')
  if (routeMismatch) reasons.push('coding/review trace belongs to a specialist')
  if (/^\s*(?:\.{3}|loading|thinking)\s*$/i.test(finalAssistant)) reasons.push('placeholder answer')
  if (/LM Studio (?:error|request failed)|Failed to fetch|Model is unloaded/i.test(finalAssistant)) reasons.push('infrastructure error answer')
  if (entry.prompt.length > 12000 || finalAssistant.length > 16000) reasons.push('example is too large')

  let score = 30
  if (entry.accepted) score += 20
  if (entry.errors.length === 0) score += 10
  if (role === 'daily') score += 15
  if (entry.source === 'chat' || entry.source === 'voice') score += 10
  if (finalAssistant.length >= 8 && finalAssistant.length <= 5000) score += 10
  if (built.calls.length > 0 && !malformedTool && !unsafeTool) score += 10
  score -= reasons.length * 15
  score = Math.max(0, Math.min(100, score))

  return {
    eligible: reasons.length === 0 && score >= 70,
    score,
    reasons,
    redacted,
    sensitive,
    identityLeak,
    malformedTool,
    unsafeTool,
    routeMismatch,
  }
}

export function getTrainingLogs() {
  return readJson<TrainingLogEntry[]>(TRAINING_LOGS_KEY, [])
}

export function recordTrainingLog(input: Omit<TrainingLogEntry, 'id' | 'createdAt'>) {
  const values = [input.prompt, input.response, ...input.toolCalls, ...input.toolResults, ...input.errors].map((value) =>
    sanitizeTrainingText(clip(value, 16000)),
  )
  let cursor = 0
  const prompt = values[cursor++]
  const response = values[cursor++]
  const toolCalls = input.toolCalls.map(() => values[cursor++].value)
  const toolResults = input.toolResults.map(() => values[cursor++].value)
  const errors = input.errors.map(() => values[cursor++].value)
  const sensitive = values.some((value) => value.blocked)
  const entry: TrainingLogEntry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...input,
    prompt: prompt.value,
    response: response.value,
    toolCalls,
    toolResults,
    errors,
    accepted: input.accepted && !sensitive,
    tags: sensitive ? [...new Set([...input.tags, 'sensitive-redacted'])] : input.tags,
  }
  writeLogs([entry, ...getTrainingLogs()])
  return entry
}

export function setTrainingLogAccepted(id: string, accepted: boolean) {
  const next = getTrainingLogs().map((entry) => (entry.id === id ? { ...entry, accepted } : entry))
  writeLogs(next)
}

export function clearTrainingLogs() {
  writeLogs([])
}

export function trainingLogsToJsonl(logs = getTrainingLogs()) {
  return logs
    .map((entry) => {
      const built = buildTrainingMessages(entry)
      const assessment = assessTrainingEntry(entry)
      return JSON.stringify({
        messages: built.messages,
        metadata: {
          id: entry.id,
          source: entry.source,
          sourceModelRole: modelRole(entry),
          route: sanitizeTrainingText(entry.routeLabel ?? 'nebula').value,
          hasProjectContext: Boolean(entry.projectFolder),
          hasOpenedFile: Boolean(entry.openedFile),
          accepted: entry.accepted,
          eligible: assessment.eligible,
          qualityScore: assessment.score,
          rejectionReasons: assessment.reasons,
          tags: entry.tags,
          durationMs: Math.round(entry.durationMs),
          createdAt: entry.createdAt,
        },
      })
    })
    .join('\n')
}

export function buildFineTuneDataset(logs = getTrainingLogs(), validationPercent = 15): TrainingDatasetBundle {
  const audit = {
    total: logs.length,
    accepted: 0,
    rejected: 0,
    redacted: 0,
    invalid: 0,
    duplicate: 0,
    train: 0,
    validation: 0,
    qualityRejected: 0,
    sensitive: 0,
    identityLeaks: 0,
    malformedTools: 0,
    unsafeTools: 0,
    routeMismatch: 0,
  }
  const train: string[] = []
  const validation: string[] = []
  const seen = new Set<string>()
  const validationThreshold = Math.max(1, Math.min(40, Math.round(validationPercent)))

  for (const entry of logs) {
    const assessment = assessTrainingEntry(entry)
    if (assessment.redacted) audit.redacted += 1
    if (assessment.sensitive) audit.sensitive += 1
    if (assessment.identityLeak) audit.identityLeaks += 1
    if (assessment.malformedTool) audit.malformedTools += 1
    if (assessment.unsafeTool) audit.unsafeTools += 1
    if (assessment.routeMismatch) audit.routeMismatch += 1
    if (!assessment.eligible) {
      audit.rejected += 1
      audit.qualityRejected += 1
      if (!entry.prompt.trim() || !entry.response.trim() || entry.errors.length > 0) audit.invalid += 1
      continue
    }

    const built = buildTrainingMessages(entry)
    const fingerprint = JSON.stringify(built.messages)
    if (seen.has(fingerprint)) {
      audit.duplicate += 1
      continue
    }
    seen.add(fingerprint)
    audit.accepted += 1
    const line = JSON.stringify({
      messages: built.messages,
      metadata: {
        source: entry.source,
        sourceModelRole: 'daily',
        qualityScore: assessment.score,
        tags: entry.tags,
        createdAt: entry.createdAt,
      },
    })
    if (stableHash(fingerprint) % 100 < validationThreshold) {
      validation.push(line)
      audit.validation += 1
    } else {
      train.push(line)
      audit.train += 1
    }
  }

  return { trainJsonl: train.join('\n'), validationJsonl: validation.join('\n'), audit }
}

export function downloadTrainingLogs() {
  downloadText(`nebula-training-logs-${new Date().toISOString().slice(0, 10)}.jsonl`, trainingLogsToJsonl())
}

export function downloadFineTuneDataset(logs = getTrainingLogs()) {
  const bundle = buildFineTuneDataset(logs)
  const date = new Date().toISOString().slice(0, 10)
  downloadText(`nebula-train-${date}.jsonl`, bundle.trainJsonl)
  downloadText(`nebula-validation-${date}.jsonl`, bundle.validationJsonl)
  return bundle.audit
}
