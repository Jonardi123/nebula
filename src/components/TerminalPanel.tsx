import { Check, ChevronDown, Clipboard, Copy, Play, Search, Square, Terminal, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getCommandJobs, stopRunningCommand, subscribeCommandJobs } from '../lib/commandRunner'
import { getExecutionReceipts, subscribeExecutionReceipts } from '../lib/executionReceipts'

interface Props {
  open: boolean
  onClose: () => void
  onRerun: (command: string) => void
}

export function TerminalPanel({ open, onClose, onRerun }: Props) {
  const [version, setVersion] = useState(0)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [copied, setCopied] = useState('')

  useEffect(() => {
    const refresh = () => setVersion((current) => current + 1)
    const unsubJobs = subscribeCommandJobs(refresh)
    const unsubReceipts = subscribeExecutionReceipts(refresh)
    return () => { unsubJobs(); unsubReceipts() }
  }, [])

  const jobs = useMemo(() => {
    void version
    const needle = query.trim().toLowerCase()
    return getCommandJobs().filter((job) => !needle || `${job.command} ${job.cwd} ${job.status} ${job.stdout} ${job.stderr}`.toLowerCase().includes(needle))
  }, [query, version])
  const receipts = useMemo(() => {
    void version
    const needle = query.trim().toLowerCase()
    return getExecutionReceipts().slice().reverse().filter((receipt) => !needle || `${receipt.tool} ${receipt.summary} ${receipt.status} ${receipt.executionMode}`.toLowerCase().includes(needle)).slice(0, 80)
  }, [query, version])
  const active = jobs.find((job) => job.status === 'running')

  async function copy(id: string, value: string) {
    await navigator.clipboard.writeText(value).catch(() => undefined)
    setCopied(id)
    window.setTimeout(() => setCopied((current) => current === id ? '' : current), 1200)
  }

  if (!open) return null
  return (
    <section className="black-matter-terminal" aria-label="Terminal dock">
      <header>
        <div className="terminal-dock-title"><Terminal size={15} /><strong>Terminal</strong><span>{active ? `PID ${active.pid ?? 'starting'}` : 'Ready'}</span></div>
        <label className="terminal-dock-search"><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search commands and receipts" /></label>
        {active && <button type="button" className="terminal-dock-stop" onClick={() => void stopRunningCommand()}><Square size={12} /> Stop</button>}
        <button type="button" className="terminal-dock-icon" onClick={onClose} aria-label="Close terminal dock"><X size={15} /></button>
      </header>
      <div className="terminal-dock-body terminal-font">
        {jobs.length === 0 && receipts.length === 0 ? <div className="terminal-dock-empty"><Terminal size={20} /><span>Commands and execution receipts will appear here.</span></div> : null}
        {jobs.map((job) => {
          const isExpanded = expanded === job.id
          const output = [job.stdout, job.stderr].filter(Boolean).join('\n')
          return <article key={job.id} className={`terminal-job terminal-job-${job.status}`}>
            <button type="button" className="terminal-job-summary" onClick={() => setExpanded(isExpanded ? null : job.id)} aria-expanded={isExpanded}>
              <span className="terminal-job-status" />
              <code>{job.command}</code>
              <span>{job.status.replace('_', ' ')}</span>
              <ChevronDown size={14} className={isExpanded ? 'terminal-job-chevron-open' : ''} />
            </button>
            {isExpanded && <div className="terminal-job-detail">
              <div className="terminal-job-meta"><span>{job.cwd}</span><span>{job.startedAt ? new Date(job.startedAt).toLocaleTimeString() : ''}</span><span>{job.code == null ? '' : `exit ${job.code}`}</span>{job.truncated && <span>output capped</span>}</div>
              <pre>{output || (job.status === 'running' ? 'Waiting for output...' : 'Command returned no output.')}</pre>
              <div className="terminal-job-actions">
                <button type="button" onClick={() => void copy(job.id, output || job.command)}>{copied === job.id ? <Check size={13} /> : <Copy size={13} />} {copied === job.id ? 'Copied' : 'Copy output'}</button>
                <button type="button" disabled={job.status === 'running'} onClick={() => onRerun(job.command)}><Play size={13} /> Rerun through Nebula</button>
              </div>
            </div>}
          </article>
        })}
        {receipts.length > 0 && <div className="terminal-receipt-heading"><Clipboard size={13} /> Execution receipts</div>}
        {receipts.map((receipt) => <div key={receipt.id} className="terminal-receipt">
          <span className={`terminal-receipt-status terminal-receipt-${receipt.status}`} />
          <strong>{receipt.tool}</strong><span>{receipt.summary}</span><small>{receipt.executionMode} · {new Date(receipt.startedAt).toLocaleTimeString()}</small>
        </div>)}
      </div>
    </section>
  )
}
