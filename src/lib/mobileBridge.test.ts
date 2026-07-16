import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import { createMobileRunSink } from './mobileBridge'

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
})
