import { getModelRunStats } from './modelStats'
import { getOrchestratorDiagnostics } from './orchestratorDiagnostics'
import { getTaskRuns } from './tasks'
import { getTimelineItems } from './timeline'
import { getQuickActionRuns } from './quickActions'
import { getSkillRuntimeStats } from '../skills'
import type { LogEvent } from '../types/agent'
import type { InsightMetric } from '../types/nebula'

function today(iso: string) {
  return new Date(iso).toDateString() === new Date().toDateString()
}

function average(values: number[]) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function getInsightMetrics(logs: LogEvent[]): InsightMetric[] {
  const todayLogs = logs.filter((log) => today(log.createdAt))
  const routes = getOrchestratorDiagnostics().filter((event) => event.type === 'route')
  const todayRoutes = routes.filter((event) => today(event.createdAt))
  const modelStats = Object.values(getModelRunStats())
  const skillStats = Object.values(getSkillRuntimeStats())
  const timeline = getTimelineItems(logs)
  const filesAnalyzed = new Set(timeline.flatMap((item) => item.details.filter((detail) => detail.label === 'File').map((detail) => detail.value))).size
  const requests = todayLogs.filter((log) => log.type === 'user_message').length
  const avgResponse = average(modelStats.map((stat) => stat.lastResponseMs ?? 0).filter(Boolean))
  const avgConfidence = average(todayRoutes.map((event) => {
    const data = event.data as { confidence?: number } | undefined
    return data?.confidence ?? 0
  }).filter(Boolean))
  const topSkill = skillStats.sort((a, b) => b.usageCount - a.usageCount)[0]
  const mostUsedModel = modelStats.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
  const reviewCount = getOrchestratorDiagnostics().filter((event) => event.type === 'review' && today(event.createdAt)).length
  const quickRuns = getQuickActionRuns().filter((run) => today(run.createdAt)).length
  const activeTask = getTaskRuns().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
  const timeSavedMin = Math.max(0, Math.round(requests * 3 + quickRuns * 5 + filesAnalyzed * 1.5))

  return [
    { id: 'requests', label: "Today's requests", value: String(requests), detail: `${quickRuns} quick actions`, tone: 'good' },
    { id: 'response', label: 'Avg response time', value: avgResponse ? `${Math.round(avgResponse / 1000)}s` : 'n/a', detail: 'local model runs' },
    { id: 'confidence', label: 'Avg route confidence', value: avgConfidence ? `${Math.round(avgConfidence)}%` : 'n/a', detail: `${todayRoutes.length} routes` },
    { id: 'skills', label: 'Most used skill', value: topSkill?.skillId ?? 'none', detail: topSkill ? `${topSkill.usageCount} runs` : undefined },
    { id: 'project', label: 'Most active project', value: activeTask?.goal?.slice(0, 32) || 'n/a', detail: activeTask?.status },
    { id: 'reviews', label: 'Review count', value: String(reviewCount), detail: 'today' },
    { id: 'files', label: 'Files analyzed', value: String(filesAnalyzed), detail: 'from timeline' },
    { id: 'models', label: 'Models used', value: mostUsedModel?.model ?? 'n/a', detail: mostUsedModel?.roughTokensPerSecond ? `${mostUsedModel.roughTokensPerSecond} tok/s` : undefined },
    { id: 'saved', label: 'Time saved estimate', value: `${timeSavedMin}m`, detail: 'rough local estimate', tone: 'good' },
  ]
}
