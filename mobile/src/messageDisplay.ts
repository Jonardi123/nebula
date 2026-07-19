import type { MobileMessage } from './types'

export function shouldDisplayMobileMessage(message: MobileMessage) {
  if (message.role === 'system' || message.role === 'tool') return false
  if (message.role !== 'assistant') return true
  return Boolean(message.content.trim() || message.attachments?.length)
}
