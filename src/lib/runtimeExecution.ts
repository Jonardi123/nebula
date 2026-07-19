import type { RuntimeExecutionGrant } from '../types/execution'
import type { ExecutionMode } from '../types/settings'

const FULL_ACCESS_PHRASE = 'ENABLE FULL ACCESS'
const listeners = new Set<(grant: RuntimeExecutionGrant) => void>()

let grant: RuntimeExecutionGrant = {
  mode: 'safe',
  grantedAt: new Date().toISOString(),
  source: 'startup',
  expiresOnRestart: true,
}

export function getRuntimeExecutionGrant() {
  return grant
}

export function setRuntimeExecutionMode(
  mode: ExecutionMode,
  source: RuntimeExecutionGrant['source'] = 'desktop',
  confirmation = '',
) {
  if (mode === 'full' && confirmation.trim() !== FULL_ACCESS_PHRASE) {
    throw new Error(`Type ${FULL_ACCESS_PHRASE} to enable Full Access for this session.`)
  }
  grant = {
    mode,
    grantedAt: new Date().toISOString(),
    source,
    expiresOnRestart: true,
  }
  listeners.forEach((listener) => listener(grant))
  return grant
}

export function subscribeRuntimeExecution(listener: (grant: RuntimeExecutionGrant) => void) {
  listeners.add(listener)
  listener(grant)
  return () => {
    listeners.delete(listener)
  }
}

export function fullAccessConfirmationPhrase() {
  return FULL_ACCESS_PHRASE
}
