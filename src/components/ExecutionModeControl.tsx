import { Check, LockKeyhole, ShieldCheck, Unlock } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  fullAccessConfirmationPhrase,
  getRuntimeExecutionGrant,
  setRuntimeExecutionMode,
  subscribeRuntimeExecution,
} from '../lib/runtimeExecution'
import type { ExecutionMode } from '../types/settings'

interface Props {
  storedMode: ExecutionMode
  onStoredModeChange: (mode: 'approval' | 'safe') => void
  compact?: boolean
}

const OPTIONS: Array<{ id: ExecutionMode; label: string; description: string; icon: typeof ShieldCheck }> = [
  { id: 'approval', label: 'Ask for Approval', description: 'Confirm every command and side effect.', icon: LockKeyhole },
  { id: 'safe', label: 'Allow Safe Executions', description: 'Run safe project work and known apps automatically.', icon: ShieldCheck },
  { id: 'full', label: 'Full Access', description: 'Run legitimate actions without prompts for this session.', icon: Unlock },
]

export function ExecutionModeControl({ storedMode, onStoredModeChange, compact = false }: Props) {
  const [grant, setGrant] = useState(getRuntimeExecutionGrant)
  const [confirming, setConfirming] = useState(false)
  const [compactOpen, setCompactOpen] = useState(false)
  const [phrase, setPhrase] = useState('')
  const effectiveMode = grant.mode === 'full' ? 'full' : storedMode === 'approval' ? 'approval' : 'safe'

  useEffect(() => subscribeRuntimeExecution(() => setGrant(getRuntimeExecutionGrant())), [])
  useEffect(() => {
    if (!confirming && !compactOpen) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setConfirming(false); setCompactOpen(false) } }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [confirming, compactOpen])

  function choose(mode: ExecutionMode) {
    if (mode === 'full') {
      setCompactOpen(false)
      setPhrase('')
      setConfirming(true)
      return
    }
    setRuntimeExecutionMode(mode, 'desktop')
    onStoredModeChange(mode)
    setCompactOpen(false)
  }

  if (compact) {
    const option = OPTIONS.find((item) => item.id === effectiveMode) ?? OPTIONS[1]
    const Icon = option.icon
    return (
      <>
        <div className="execution-mode-compact">
          <button type="button" className={`execution-mode-pill execution-mode-${effectiveMode}`} onClick={() => setCompactOpen((current) => !current)} title={`${option.label}. ${option.description}`} aria-expanded={compactOpen}>
            <Icon size={13} />
            <span>{effectiveMode === 'approval' ? 'Approval' : effectiveMode === 'safe' ? 'Safe' : 'Full Access'}</span>
          </button>
          {compactOpen && <><button type="button" className="execution-mode-dismiss" aria-label="Close execution mode menu" onClick={() => setCompactOpen(false)} /><div className="execution-mode-menu">
            {OPTIONS.map((item) => { const OptionIcon = item.icon; return <button key={item.id} type="button" className={item.id === effectiveMode ? 'execution-mode-menu-active' : ''} onClick={() => choose(item.id)}><OptionIcon size={14} /><span><strong>{item.label}</strong><small>{item.description}</small></span></button> })}
          </div></>}
        </div>
        {confirming && <FullAccessDialog phrase={phrase} onPhraseChange={setPhrase} onClose={() => setConfirming(false)} onEnable={() => {
          setRuntimeExecutionMode('full', 'desktop', phrase)
          setConfirming(false)
        }} />}
      </>
    )
  }

  return (
    <>
      <div className="execution-mode-selector" role="radiogroup" aria-label="Execution mode">
        {OPTIONS.map((option) => {
          const Icon = option.icon
          return (
            <button key={option.id} type="button" role="radio" aria-checked={effectiveMode === option.id} className={effectiveMode === option.id ? 'execution-mode-option-active' : ''} onClick={() => choose(option.id)}>
              <Icon size={16} />
              <span><strong>{option.label}</strong><small>{option.description}</small></span>
              {effectiveMode === option.id && <Check size={14} />}
            </button>
          )
        })}
      </div>
      <p className="execution-mode-note">Full Access never elevates to administrator, expires when Nebula restarts, and cannot bypass permanent security blocks.</p>
      {confirming && <FullAccessDialog phrase={phrase} onPhraseChange={setPhrase} onClose={() => setConfirming(false)} onEnable={() => {
        setRuntimeExecutionMode('full', 'desktop', phrase)
        setConfirming(false)
      }} />}
    </>
  )
}

function FullAccessDialog({ phrase, onPhraseChange, onClose, onEnable }: { phrase: string; onPhraseChange: (value: string) => void; onClose: () => void; onEnable: () => void }) {
  const required = fullAccessConfirmationPhrase()
  return (
    <div className="execution-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <section className="execution-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="full-access-title">
        <div className="execution-confirm-icon"><Unlock size={20} /></div>
        <h2 id="full-access-title">Enable Full Access</h2>
        <p>Nebula may run commands, edit files, and open installed apps without asking until the app restarts. Administrator elevation and catastrophic actions stay blocked.</p>
        <label>
          <span>Type <strong>{required}</strong></span>
          <input autoFocus value={phrase} onChange={(event) => onPhraseChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && phrase === required) onEnable() }} spellCheck={false} />
        </label>
        <div className="execution-confirm-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="execution-confirm-primary" disabled={phrase !== required} onClick={onEnable}>Enable for this session</button>
        </div>
      </section>
    </div>
  )
}
