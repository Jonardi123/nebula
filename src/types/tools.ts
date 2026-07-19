export type ToolName =
  | 'sleep_pc'
  | 'open_app'
  | 'list_files'
  | 'read_file'
  | 'write_file'
  | 'create_file'
  | 'append_file'
  | 'run_command'
  | 'search_memory'
  | 'write_memory'
  | 'get_system_info'
  | 'get_current_time'
  | 'capture_screen'
  | 'stop_agent'
  | 'web_search'
  | 'web_fetch'

export type RiskLevel = 'safe' | 'needs_approval' | 'high_risk' | 'blocked'

export interface ToolRequest {
  tool: ToolName
  args: Record<string, unknown>
}

export interface ToolResult {
  ok: boolean
  tool: ToolName
  output?: unknown
  error?: string
}

export interface ApprovalRequest {
  id: string
  toolRequest: ToolRequest
  riskLevel: RiskLevel
  reason: string
  requiresTypedConfirm: boolean
  oldContent?: string
  newContent?: string
}
