import type { ExecutionReceipt } from '../types/execution'

const RECEIPTS_KEY = 'nebula-execution-receipts-v1'
const MAX_RECEIPTS = 300
const listeners = new Set<() => void>()

function readReceipts(): ExecutionReceipt[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECEIPTS_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is ExecutionReceipt => Boolean(item?.id && item?.tool)) : []
  } catch {
    return []
  }
}

export function getExecutionReceipts() {
  return readReceipts()
}

export function recordExecutionReceipt(receipt: ExecutionReceipt) {
  const next = [...readReceipts().filter((item) => item.id !== receipt.id), receipt]
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    .slice(-MAX_RECEIPTS)
  try { localStorage.setItem(RECEIPTS_KEY, JSON.stringify(next)) } catch { /* diagnostics stay optional */ }
  listeners.forEach((listener) => listener())
  return receipt
}

export function updateExecutionReceipt(id: string, change: Partial<ExecutionReceipt>) {
  const current = readReceipts().find((item) => item.id === id)
  if (!current) return undefined
  return recordExecutionReceipt({ ...current, ...change, id })
}

export function subscribeExecutionReceipts(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
