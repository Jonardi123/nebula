import { describe, expect, it } from 'vitest'
import type { MobileMessage } from './types'
import { shouldDisplayMobileMessage } from './messageDisplay'

function assistant(content: string): MobileMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content,
    createdAt: new Date(0).toISOString(),
  }
}

describe('mobile message display', () => {
  it('hides empty streaming placeholders instead of rendering ellipses', () => {
    expect(shouldDisplayMobileMessage(assistant(''))).toBe(false)
    expect(shouldDisplayMobileMessage(assistant('   '))).toBe(false)
  })

  it('shows the assistant as soon as real content arrives', () => {
    expect(shouldDisplayMobileMessage(assistant('Hello'))).toBe(true)
  })
})
