export type LocalUiIntent =
  | {
      type: 'open_panel'
      panel: 'settings'
      confirmation: string
    }
  | {
      type: 'open_windows_settings'
      confirmation: string
    }

export function detectLocalUiIntent(input: string): LocalUiIntent | null {
  const text = input
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')

  const windowsSettings = /^(?:(?:can|could|would|will)\s+(?:you|u)\s+)?(?:please\s+)?(?:open|show)(?:\s+(?:me|the))*\s+(?:windows|system)\s+settings(?:\s+for me)?$/.test(text)
  if (windowsSettings) {
    return {
      type: 'open_windows_settings',
      confirmation: 'Opened Windows Settings.',
    }
  }

  if (/\b(microphone|speech|privacy|display|bluetooth|wi-?fi)\b/.test(text)) return null

  const directOpen = /^(?:(?:can|could|would|will)\s+(?:you|u)\s+)?(?:please\s+)?(?:open|show)(?:\s+(?:me|your|the|nebula|app))*\s+settings(?:\s+(?:for me|page|panel))?$/.test(text)
  const navigateTo = /^(?:please\s+)?(?:take\s+me|go)\s+to\s+(?:the\s+)?(?:nebula\s+)?settings(?:\s+(?:page|panel))?$/.test(text)

  if (!directOpen && !navigateTo) return null
  return {
    type: 'open_panel',
    panel: 'settings',
    confirmation: 'Opened Nebula Settings.',
  }
}
