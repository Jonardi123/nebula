import { describe, expect, it } from 'vitest'
import { selectSpeechVoice } from './speechVoices'

function voice(name: string, lang = 'en-US', isDefault = false) {
  return { name, lang, default: isDefault, localService: true, voiceURI: name } as SpeechSynthesisVoice
}

describe('selectSpeechVoice', () => {
  it('honors an explicitly selected voice', () => {
    const voices = [voice('Microsoft Aria Natural'), voice('Microsoft Zira Desktop')]
    expect(selectSpeechVoice(voices, 'Microsoft Zira Desktop', 'en-US')?.name).toBe('Microsoft Zira Desktop')
  })

  it('prefers a natural matching-language voice', () => {
    const voices = [voice('Microsoft David Desktop'), voice('Microsoft Aria Natural'), voice('German Natural', 'de-DE')]
    expect(selectSpeechVoice(voices, '', 'en-US')?.name).toBe('Microsoft Aria Natural')
  })

  it('uses Zira ahead of the harsher legacy defaults', () => {
    const voices = [voice('Microsoft David Desktop', 'en-US', true), voice('Microsoft Zira Desktop')]
    expect(selectSpeechVoice(voices, '', 'en-US')?.name).toBe('Microsoft Zira Desktop')
  })
})
