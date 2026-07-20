import { describe, expect, it } from 'vitest'
import { DEFAULT_BRIDGE_URL, sanitizeMobilePreferences } from './mobileSettings'

describe('mobile preferences privacy', () => {
  it('does not ship a private bridge hostname', () => {
    expect(DEFAULT_BRIDGE_URL).toBe('')
    expect(sanitizeMobilePreferences({}).bridgeUrl).toBe('')
  })

  it('preserves an existing paired HTTPS bridge during upgrades', () => {
    expect(sanitizeMobilePreferences({ bridgeUrl: 'https://example.tailnet.ts.net/' }).bridgeUrl)
      .toBe('https://example.tailnet.ts.net')
  })

  it('rejects insecure or malformed bridge addresses', () => {
    expect(sanitizeMobilePreferences({ bridgeUrl: 'http://192.168.1.2' }).bridgeUrl).toBe('')
    expect(sanitizeMobilePreferences({ bridgeUrl: 'not a url' }).bridgeUrl).toBe('')
  })
})
