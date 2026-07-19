import { describe, expect, it } from 'vitest'
import { normalizeNebulaError, userFacingNebulaError } from './nebulaError'

describe('normalizeNebulaError', () => {
  it.each([
    ['Failed to fetch', 'offline'],
    ['Model is unloaded', 'unloaded_model'],
    ['Request timed out', 'timeout'],
    ['Permission denied', 'permission_denied'],
    ['Malformed JSON response', 'malformed_response'],
  ] as const)('maps %s to %s', (message, code) => {
    expect(normalizeNebulaError(new Error(message)).code).toBe(code)
  })

  it('recognizes AbortError as cancellation', () => {
    expect(normalizeNebulaError(new DOMException('stopped', 'AbortError')).code).toBe('cancelled')
  })

  it('provides a direct recovery action for local connectivity', () => {
    expect(userFacingNebulaError(new Error('Failed to fetch'))).toMatchObject({
      title: 'Local AI is offline',
      action: 'open_lmstudio',
    })
  })
})
