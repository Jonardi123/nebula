import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))

vi.mock('./platform', () => ({
  apiUrl: (path: string) => path,
  readSecureValue: vi.fn(async () => 'paired-token'),
  writeSecureValue: vi.fn(),
  deleteSecureValue: vi.fn(),
  shareValue: vi.fn(),
}))
vi.mock('./idb', () => ({ readPrivateValue: vi.fn(), writePrivateValue: vi.fn() }))

import { getStatus, MobileApiError, startRun, streamRun } from './api'

describe('mobile run API', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ runId: 'run-1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('sends explicit assistant intent and project context independently', async () => {
    await startRun('chat-1', 'Find the root cause', [], 'new', undefined, 'deep_thinking', true)
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(request.body))).toMatchObject({
      conversationId: 'chat-1',
      content: 'Find the root cause',
      intentMode: 'deep_thinking',
      includeProjectContext: true,
    })
  })

  it('keeps old callers backward compatible with auto mode', async () => {
    await startRun('chat-1', 'Hello', [])
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(request.body))).toMatchObject({ intentMode: 'auto', includeProjectContext: false })
  })

  it('reports an interrupted response stream instead of pretending it completed', async () => {
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"type":"token","runId":"run-1","token":"Hi"}\n\n') })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    }
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, body: { getReader: () => reader } } as unknown as Response)
    const events: string[] = []
    await expect(streamRun('run-1', (event) => events.push(event.type), new AbortController().signal))
      .rejects.toMatchObject({ code: 'stream_interrupted' })
    expect(events).toEqual(['token'])
  })

  it('normalizes bridge connection failures', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(getStatus()).rejects.toEqual(expect.objectContaining<Partial<MobileApiError>>({ code: 'bridge_offline', status: 0 }))
  })
})
