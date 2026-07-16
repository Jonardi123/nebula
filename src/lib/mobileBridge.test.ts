import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import { createMobileRunSink, mobileIntentDirective, sanitizeMobileSource } from './mobileBridge'

describe('mobile run event sink', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    invokeMock.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('batches adjacent token fragments into one ordered bridge event', async () => {
    const sink = createMobileRunSink('run-1')
    sink.token('message-1', 'Neb')
    sink.token('message-1', 'ula')
    await vi.advanceTimersByTimeAsync(40)
    await sink.flush()

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('mobile_bridge_publish_event', {
      runId: 'run-1',
      event: { type: 'token', token: 'Nebula', messageId: 'message-1' },
    })
  })

  it('flushes pending tokens before terminal events', async () => {
    const sink = createMobileRunSink('run-2')
    sink.token('message-2', 'Done')
    await sink.event('completed', { conversationId: 'chat-1' })
    await sink.flush()

    expect(invokeMock.mock.calls.map((call) => (call[1] as { event: { type: string } }).event.type)).toEqual(['token', 'completed'])
  })

  it('maps mobile modes to internal directives without changing the visible request contract', () => {
    expect(mobileIntentDirective('web_search')).toContain('[WEB SEARCH]')
    expect(mobileIntentDirective('deep_research')).toContain('[DEEP RESEARCH]')
    expect(mobileIntentDirective('deep_thinking')).toContain('[DEEP THINKING]')
    expect(mobileIntentDirective('project_search')).toContain('[PROJECT SEARCH]')
    expect(mobileIntentDirective('guided_learning')).toContain('[GUIDED LEARNING]')
    expect(mobileIntentDirective('personal_intelligence')).toContain('[PERSONAL INTELLIGENCE]')
    expect(mobileIntentDirective('auto')).toBe('')
  })

  it('only exposes capped public HTTPS source cards to mobile clients', () => {
    expect(sanitizeMobileSource({
      id: 'source-1',
      title: 'A'.repeat(220),
      url: 'https://example.com/research',
      snippet: 'B'.repeat(700),
      dateChecked: '2026-07-16T12:00:00.000Z',
    })).toMatchObject({
      id: 'source-1',
      url: 'https://example.com/research',
      title: 'A'.repeat(180),
      snippet: 'B'.repeat(500),
    })

    expect(sanitizeMobileSource({
      id: 'private',
      title: 'Private',
      url: 'https://192.168.1.2/secrets',
      snippet: 'Hidden',
      dateChecked: 'today',
    })).toBeNull()
    expect(sanitizeMobileSource({
      id: 'download',
      title: 'Download',
      url: 'https://example.com/setup.exe',
      snippet: 'Blocked',
      dateChecked: 'today',
    })).toBeNull()
    expect(sanitizeMobileSource({
      id: 'plaintext',
      title: 'Plain HTTP',
      url: 'http://example.com',
      snippet: 'Blocked',
      dateChecked: 'today',
    })).toBeNull()
  })
})
