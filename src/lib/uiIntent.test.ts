import { describe, expect, it } from 'vitest'
import { detectLocalUiIntent } from './uiIntent'

describe('local UI intents', () => {
  it.each([
    'open settings',
    'can u open settings for me',
    'show me your settings',
    'take me to the settings page',
    'go to Nebula settings',
  ])('recognizes a direct Nebula Settings request: %s', (input) => {
    expect(detectLocalUiIntent(input)).toEqual({
      type: 'open_panel',
      panel: 'settings',
      confirmation: 'Opened Nebula Settings.',
    })
  })

  it.each([
    'open microphone settings',
    'how do the settings work?',
    'change my settings',
  ])('does not hijack other settings requests: %s', (input) => {
    expect(detectLocalUiIntent(input)).toBeNull()
  })

  it.each([
    'open Windows settings',
    'open system settings',
    'can u open Windows settings for me',
  ])('recognizes a direct Windows Settings request: %s', (input) => {
    expect(detectLocalUiIntent(input)).toEqual({
      type: 'open_windows_settings',
      confirmation: 'Opened Windows Settings.',
    })
  })
})
