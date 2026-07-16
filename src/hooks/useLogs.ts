import { useState } from 'react';
import { createLog, type LogEvent } from '../lib/logger';

const MAX_LOG_EVENTS = 600;

export function useLogs() {
  const [logs, setLogs] = useState<LogEvent[]>([createLog('status', 'Nebula shell initialized.')]);

  const addLog = (typeOrLog: LogEvent['type'] | LogEvent, message?: string, details?: unknown) => {
    const log = typeof typeOrLog === 'string'
      ? createLog(typeOrLog, message ?? '', details)
      : typeOrLog;
    setLogs((current) => [...current, log].slice(-MAX_LOG_EVENTS));
  };

  return { logs, setLogs, addLog };
}
