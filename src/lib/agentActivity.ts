import { getQuickActionRuns } from './quickActions'
import { getOrchestratorDiagnostics } from './orchestratorDiagnostics'
import { getSkillRuntimeStats } from '../skills'
import type { AgentStatus, LogEvent } from '../types/agent'
import type { AgentActivityState } from '../types/nebula'

function duration(startedAt?: string) {
  if (!startedAt) return undefined
  return Math.max(0, Date.now() - new Date(startedAt).getTime())
}

function latestRoute() {
  return getOrchestratorDiagnostics().find((event) => event.type === 'route')
}

function latestSkill() {
  return Object.values(getSkillRuntimeStats()).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
}

function latestTask(logs: LogEvent[]) {
  return getQuickActionRuns().find((run) => run.status === 'running')?.label ?? logs.slice().reverse().find((log) => log.type === 'user_message')?.message
}

export function getAgentActivity(agentStatus: AgentStatus, logs: LogEvent[]): AgentActivityState[] {
  const route = latestRoute()
  const skill = latestSkill()
  const task = latestTask(logs)
  const statusStarted = logs.slice().reverse().find((log) => log.message.includes(`Agent status: ${agentStatus}`))?.createdAt
  const state =
    agentStatus === 'thinking' || agentStatus === 'loading_model' || agentStatus === 'switching_model'
      ? 'thinking'
      : agentStatus === 'running_tool'
        ? 'running'
        : agentStatus === 'waiting_approval'
          ? 'waiting'
          : agentStatus === 'reviewing'
            ? 'reviewing'
            : agentStatus === 'error'
              ? 'error'
              : 'idle'

  return [
    {
      id: 'planner',
      name: 'Planner',
      state: state === 'thinking' ? 'thinking' : 'idle',
      currentTask: task,
      startedAt: statusStarted,
      durationMs: duration(statusStarted),
      selectedModel: route?.model,
      activeSkill: route?.data && typeof route.data === 'object' ? undefined : undefined,
      estimatedCompletion: state === 'thinking' ? 'moments' : undefined,
    },
    {
      id: 'coding',
      name: 'Coding Agent',
      state: route?.role === 'code' && state !== 'idle' ? state : 'idle',
      currentTask: route?.role === 'code' ? task : undefined,
      selectedModel: route?.role === 'code' ? route.model : undefined,
      activeSkill: skill?.skillId,
      durationMs: duration(statusStarted),
    },
    {
      id: 'review',
      name: 'Review Agent',
      state: agentStatus === 'reviewing' || route?.role === 'review' ? 'reviewing' : 'idle',
      currentTask: route?.role === 'review' ? task : undefined,
      selectedModel: route?.role === 'review' ? route.model : undefined,
      durationMs: duration(statusStarted),
    },
    {
      id: 'memory',
      name: 'Memory Agent',
      state: logs.slice(-12).some((log) => log.type === 'memory') ? 'running' : 'idle',
      currentTask: logs.slice().reverse().find((log) => log.type === 'memory')?.message,
      activeSkill: 'memory',
    },
    {
      id: 'search',
      name: 'Search Agent',
      state: skill?.skillId?.includes('web') ? 'running' : 'idle',
      currentTask: skill?.skillId?.includes('web') ? 'Web research' : undefined,
      activeSkill: skill?.skillId?.includes('web') ? skill.skillId : undefined,
    },
    {
      id: 'safety',
      name: 'Safety Agent',
      state: agentStatus === 'waiting_approval' ? 'waiting' : logs.slice(-12).some((log) => log.type === 'approval') ? 'running' : 'idle',
      currentTask: logs.slice().reverse().find((log) => log.type === 'approval')?.message,
      activeSkill: 'commandSafety',
    },
    {
      id: 'future',
      name: 'Future Agents',
      state: 'idle',
      note: 'Connector slots only. No cloud API calls are active.',
    },
  ]
}
