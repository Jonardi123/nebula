import type { AgentStatus, PublicRunStage } from '../types/agent'

export function publicRunStageForStatus(status: AgentStatus): PublicRunStage {
  if (status === 'loading_model' || status === 'switching_model') return 'preparing'
  if (status === 'thinking') return 'reading_context'
  if (status === 'running_tool' || status === 'waiting_approval') return 'using_tool'
  if (status === 'reviewing') return 'checking_answer'
  if (status === 'stopped') return 'stopped'
  if (status === 'error') return 'error'
  return 'ready'
}

export function publicRunStageLabel(stage: PublicRunStage) {
  if (stage === 'preparing') return 'Preparing'
  if (stage === 'reading_context') return 'Reading context'
  if (stage === 'searching_web') return 'Searching the web'
  if (stage === 'using_tool') return 'Using a tool'
  if (stage === 'checking_answer') return 'Checking the answer'
  if (stage === 'responding') return 'Responding'
  if (stage === 'finished') return 'Finished'
  if (stage === 'stopped') return 'Stopped'
  if (stage === 'error') return 'Needs attention'
  return 'Ready'
}
