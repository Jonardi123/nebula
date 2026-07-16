import { describe, expect, it } from 'vitest'
import { isKeyboardViewport } from './useMobileViewport'

describe('mobile viewport keyboard detection', () => {
  it('treats small safe-area changes as normal viewport movement', () => {
    expect(isKeyboardViewport(780, 720)).toBe(false)
  })

  it('detects an iPhone keyboard-sized viewport reduction', () => {
    expect(isKeyboardViewport(780, 430)).toBe(true)
  })
})
