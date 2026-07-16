import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './settings'
import { selectModelForRequest } from './modelRouter'

describe('model routing', () => {
  it('uses the daily model for normal conversation', () => {
    const result = selectModelForRequest(DEFAULT_SETTINGS, 'How has your day been?')
    expect(result.mode).toBe('fast')
    expect(result.model).toBe(DEFAULT_SETTINGS.modelAssignments.daily)
  })

  it('routes file and coding work to Qwen', () => {
    const result = selectModelForRequest(DEFAULT_SETTINGS, 'Debug src/App.tsx and run the build')
    expect(result.mode).toBe('code')
    expect(result.model).toBe(DEFAULT_SETTINGS.modelAssignments.code)
  })

  it('routes explicit no-edit reviews to the review model', () => {
    const result = selectModelForRequest(DEFAULT_SETTINGS, 'Review this architecture and find bugs, but do not edit')
    expect(result.mode).toBe('review')
    expect(result.model).toBe(DEFAULT_SETTINGS.modelAssignments.review)
  })
})
