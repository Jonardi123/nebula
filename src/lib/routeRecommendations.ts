import type { ModelRouteRecommendation } from '../types/nebula'
import type { AppSettings } from '../types/settings'
import { getBenchmarkResults, getModelRunStats } from './modelStats'

function modelScore(model: string, role: ModelRouteRecommendation['role']) {
  const stats = getModelRunStats()[model]
  const bench = getBenchmarkResults().filter((result) => result.model === model)
  let score = 0
  const reasons: string[] = []

  if (stats?.lastError) {
    score -= 20
    reasons.push(`last error: ${stats.lastError}`)
  }
  if (stats?.roughTokensPerSecond) {
    score += stats.roughTokensPerSecond
    reasons.push(`${stats.roughTokensPerSecond} rough tok/s in last run`)
  }
  if (stats?.lastResponseMs && stats.lastResponseMs < 5000) {
    score += 8
    reasons.push('recent response was quick')
  }

  const relevantTests = role === 'daily' ? ['hello', 'tool_json'] : role === 'code' ? ['code', 'tool_json'] : ['review', 'code']
  for (const result of bench.slice(0, 20)) {
    if (!relevantTests.includes(result.test)) continue
    score += result.ok ? 18 : -12
    score += result.ok ? Math.max(0, 10 - result.latencyMs / 1000) : 0
    reasons.push(`${result.test} bench ${result.ok ? 'passed' : 'failed'} in ${Math.round(result.latencyMs)} ms`)
  }

  return { score, reasons: reasons.slice(0, 4) }
}

export function getModelRouteRecommendations(settings: AppSettings): ModelRouteRecommendation[] {
  if (settings.modelRoutingSuggestions === false) return []

  const candidates = Array.from(
    new Set(
      [
        settings.model,
        settings.fastModel,
        settings.codeModel,
        settings.reviewModel,
        settings.modelAssignments?.daily,
        settings.modelAssignments?.code,
        settings.modelAssignments?.review,
        ...getBenchmarkResults().map((result) => result.model),
        ...Object.keys(getModelRunStats()),
      ].filter(Boolean),
    ),
  ) as string[]

  const roles: ModelRouteRecommendation['role'][] = ['daily', 'code', 'review']
  return roles
    .map((role) => {
      const currentModel = settings.modelAssignments?.[role] || (role === 'daily' ? settings.fastModel : role === 'code' ? settings.codeModel : settings.reviewModel)
      const ranked = candidates
        .map((model) => ({ model, ...modelScore(model, role) }))
        .filter((item) => item.reasons.length > 0)
        .sort((a, b) => b.score - a.score)
      const best = ranked[0]
      if (!best || best.model === currentModel || best.score <= 0) return null

      return {
        id: `${role}:${best.model}`,
        role,
        currentModel,
        recommendedModel: best.model,
        confidence: Math.max(35, Math.min(95, Math.round(best.score))),
        reasons: best.reasons,
        createdAt: new Date().toISOString(),
      } satisfies ModelRouteRecommendation
    })
    .filter(Boolean) as ModelRouteRecommendation[]
}
