import type { AgentStatus } from '../types/agent'
import type { NebulaServiceState } from '../types/nebula'
import type { AppSettings } from '../types/settings'

export function deriveServiceState(settings: AppSettings, online: boolean, agentStatus: AgentStatus, healthDetail = ''): NebulaServiceState {
  const provider = settings.modelProvider ?? 'lmstudio'
  const providerName = provider === 'openrouter' ? 'OpenRouter' : provider === '9router' ? '9Router' : 'LM Studio'
  const checking = agentStatus === 'loading_model' || agentStatus === 'switching_model'
  const phase: NebulaServiceState['phase'] = checking ? 'checking' : online && healthDetail ? 'degraded' : online ? 'online' : 'offline'
  return {
    provider,
    phase,
    label: checking ? `${providerName} preparing` : online && healthDetail ? `${providerName} needs attention` : online ? `${providerName} ready` : `${providerName} unavailable`,
    detail: healthDetail || (online
      ? provider === 'lmstudio' ? 'Local inference service is reachable.' : 'Remote provider is reachable; local fallback remains separate.'
      : provider === 'lmstudio' ? 'Open LM Studio and start its local server.' : `Check ${providerName} credentials or endpoint.`),
    checkedAt: new Date().toISOString(),
  }
}
