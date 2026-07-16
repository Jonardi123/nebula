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

import { startRun } from './api'

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
})
