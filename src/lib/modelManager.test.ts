import { describe, expect, it } from 'vitest'
import { resolveReportedModel } from './modelManager'

describe('model manager loaded-model resolution', () => {
  const models = [
    { id: 'lmstudio-community/Qwen3-4B-GGUF' },
    { id: 'nebula/qwen2.5-coder-1.5b-v1' },
  ]

  it('resolves a configured alias to LM Studio\'s reported model id', () => {
    expect(resolveReportedModel('Qwen3 4B', models)).toBe('lmstudio-community/Qwen3-4B-GGUF')
  })

  it('keeps an unknown configured model unchanged', () => {
    expect(resolveReportedModel('missing-model', models)).toBe('missing-model')
  })
})
