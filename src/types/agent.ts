import type { ToolRequest, ToolResult } from './tools'

export type AgentStatus =
  | 'idle'
  | 'loading_model'
  | 'switching_model'
  | 'thinking'
  | 'reviewing'
  | 'waiting_approval'
  | 'running_tool'
  | 'stopped'
  | 'error'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  createdAt: string
  toolRequest?: ToolRequest
  toolResult?: ToolResult
  attachments?: import('./nebula').ComposerAttachment[]
}

export interface LogEvent {
  id: string
  type:
    | 'user_message'
    | 'ai_response'
    | 'tool_request'
    | 'tool_result'
    | 'approval'
    | 'command'
    | 'error'
    | 'memory'
    | 'status'
  message: string
  createdAt: string
  details?: unknown
}

export interface AgentTimelineItem {
  id: string
  label: string
  status: 'done' | 'active' | 'pending' | 'error'
}
