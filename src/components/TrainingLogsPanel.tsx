import { Check, Download, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { clearTrainingLogs, downloadTrainingLogs, getTrainingLogs, setTrainingLogAccepted } from '../lib/trainingLogs'
import type { TrainingLogEntry } from '../types/nebula'

export function TrainingLogsPanel() {
  const [logs, setLogs] = useState<TrainingLogEntry[]>(() => getTrainingLogs())
  const acceptedCount = useMemo(() => logs.filter((entry) => entry.accepted).length, [logs])

  function refresh() {
    setLogs(getTrainingLogs())
  }

  function toggle(id: string, accepted: boolean) {
    setTrainingLogAccepted(id, accepted)
    refresh()
  }

  useEffect(() => {
    window.addEventListener('nebula-training-logs-changed', refresh)
    return () => window.removeEventListener('nebula-training-logs-changed', refresh)
  }, [])

  return (
    <div className="space-y-3 p-3 text-xs">
      <section className="training-hero">
        <div>
          <div className="text-sm font-semibold text-cyan-50">Training Logs</div>
          <p>Local traces for Gemma tuning. Export inspects every trace, while the training quality gate excludes unsafe, broken, specialist, and identity-leaking examples.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className="nebula-button-primary flex items-center justify-center gap-2 px-3 py-2" type="button" onClick={downloadTrainingLogs} disabled={!logs.length}>
            <Download size={13} />
            Export audit JSONL
          </button>
          <button className="nebula-toggle flex items-center justify-center gap-2 px-3 py-2" type="button" onClick={refresh}>
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-2">
        <Metric label="Total" value={String(logs.length)} />
        <Metric label="Accepted" value={String(acceptedCount)} />
        <Metric label="Rejected" value={String(logs.length - acceptedCount)} />
      </div>

      <button
        className="nebula-toggle flex w-full items-center justify-center gap-2 px-3 py-2 text-red-200"
        type="button"
        disabled={!logs.length}
        onClick={() => {
          if (!window.confirm('Clear local Nebula training logs? This does not touch memory, chats, or tasks.')) return
          clearTrainingLogs()
          refresh()
        }}
      >
        <Trash2 size={13} />
        Clear training logs
      </button>

      <div className="space-y-2">
        {logs.map((entry) => (
          <article key={entry.id} className={`training-card ${entry.accepted ? 'training-card-accepted' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-slate-100">{entry.prompt.slice(0, 90) || 'Untitled example'}</div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                  {entry.source} / {entry.model || 'unknown model'} / {new Date(entry.createdAt).toLocaleString()}
                </div>
              </div>
              <button className="training-accept" type="button" onClick={() => toggle(entry.id, !entry.accepted)} title={entry.accepted ? 'Mark rejected' : 'Mark accepted'}>
                <Check size={13} />
              </button>
            </div>
            <p>{entry.response.slice(0, 220) || 'No assistant text captured.'}</p>
            {(entry.toolCalls.length > 0 || entry.errors.length > 0) && (
              <div className="training-meta">
                {entry.toolCalls.length > 0 && <span>{entry.toolCalls.length} tool call{entry.toolCalls.length === 1 ? '' : 's'}</span>}
                {entry.errors.length > 0 && <span>{entry.errors.length} error{entry.errors.length === 1 ? '' : 's'}</span>}
              </div>
            )}
          </article>
        ))}
        {logs.length === 0 && <div className="nebula-empty-state">No training logs yet. Successful Nebula chats will appear here.</div>}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="doctor-metric doctor-metric-neutral">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
