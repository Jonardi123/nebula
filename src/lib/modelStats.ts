import type { ModelBenchmarkResult, ModelRunStat } from '../types/nebula'
import { writeLocalJson } from './safeStorage'

const RUN_STATS_KEY = 'nebula-model-run-stats'
const BENCH_KEY = 'nebula-bench-results'

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T) {
  try {
    writeLocalJson(key, value)
  } catch {
    // Model stats are diagnostic only; storage failures should not break chat.
  }
}

export function getModelRunStats(): Record<string, ModelRunStat> {
  return readJson<Record<string, ModelRunStat>>(RUN_STATS_KEY, {})
}

export function approxJsHeapMb() {
  const memory = (performance as any).memory
  if (!memory?.usedJSHeapSize) return undefined
  return Number((memory.usedJSHeapSize / 1024 / 1024).toFixed(1))
}

export function recordModelRun(
  model: string,
  responseMs: number,
  text: string,
  extra: Partial<ModelRunStat> = {},
) {
  if (!model) return
  const stats = getModelRunStats()
  const roughTokens = Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length * 1.25))
  stats[model] = {
    ...(stats[model] ?? {}),
    model,
    ...extra,
    lastResponseMs: responseMs,
    roughTokensPerSecond: Number((roughTokens / Math.max(responseMs / 1000, 0.1)).toFixed(2)),
    approxJsHeapMb: approxJsHeapMb(),
    updatedAt: new Date().toISOString(),
  }
  writeJson(RUN_STATS_KEY, stats)
}

export function recordModelLoadMetric(model: string, update: Partial<ModelRunStat>) {
  if (!model) return
  const stats = getModelRunStats()
  stats[model] = {
    ...(stats[model] ?? { model }),
    model,
    ...update,
    approxJsHeapMb: approxJsHeapMb(),
    updatedAt: new Date().toISOString(),
  }
  writeJson(RUN_STATS_KEY, stats)
}

export function recordModelFallback(model: string, fallback: string, reason: string) {
  recordModelLoadMetric(model, {
    lastFallback: `${fallback}: ${reason}`,
  })
}

export function recordModelError(model: string, error: string) {
  if (!model) return
  const stats = getModelRunStats()
  stats[model] = {
    ...(stats[model] ?? { model }),
    model,
    lastError: error,
    updatedAt: new Date().toISOString(),
  }
  writeJson(RUN_STATS_KEY, stats)
}

export function getBenchmarkResults() {
  return readJson<ModelBenchmarkResult[]>(BENCH_KEY, [])
}

export function saveBenchmarkResult(result: ModelBenchmarkResult) {
  const results = [result, ...getBenchmarkResults()].slice(0, 80)
  writeJson(BENCH_KEY, results)
  return results
}
