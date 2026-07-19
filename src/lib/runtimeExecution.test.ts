import { describe, expect, it } from 'vitest'
import { fullAccessConfirmationPhrase, getRuntimeExecutionGrant, setRuntimeExecutionMode } from './runtimeExecution'

describe('runtime execution grant', () => {
  it('requires an exact typed phrase for Full Access', () => {
    expect(() => setRuntimeExecutionMode('full', 'desktop', 'yes')).toThrow(/ENABLE FULL ACCESS/)
    expect(setRuntimeExecutionMode('full', 'desktop', fullAccessConfirmationPhrase()).mode).toBe('full')
    setRuntimeExecutionMode('safe', 'desktop')
  })

  it('starts and returns to safe mode', () => {
    setRuntimeExecutionMode('safe', 'startup')
    expect(getRuntimeExecutionGrant()).toMatchObject({ mode: 'safe', expiresOnRestart: true })
  })
})
