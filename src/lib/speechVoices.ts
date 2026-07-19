function normalizedLanguage(language: string) {
  return language.trim().toLowerCase().replace('_', '-')
}
export function selectSpeechVoice(
  voices: readonly SpeechSynthesisVoice[],
  preferred: string,
  language: string,
) {
  if (voices.length === 0) return null

  const requested = preferred.trim().toLowerCase()
  if (requested) {
    const exact = voices.find((voice) => voice.name.toLowerCase() === requested || voice.voiceURI.toLowerCase() === requested)
    if (exact) return exact
  }

  const locale = normalizedLanguage(language)
  const languageFamily = locale.split('-')[0]
  const naturalNames = ['natural', 'neural', 'aria', 'jenny', 'ava', 'sonia', 'libby', 'michelle', 'emma']
  const friendlyFallbacks = ['zira', 'samantha', 'victoria', 'karen', 'moira']

  return [...voices].sort((left, right) => {
    const score = (voice: SpeechSynthesisVoice) => {
      const name = voice.name.toLowerCase()
      const voiceLocale = normalizedLanguage(voice.lang)
      let value = 0
      if (voiceLocale === locale) value += 120
      else if (voiceLocale.split('-')[0] === languageFamily) value += 70
      if (naturalNames.some((hint) => name.includes(hint))) value += 90
      if (friendlyFallbacks.some((hint) => name.includes(hint))) value += 45
      if (name.includes('desktop')) value -= 12
      if (name.includes('david') || name.includes('mark')) value -= 18
      if (voice.default) value += 4
      return value
    }
    return score(right) - score(left) || left.name.localeCompare(right.name)
  })[0] ?? null
}
