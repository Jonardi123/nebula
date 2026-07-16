import type { MemoryFile } from '../types/memory'
import type { MemoryProposal } from '../types/nebula'
import { appendMemory, formatMemoryLesson } from './memory'
import { writeLocalJson } from './safeStorage'

const MEMORY_INBOX_KEY = 'nebula-memory-proposals'

function readInbox() {
  try {
    return JSON.parse(localStorage.getItem(MEMORY_INBOX_KEY) ?? '[]') as MemoryProposal[]
  } catch {
    return []
  }
}

function writeInbox(items: MemoryProposal[]) {
  try {
    writeLocalJson(MEMORY_INBOX_KEY, items.slice(0, 100))
    window.dispatchEvent(new CustomEvent('nebula-memory-inbox-changed'))
  } catch {
    // Memory proposals remain optional when browser storage is unavailable.
  }
}

export function getMemoryProposals() {
  return readInbox()
}

export function proposeMemory(file: MemoryFile, content: string, reason: string, sourceId?: string) {
  const proposal: MemoryProposal = {
    id: crypto.randomUUID(),
    file,
    content,
    reason,
    sourceId,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
  writeInbox([proposal, ...readInbox()])
  return proposal
}

export async function approveMemoryProposal(memoryFolder: string, id: string, content?: string) {
  const inbox = readInbox()
  const proposal = inbox.find((item) => item.id === id)
  if (!proposal) throw new Error('Memory proposal not found.')
  await appendMemory(memoryFolder, proposal.file, formatMemoryLesson(content ?? proposal.content))
  writeInbox(inbox.map((item) => (item.id === id ? { ...item, content: content ?? item.content, status: 'approved' } : item)))
}

export function rejectMemoryProposal(id: string) {
  writeInbox(readInbox().map((item) => (item.id === id ? { ...item, status: 'rejected' } : item)))
}
