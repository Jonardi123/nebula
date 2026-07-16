import type { ContextInspectorSnapshot, NebulaContextBundle } from '../types/nebula'

const CONTEXT_INSPECTOR_KEY = 'nebula-last-context-inspector'
const MAX_SECTION_CHARS = 6000

function clip(value: string) {
  return value.length > MAX_SECTION_CHARS ? `${value.slice(0, MAX_SECTION_CHARS - 16)}\n...[trimmed]` : value
}

export function saveContextInspectorSnapshot(bundle: NebulaContextBundle, details: { model?: string; route?: string } = {}) {
  const snapshot: ContextInspectorSnapshot = {
    id: bundle.id,
    model: details.model,
    route: details.route,
    totalChars: bundle.totalChars,
    budgetChars: bundle.budgetChars,
    sections: bundle.sections.map((section) => ({
      id: section.id,
      title: section.title,
      source: section.source,
      priority: section.priority,
      chars: section.content.length,
      content: clip(section.content),
    })),
    createdAt: bundle.createdAt,
  }
  try {
    localStorage.setItem(CONTEXT_INSPECTOR_KEY, JSON.stringify(snapshot))
    window.dispatchEvent(new CustomEvent('nebula-context-inspector-changed'))
  } catch {
    // Context visibility is diagnostic only; never make a chat fail because storage is full.
  }
  return snapshot
}

export function getContextInspectorSnapshot(): ContextInspectorSnapshot | null {
  try {
    const raw = localStorage.getItem(CONTEXT_INSPECTOR_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ContextInspectorSnapshot>
    if (!parsed.id || !Array.isArray(parsed.sections) || typeof parsed.totalChars !== 'number' || typeof parsed.budgetChars !== 'number') return null
    return {
      id: String(parsed.id),
      model: typeof parsed.model === 'string' ? parsed.model : undefined,
      route: typeof parsed.route === 'string' ? parsed.route : undefined,
      totalChars: parsed.totalChars,
      budgetChars: parsed.budgetChars,
      sections: parsed.sections.filter((section): section is ContextInspectorSnapshot['sections'][number] => Boolean(section && typeof section.id === 'string' && typeof section.content === 'string')),
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export function clearContextInspectorSnapshot() {
  try {
    localStorage.removeItem(CONTEXT_INSPECTOR_KEY)
    window.dispatchEvent(new CustomEvent('nebula-context-inspector-changed'))
  } catch {
    // No-op when storage is unavailable.
  }
}
