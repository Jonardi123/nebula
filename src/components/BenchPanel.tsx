import { Gauge, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { sendChat } from '../lib/lmstudio'
import { getBenchmarkResults, saveBenchmarkResult } from '../lib/modelStats'
import { getModelRouteRecommendations } from '../lib/routeRecommendations'
import type { ModelBenchmarkResult } from '../types/nebula'
import type { AppSettings } from '../types/settings'
import type { LogEvent } from '../types/agent'

export function BenchPanel({
  settings,
  onLog,
}: {
  settings: AppSettings
  onLog: (type: LogEvent['type'], message: string, details?: unknown) => void
}) {
  const [results, setResults] = useState<ModelBenchmarkResult[]>([])
  const [running, setRunning] = useState('')
  const recommendations = getModelRouteRecommendations(settings)

  function refresh() {
    setResults(getBenchmarkResults())
  }

  async function run(model: string, test: ModelBenchmarkResult['test']) {
    setRunning(`${model}:${test}`)
    const started = Date.now()
    try {
      const prompt =
        test === 'hello'
          ? 'Reply with one short friendly sentence.'
          : test === 'tool_json'
            ? 'Output only this JSON exactly: {"tool":"get_current_time","args":{}}'
            : test === 'code'
              ? 'In one paragraph, explain what package.json usually tells you about a TypeScript app.'
              : 'Briefly review this claim: local AI assistants should cite sources for current web facts.'
      const output = await sendChat({ ...settings, model, maxTokens: test === 'hello' ? 80 : 220, temperature: 0.2 }, [
        { id: crypto.randomUUID(), role: 'user', content: prompt, createdAt: new Date().toISOString() },
      ])
      const result = saveBenchmarkResult({
        id: crypto.randomUUID(),
        model,
        test,
        ok: true,
        latencyMs: Date.now() - started,
        output,
        createdAt: new Date().toISOString(),
      })
      setResults(result)
      onLog('status', `Bench ${test} passed for ${model}.`)
    } catch (error) {
      const result = saveBenchmarkResult({
        id: crypto.randomUUID(),
        model,
        test,
        ok: false,
        latencyMs: Date.now() - started,
        output: '',
        error: error instanceof Error ? error.message : String(error),
        createdAt: new Date().toISOString(),
      })
      setResults(result)
      onLog('error', `Bench ${test} failed for ${model}.`)
    } finally {
      setRunning('')
    }
  }

  useEffect(refresh, [])

  const models = [
    settings.modelAssignments?.daily || settings.fastModel,
    settings.modelAssignments?.code || settings.codeModel,
    settings.modelAssignments?.review || settings.reviewModel,
  ].filter(Boolean)

  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="grid grid-cols-2 gap-2">
        {models.map((model) => (
          <section key={model} className="rounded-md border border-slate-800 bg-slate-950 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Gauge size={14} className="text-cyan-200" />
              <span className="truncate">{model}</span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {(['hello', 'tool_json', 'code', 'review'] as const).map((test) => (
                <button key={test} className="nebula-toggle flex items-center justify-center gap-1 px-2 py-2" type="button" disabled={Boolean(running)} onClick={() => run(model, test)}>
                  <Play size={10} />
                  {running === `${model}:${test}` ? '...' : test}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {recommendations.length > 0 && (
        <section className="rounded-md border border-fuchsia-300/25 bg-fuchsia-300/10 p-3">
          <div className="mb-2 text-sm font-semibold text-fuchsia-50">Bench Recommendations</div>
          <div className="space-y-2">
            {recommendations.map((recommendation) => (
              <div key={recommendation.id} className="rounded-md border border-white/10 bg-black/20 p-2">
                <div className="text-xs font-semibold text-slate-100">
                  {recommendation.role}: {recommendation.recommendedModel}
                </div>
                <div className="mt-1 text-[11px] text-slate-400">Suggested from local stats. Apply from Models.</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="space-y-2">
        {results.map((result) => (
          <section key={result.id} className="skill-card rounded-md border border-slate-800 bg-slate-950 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-100">{result.test}</span>
              <span className={result.ok ? 'text-emerald-200' : 'text-red-200'}>{Math.round(result.latencyMs)} ms</span>
            </div>
            <div className="terminal-font mt-1 break-all text-[11px] text-slate-500">{result.model}</div>
            <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-slate-300">{result.error ?? result.output}</p>
          </section>
        ))}
      </div>
    </div>
  )
}
