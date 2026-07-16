import type { ModelManagerEvent } from './modelManager'
import type { NebulaContextBundle, NebulaDiagnosticEvent, NebulaRouteDecision } from '../types/nebula'
import { writeLocalJson } from './safeStorage'

const DIAGNOSTICS_KEY = 'nebula-orchestrator-diagnostics'

function readEvents() {
  try {
    return JSON.parse(localStorage.getItem(DIAGNOSTICS_KEY) ?? '[]') as NebulaDiagnosticEvent[]
  } catch {
    return []
  }
}

function writeEvents(events: NebulaDiagnosticEvent[]) {
  try {
    writeLocalJson(DIAGNOSTICS_KEY, events.slice(0, 160))
    window.dispatchEvent(new CustomEvent('nebula-diagnostics-changed'))
  } catch {
    // Diagnostics are best-effort and should never crash Nebula.
  }
}

export function getOrchestratorDiagnostics() {
  return readEvents()
}

export function recordDiagnosticEvent(update: Omit<NebulaDiagnosticEvent, 'id' | 'createdAt'>) {
  const event: NebulaDiagnosticEvent = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...update,
  }
  writeEvents([event, ...readEvents()])
  return event
}

export function recordRouteDecision(decision: NebulaRouteDecision) {
  return recordDiagnosticEvent({
    type: 'route',
    label: `Route: ${decision.mode}`,
    detail: decision.reason,
    model: decision.requestedModel,
    role: decision.role,
    data: decision,
  })
}

export function recordContextBundle(bundle: NebulaContextBundle) {
  return recordDiagnosticEvent({
    type: 'context',
    label: `Context bundle: ${bundle.sections.length} sections`,
    detail: `${bundle.totalChars}/${bundle.budgetChars} chars`,
    data: bundle.summary,
  })
}

export function recordModelLifecycle(event: ModelManagerEvent) {
  return recordDiagnosticEvent({
    type: 'model_lifecycle',
    label: event.state,
    detail: event.message,
    model: event.model,
    role: event.role,
    data: event,
  })
}

export function modelSwitchCount(events = readEvents()) {
  let previous = ''
  let count = 0

  for (const event of [...events].reverse()) {
    if (event.type !== 'route' || !event.model) continue
    if (previous && previous !== event.model) count += 1
    previous = event.model
  }

  return count
}
