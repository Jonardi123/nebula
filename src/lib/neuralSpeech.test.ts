import { describe, expect, it } from 'vitest'
import { resolveNeuralVoice } from './neuralSpeech'

describe('resolveNeuralVoice', () => {
  it('keeps a supported voice', () => {
    expect(resolveNeuralVoice('bf_emma')).toBe('bf_emma')
  })

  it('falls back to the warm default', () => {
    expect(resolveNeuralVoice('missing')).toBe('af_heart')
  })
})
