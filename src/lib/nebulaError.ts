export type NebulaErrorCode = 'offline' | 'missing_model' | 'unloaded_model' | 'timeout' | 'cancelled' | 'malformed_response' | 'permission_denied' | 'tool_failure' | 'storage_failure' | 'unknown'
export interface NebulaError { code: NebulaErrorCode; message: string; recoverable: boolean; cause?: string }

export function normalizeNebulaError(error: unknown): NebulaError {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  if ((error instanceof DOMException && error.name === 'AbortError') || /cancelled|canceled|abort/.test(lower)) return { code: 'cancelled', message: 'The request was stopped.', recoverable: true, cause: message }
  if (/timed out|timeout/.test(lower)) return { code: 'timeout', message: 'The local model took too long to respond.', recoverable: true, cause: message }
  if (/failed to fetch|offline|could not reach|connection refused|local server/.test(lower)) return { code: 'offline', message: 'LM Studio is offline or its local server is unavailable.', recoverable: true, cause: message }
  if (/model is unloaded|unloaded/.test(lower)) return { code: 'unloaded_model', message: 'The selected model is installed but not loaded.', recoverable: true, cause: message }
  if (/no model|missing model|not found|no different installed fallback/.test(lower)) return { code: 'missing_model', message: 'Nebula could not find a usable model for this request.', recoverable: true, cause: message }
  if (/permission|denied|not allowed/.test(lower)) return { code: 'permission_denied', message: 'Nebula was not allowed to complete that action.', recoverable: true, cause: message }
  if (/json|malformed|parse/.test(lower)) return { code: 'malformed_response', message: 'The model returned a response Nebula could not safely parse.', recoverable: true, cause: message }
  if (/tool|command|file/.test(lower)) return { code: 'tool_failure', message: 'A local tool could not complete the requested action.', recoverable: true, cause: message }
  if (/sqlite|database|storage/.test(lower)) return { code: 'storage_failure', message: 'Nebula could not update local storage. Legacy recovery remains available.', recoverable: true, cause: message }
  return { code: 'unknown', message, recoverable: true }
}
