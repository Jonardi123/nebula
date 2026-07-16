const RECOVERY_SUFFIX = '-recovery'
const MAX_RECOVERY_CHARS = 1_000_000

function persistDurably(key: string, value: unknown) {
  void import('./storage').then(({ createDocumentRepository }) =>
    createDocumentRepository<unknown>('app-state').put(key, value),
  ).catch(() => undefined)
}

function removeDurably(key: string) {
  void import('./storage').then(({ createDocumentRepository }) =>
    createDocumentRepository<unknown>('app-state').delete(key),
  ).catch(() => undefined)
}

export function preserveCorruptLocalValue(key: string, raw: string) {
  try {
    localStorage.setItem(`${key}${RECOVERY_SUFFIX}`, JSON.stringify({
      capturedAt: new Date().toISOString(),
      raw: raw.slice(0, MAX_RECOVERY_CHARS),
      truncated: raw.length > MAX_RECOVERY_CHARS,
    }))
    return true
  } catch {
    return false
  }
}

export function readLocalJson<T>(key: string, fallback: T, normalize?: (value: unknown) => T): T {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed: unknown = JSON.parse(raw)
    return normalize ? normalize(parsed) : (parsed as T)
  } catch {
    if (raw) preserveCorruptLocalValue(key, raw)
    return fallback
  }
}

export function writeLocalJson<T>(key: string, value: T, eventName?: string) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    persistDurably(key, value)
    if (eventName) window.dispatchEvent(new CustomEvent(eventName))
    return true
  } catch {
    return false
  }
}

export function removeLocalValue(key: string, eventName?: string) {
  try {
    localStorage.removeItem(key)
    removeDurably(key)
    if (eventName) window.dispatchEvent(new CustomEvent(eventName))
    return true
  } catch {
    return false
  }
}
