import { describe, expect, it } from 'vitest'
import type { TrainingLogEntry } from '../types/nebula'
import { assessTrainingEntry, buildFineTuneDataset, sanitizeTrainingText, trainingLogsToJsonl } from './trainingLogs'

function trainingLog(overrides: Partial<TrainingLogEntry> = {}): TrainingLogEntry {
  return {
    id: 'trace-one',
    source: 'chat',
    prompt: 'Help me plan my afternoon in two sentences.',
    response: 'Choose the one result that matters most, then give it twenty focused minutes before planning anything else.',
    model: 'google_-_gemma-7b-it',
    routeLabel: 'Nebula unified route',
    toolCalls: [],
    toolResults: [],
    errors: [],
    accepted: true,
    tags: ['chat', 'auto', 'no-tools'],
    durationMs: 1200,
    createdAt: '2026-07-10T10:00:00.000Z',
    ...overrides,
  }
}

describe('Gemma training data gate', () => {
  it('accepts a clean daily Nebula trace', () => {
    const assessment = assessTrainingEntry(trainingLog())
    expect(assessment.eligible).toBe(true)
    expect(assessment.score).toBeGreaterThanOrEqual(70)
  })

  it('audits but excludes coding and review model traces', () => {
    const code = assessTrainingEntry(trainingLog({ model: 'qwen/qwen2.5-coder-14b', routeLabel: 'code' }))
    const review = assessTrainingEntry(trainingLog({ model: 'openai-gpt-oss-20b', routeLabel: 'review' }))
    expect(code.routeMismatch).toBe(true)
    expect(review.routeMismatch).toBe(true)
    expect(code.eligible).toBe(false)
    expect(review.eligible).toBe(false)
  })

  it('rejects underlying model identity leakage', () => {
    const assessment = assessTrainingEntry(trainingLog({ response: 'I am Gemma, a model made by Google.' }))
    expect(assessment.identityLeak).toBe(true)
    expect(assessment.eligible).toBe(false)
  })

  it('preserves safe tool grounding as exact JSON and tool turns', () => {
    const entry = trainingLog({
      prompt: 'Use get_current_time and tell me the result.',
      response: 'The confirmed local time is 4:30 PM.',
      toolCalls: ['get_current_time: {}'],
      toolResults: ['get_current_time: 2026-07-10T16:30:00+02:00'],
      tags: ['chat', 'tools'],
    })
    expect(assessTrainingEntry(entry).eligible).toBe(true)
    const exported = JSON.parse(trainingLogsToJsonl([entry]))
    expect(exported.messages[2]).toEqual({ role: 'assistant', content: '{"tool":"get_current_time","args":{}}' })
    expect(exported.messages[3].role).toBe('tool')
    expect(exported.messages.at(-1).content).toContain('confirmed local time')
  })

  it('redacts private paths and blocks credential-like values', () => {
    const sanitized = sanitizeTrainingText('Read C:\\Users\\Example\\private\\notes.md and use token=sk-example-secret-token-1234')
    expect(sanitized.value).toContain('[USER_HOME]')
    expect(sanitized.value).not.toContain('jonar')
    expect(sanitized.value).toContain('[REDACTED]')
    expect(sanitized.blocked).toBe(true)
  })

  it('reports every rejected class without placing it in the split', () => {
    const bundle = buildFineTuneDataset([
      trainingLog(),
      trainingLog({ id: 'code', model: 'qwen/qwen2.5-coder-14b' }),
      trainingLog({ id: 'leak', response: "I'm Qwen, your coding model." }),
      trainingLog({ id: 'unsafe', toolCalls: ['run_command: {"command":"dir"}'], toolResults: ['ok'] }),
    ])
    expect(bundle.audit.total).toBe(4)
    expect(bundle.audit.accepted).toBe(1)
    expect(bundle.audit.routeMismatch).toBe(1)
    expect(bundle.audit.identityLeaks).toBe(1)
    expect(bundle.audit.unsafeTools).toBe(1)
    expect(bundle.audit.train + bundle.audit.validation).toBe(1)
  })
})
