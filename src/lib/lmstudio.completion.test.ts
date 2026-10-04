import { afterEach, expect, it, vi } from 'vitest'
import type { AppSettings } from '../types/settings'
import { streamChat } from './lmstudio'

afterEach(() => vi.unstubAllGlobals())

it.each([false, true])('stops at DONE and releases the stream (split chunks: %s)', async (split) => {
  const token = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'
  const done = 'data: [DONE]\n\n'
  const late = 'data: {"choices":[{"delta":{"content":"late"}}]}\n\n'
  const read = vi.fn()
  for (const chunk of split ? [token, done + late] : [token + done + late]) {
    read.mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(chunk) })
  }
  read.mockRejectedValue(new Error('Read past the completion marker'))
  const reader = { read, cancel: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn() }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => reader } }))
  const onToken = vi.fn()
  const settings = { modelProvider: 'lmstudio', endpoint: 'http://localhost:1234/v1/chat/completions', model: 'test', autoLoadModels: false } as AppSettings
  const result = await streamChat(settings, [], onToken)
  expect(result).toBe('Hello')
  expect(onToken).toHaveBeenCalledExactlyOnceWith('Hello')
  expect(reader.cancel).toHaveBeenCalledOnce()
  expect(reader.releaseLock).toHaveBeenCalledOnce()
})
