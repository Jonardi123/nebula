import { describe, expect, it } from 'vitest'
import { isKeyboardViewport, webViewportFrame } from './useMobileViewport'

describe('mobile viewport keyboard detection', () => {
  it('treats small safe-area changes as normal viewport movement', () => {
    expect(isKeyboardViewport(780, 720)).toBe(false)
  })

  it('detects an iPhone keyboard-sized viewport reduction', () => {
    expect(isKeyboardViewport(780, 430)).toBe(true)
  })

  it('fills the standalone PWA when the keyboard is closed', () => {
    expect(webViewportFrame(true, false, 720, 0)).toEqual({ height: '100dvh', top: '0px' })
  })

  it('follows the visible viewport while the keyboard is open', () => {
    expect(webViewportFrame(true, true, 430, 12)).toEqual({ height: '430px', top: '12px' })
  })
})
