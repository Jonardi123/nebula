export type VoicePhase =
  | 'idle'
  | 'permission'
  | 'preparing'
  | 'listening'
  | 'submit_countdown'
  | 'thinking'
  | 'speaking'
  | 'error'

export type VoiceErrorCode =
  | 'microphone_denied'
  | 'speech_permission_denied'
  | 'unsupported_language'
  | 'unavailable_service'
  | 'no_speech'
  | 'network_failure'
  | 'audio_capture_failure'
  | 'cancelled'

export type VoiceEngine = 'webview_local' | 'webview_online' | 'apple_local' | 'apple_online' | 'browser' | 'text'

export interface VoiceFailure {
  code: VoiceErrorCode
  message: string
  recoverable: boolean
  requiresOnlineConsent?: boolean
  rawCode?: string
}

export interface VoiceRequest {
  requestId: string
  text: string
  source: 'ambient' | 'desktop_chat' | 'mobile'
}

export type VoiceRunEventType =
  | 'accepted'
  | 'listening'
  | 'thinking'
  | 'tool_activity'
  | 'approval_required'
  | 'approval_resolved'
  | 'final'
  | 'error'
  | 'cancelled'
  | 'completed'

export interface VoiceRunEvent {
  requestId: string
  type: VoiceRunEventType
  message?: string
  response?: string
  approval?: {
    id: string
    title: string
    detail: string
    risk: 'safe' | 'needs_approval' | 'high_risk' | 'blocked'
    requiresTypedConfirmation?: boolean
  }
}

export interface VoiceApprovalDecision {
  requestId: string
  approvalId: string
  approved: boolean
  confirmation?: string
}
