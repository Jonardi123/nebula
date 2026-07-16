export type CancellationReason = 'user' | 'superseded' | 'shutdown' | 'timeout' | 'model_switch'
export type AgentRunStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'completed' | 'error'

export interface AgentRunState {
  runId: string
  status: AgentRunStatus
  startedAt: string
  cancellationReason?: CancellationReason
}

export class AgentRunController {
  readonly runId = crypto.randomUUID()
  readonly abortController = new AbortController()
  readonly startedAt = new Date().toISOString()
  status: AgentRunStatus = 'starting'
  cancellationReason?: CancellationReason

  get signal() { return this.abortController.signal }
  start() { this.status = 'running' }
  cancel(reason: CancellationReason = 'user') {
    if (this.signal.aborted || this.status === 'completed') return
    this.status = 'stopping'
    this.cancellationReason = reason
    this.abortController.abort(reason)
    this.status = 'stopped'
  }
  complete() { if (!this.signal.aborted) this.status = 'completed' }
  fail() { if (!this.signal.aborted) this.status = 'error' }
  snapshot(): AgentRunState {
    return { runId: this.runId, status: this.status, startedAt: this.startedAt, cancellationReason: this.cancellationReason }
  }
}

export function throwIfRunCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Nebula request cancelled.', 'AbortError')
}
