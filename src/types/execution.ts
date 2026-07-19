import type { ExecutionMode } from './settings'
import type { RiskLevel, ToolRequest } from './tools'

export type CommandStream = 'stdout' | 'stderr' | 'system'
export type CommandJobStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out'

export interface RuntimeExecutionGrant {
  mode: ExecutionMode
  grantedAt: string
  source: 'desktop' | 'mobile' | 'migration' | 'startup'
  expiresOnRestart: boolean
}

export interface CommandJob {
  id: string
  command: string
  cwd: string
  pid?: number
  status: CommandJobStatus
  startedAt: string
  finishedAt?: string
  code?: number | null
  stdout: string
  stderr: string
  truncated: boolean
}

export interface CommandEvent {
  jobId: string
  type: 'started' | 'output' | 'completed' | 'cancelled' | 'timed_out' | 'error'
  stream?: CommandStream
  data?: string
  code?: number | null
  createdAt: string
  truncated?: boolean
}

export interface ExecutionReceipt {
  id: string
  tool: string
  request: ToolRequest
  executionMode: ExecutionMode
  riskLevel: RiskLevel
  source: 'desktop' | 'mobile' | 'voice' | 'automation'
  status: 'approved' | 'rejected' | 'blocked' | 'running' | 'completed' | 'failed' | 'cancelled'
  summary: string
  startedAt: string
  finishedAt?: string
  durationMs?: number
  commandJobId?: string
}

export interface InstalledApp {
  id: string
  name: string
  path: string
  source: 'built_in' | 'start_menu' | 'custom'
  aliases: string[]
}

export interface AvatarPreset {
  id: import('./settings').ProfileAvatarPreset
  name: string
  category: import('./settings').ProfileAvatarCategory
  description: string
}
