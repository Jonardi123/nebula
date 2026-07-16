import type { RiskLevel } from '../types/tools'

export type SkillCategory =
  | 'chat'
  | 'coding'
  | 'review'
  | 'files'
  | 'search'
  | 'terminal'
  | 'browser'
  | 'email'
  | 'screen'
  | 'voice'
  | 'clipboard'
  | 'diagnostics'
  | 'memory'
  | 'automation'
  | 'integration'
  | 'game'
  | 'other'

export type SkillPermission =
  | 'files.read'
  | 'files.write'
  | 'terminal.run'
  | 'apps.launch'
  | 'browser.use'
  | 'internet.use'
  | 'clipboard.read'
  | 'clipboard.write'
  | 'camera.use'
  | 'microphone.use'
  | 'screen.capture'
  | 'system.read'
  | 'system.settings'
  | 'memory.read'
  | 'memory.write'
  | 'email.send'
  | string

export type SkillModelPreference = 'daily' | 'code' | 'review' | 'auto'

export interface JsonSchemaLike {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export interface SkillToolDefinition {
  name: string
  description: string
  parameters: JsonSchemaLike
}

export interface SkillDefinition {
  id: string
  name: string
  description: string
  enabled: boolean
  requiredPermissions: SkillPermission[]
  tools: SkillToolDefinition[]
  systemPromptAdditions: string[]
  examples: string[]
  riskLevel: RiskLevel
  source?: 'core' | 'marketplace' | 'builder'
  version?: string
  author?: string
  tags?: string[]
  category?: SkillCategory
  keywords?: string[]
  requiredTools?: string[]
  modelPreference?: SkillModelPreference
  canRunInParallel?: boolean
  supportsVoice?: boolean
  supportsBackgroundExecution?: boolean
  estimatedLatencyMs?: number
  estimatedCost?: 'free' | 'low' | 'medium' | 'high'
  inputSchema?: JsonSchemaLike
  outputSchema?: JsonSchemaLike
  dependencies?: string[]
  exposesAgent?: string
  lazy?: boolean
  idleUnloadMs?: number
}

export interface SkillRuntimeStat {
  skillId: string
  usageCount: number
  errorCount: number
  averageRuntimeMs: number
  lastRuntimeMs?: number
  lastError?: string
  loadTimeMs?: number
  memoryUsageMb?: number
  health: 'healthy' | 'idle' | 'warning' | 'error' | 'disabled'
  updatedAt: string
}

export interface SkillMatch {
  skill: SkillDefinition
  confidence: number
  reason: string
}

export type MarketplaceItemKind = 'skill' | 'plugin'

export interface MarketplaceItem {
  id: string
  kind: MarketplaceItemKind
  name: string
  description: string
  author: string
  version: string
  category: string
  tags: string[]
  featured?: boolean
  installedSkill: SkillDefinition
}

export interface OpenAIToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: SkillToolDefinition['parameters']
  }
}
