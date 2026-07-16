import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './settings'
import { deriveServiceState } from './serviceState'

describe('service state', () => {
  it('distinguishes offline, degraded, and ready states', () => {
    expect(deriveServiceState(DEFAULT_SETTINGS, false, 'idle').phase).toBe('offline')
    expect(deriveServiceState(DEFAULT_SETTINGS, true, 'idle', 'Model is unloaded.').phase).toBe('degraded')
    expect(deriveServiceState(DEFAULT_SETTINGS, true, 'idle').phase).toBe('online')
  })

  it('reports model preparation while loading', () => {
    const state = deriveServiceState(DEFAULT_SETTINGS, true, 'loading_model')
    expect(state.phase).toBe('checking')
    expect(state.label).toContain('preparing')
  })
})
