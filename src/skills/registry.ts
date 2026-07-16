import type { ToolName } from '../types/tools'
import { SUPPORTED_TOOLS } from '../lib/tools'
import { recordDiagnosticEvent } from '../lib/orchestratorDiagnostics'
import type {
  SkillCategory,
  SkillDefinition,
  SkillMatch,
  SkillModelPreference,
  SkillRuntimeStat,
} from './types'

const SKILL_STATS_KEY = 'nebula-skill-runtime-stats'
const executableTools = new Set<string>(SUPPORTED_TOOLS)

const DEFAULT_KEYWORDS: Record<string, string[]> = {
  memory: ['memory', 'remember', 'preference', 'lesson', 'recall'],
  files: ['file', 'read', 'write', 'folder', 'project', 'package.json', 'readme'],
  terminal: ['terminal', 'command', 'powershell', 'npm', 'build', 'test', 'git'],
  web_search: ['web', 'search', 'current', 'latest', 'internet', 'docs'],
  web_fetch: ['url', 'fetch', 'webpage', 'source', 'article'],
  screen: ['screen', 'screenshot', 'vision', 'display'],
  pc_control: ['open app', 'sleep pc', 'windows', 'calculator', 'notepad'],
}

const CATEGORY_BY_ID: Record<string, SkillCategory> = {
  memory: 'memory',
  files: 'files',
  terminal: 'terminal',
  web_search: 'search',
  web_fetch: 'browser',
  screen: 'screen',
  pc_control: 'automation',
}

const MODEL_BY_CATEGORY: Partial<Record<SkillCategory, SkillModelPreference>> = {
  chat: 'daily',
  coding: 'code',
  files: 'code',
  terminal: 'code',
  review: 'review',
  diagnostics: 'review',
  memory: 'auto',
  search: 'auto',
  browser: 'auto',
  screen: 'auto',
  voice: 'daily',
}

function readStats() {
  try {
    return JSON.parse(localStorage.getItem(SKILL_STATS_KEY) ?? '{}') as Record<string, SkillRuntimeStat>
  } catch {
    return {}
  }
}

function writeStats(stats: Record<string, SkillRuntimeStat>) {
  try {
    localStorage.setItem(SKILL_STATS_KEY, JSON.stringify(stats))
    window.dispatchEvent(new CustomEvent('nebula-skills-runtime-changed'))
  } catch {
    // Runtime skill stats are best-effort diagnostics.
  }
}

function approxMemoryMb() {
  const memory = (performance as any).memory
  if (!memory?.usedJSHeapSize) return undefined
  return Number((memory.usedJSHeapSize / 1024 / 1024).toFixed(1))
}

function normalizeWords(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_.:/\\-]+/)
    .filter(Boolean)
}

function defaultKeywords(skill: SkillDefinition) {
  return [
    ...(DEFAULT_KEYWORDS[skill.id] ?? []),
    ...normalizeWords(skill.name),
    ...normalizeWords(skill.description),
    ...(skill.tags ?? []),
    ...skill.tools.map((tool) => tool.name),
  ]
}

function defaultCategory(skill: SkillDefinition): SkillCategory {
  if (skill.category) return skill.category
  if (CATEGORY_BY_ID[skill.id]) return CATEGORY_BY_ID[skill.id]
  if (skill.tools.some((tool) => tool.name.includes('file'))) return 'files'
  if (skill.tools.some((tool) => tool.name.includes('web'))) return 'search'
  if (skill.tools.some((tool) => tool.name.includes('command'))) return 'terminal'
  return 'other'
}

export function normalizeSkill(skill: SkillDefinition): SkillDefinition {
  const category = defaultCategory(skill)
  const keywords = Array.from(new Set([...(skill.keywords ?? []), ...defaultKeywords(skill)]))
  return {
    ...skill,
    category,
    keywords,
    version: skill.version ?? '0.1.0',
    author: skill.author ?? (skill.source === 'builder' ? 'Jonard' : 'Nebula Core'),
    requiredTools: skill.requiredTools ?? skill.tools.map((tool) => tool.name),
    modelPreference: skill.modelPreference ?? MODEL_BY_CATEGORY[category] ?? 'auto',
    canRunInParallel: skill.canRunInParallel ?? !['terminal', 'automation'].includes(category),
    supportsVoice: skill.supportsVoice ?? ['chat', 'memory', 'search', 'screen', 'voice'].includes(category),
    supportsBackgroundExecution: skill.supportsBackgroundExecution ?? ['memory', 'search', 'diagnostics'].includes(category),
    estimatedLatencyMs: skill.estimatedLatencyMs ?? (category === 'terminal' ? 4000 : category === 'search' ? 2500 : 900),
    estimatedCost: skill.estimatedCost ?? 'free',
    inputSchema: skill.inputSchema ?? {
      type: 'object',
      properties: {
        request: { type: 'string', description: 'User request.' },
      },
      required: ['request'],
      additionalProperties: true,
    },
    outputSchema: skill.outputSchema ?? {
      type: 'object',
      properties: {
        result: { type: 'string', description: 'Unified Nebula response or tool result.' },
      },
      additionalProperties: true,
    },
    dependencies: skill.dependencies ?? [],
    lazy: skill.lazy ?? true,
    idleUnloadMs: skill.idleUnloadMs ?? 120000,
  }
}

export function normalizeSkills(skills: SkillDefinition[]) {
  return skills.map(normalizeSkill)
}

export function getExecutableSkillTools(skill: SkillDefinition) {
  return skill.tools.filter((tool) => executableTools.has(tool.name))
}

export function getExecutableToolNames(skills: SkillDefinition[]) {
  return new Set(
    skills.flatMap((skill) =>
      getExecutableSkillTools(skill)
        .map((tool) => tool.name)
        .filter((name): name is ToolName => executableTools.has(name)),
    ),
  )
}

function scoreSkill(skill: SkillDefinition, userText: string) {
  const text = userText.toLowerCase()
  const words = new Set(normalizeWords(userText))
  const keywords = skill.keywords ?? []
  let score = 0
  const reasons: string[] = []

  for (const keyword of keywords) {
    const normalized = keyword.toLowerCase()
    if (!normalized) continue
    if (text.includes(normalized) || words.has(normalized)) {
      score += normalized.length > 8 ? 18 : 12
      if (reasons.length < 3) reasons.push(`matched "${keyword}"`)
    }
  }

  if (skill.category === 'files' && /\b(read|write|file|folder|project|package\.json|readme|src[\\/])\b/i.test(userText)) score += 28
  if (skill.category === 'terminal' && /\b(command|terminal|npm|build|test|git|powershell|run)\b/i.test(userText)) score += 30
  if (skill.category === 'memory' && /\b(remember|memory|preference|lesson|recall)\b/i.test(userText)) score += 26
  if (skill.category === 'search' && /\b(search|current|latest|web|internet|docs?|source)\b/i.test(userText)) score += 24
  if (skill.category === 'screen' && /\b(screen|screenshot|look at|see this|vision)\b/i.test(userText)) score += 26
  if (skill.category === 'diagnostics' && /\b(diagnostics|latency|vram|ram|model|health|stats)\b/i.test(userText)) score += 26
  if (skill.category === 'review' && /\b(review|audit|check|safe|bugs|architecture)\b/i.test(userText)) score += 28
  if (skill.category === 'coding' && /\b(code|debug|fix|refactor|typescript|react|tauri)\b/i.test(userText)) score += 28

  return {
    confidence: Math.min(100, score),
    reason: reasons.length ? reasons.join(', ') : 'category heuristic',
  }
}

export function selectSkillsForRequest(skills: SkillDefinition[], userText: string, maxSkills = 4): SkillMatch[] {
  return normalizeSkills(skills)
    .filter((skill) => skill.enabled)
    .map((skill) => {
      const score = scoreSkill(skill, userText)
      return { skill, confidence: score.confidence, reason: score.reason }
    })
    .filter((match) => match.confidence >= 18)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxSkills)
}

export function getSkillRuntimeStats() {
  return readStats()
}

export function getSkillRuntimeStat(skill: SkillDefinition): SkillRuntimeStat {
  const normalized = normalizeSkill(skill)
  const stats = readStats()
  return stats[skill.id] ?? {
    skillId: normalized.id,
    usageCount: 0,
    errorCount: 0,
    averageRuntimeMs: 0,
    health: normalized.enabled ? 'idle' : 'disabled',
    loadTimeMs: normalized.lazy ? 0 : normalized.estimatedLatencyMs,
    memoryUsageMb: approxMemoryMb(),
    updatedAt: new Date().toISOString(),
  }
}

export function recordSkillExecution(skillId: string, runtimeMs: number, ok: boolean, error?: string) {
  const stats = readStats()
  const previous = stats[skillId]
  const usageCount = (previous?.usageCount ?? 0) + 1
  const errorCount = (previous?.errorCount ?? 0) + (ok ? 0 : 1)
  const averageRuntimeMs = previous
    ? Math.round((previous.averageRuntimeMs * previous.usageCount + runtimeMs) / usageCount)
    : Math.round(runtimeMs)

  stats[skillId] = {
    skillId,
    usageCount,
    errorCount,
    averageRuntimeMs,
    lastRuntimeMs: Math.round(runtimeMs),
    lastError: ok ? previous?.lastError : error,
    health: ok ? 'healthy' : 'error',
    memoryUsageMb: approxMemoryMb(),
    updatedAt: new Date().toISOString(),
  }
  writeStats(stats)
  recordDiagnosticEvent({
    type: 'metric',
    label: `Skill executed: ${skillId}`,
    detail: ok ? `${Math.round(runtimeMs)} ms` : `${Math.round(runtimeMs)} ms - ${error ?? 'error'}`,
    data: stats[skillId],
  })
  window.dispatchEvent(new CustomEvent('nebula-skill-executed', { detail: stats[skillId] }))
  return stats[skillId]
}

export function findSkillForTool(skills: SkillDefinition[], toolName: string) {
  return normalizeSkills(skills)
    .filter((skill) => skill.enabled)
    .sort((a, b) => (a.riskLevel === 'safe' ? -1 : 0) - (b.riskLevel === 'safe' ? -1 : 0))
    .find((skill) => skill.tools.some((tool) => tool.name === toolName))
}
