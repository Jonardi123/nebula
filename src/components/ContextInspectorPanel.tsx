import { Braces, Eye, Pin, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { clearContextInspectorSnapshot, getContextInspectorSnapshot } from '../lib/contextInspector'
import { deleteContextPin, getContextPins, saveContextPin, toggleContextPin } from '../lib/contextPins'
import type { ContextInspectorSnapshot, ContextPin } from '../types/nebula'

export function ContextInspectorPanel() {
  const [snapshot, setSnapshot] = useState<ContextInspectorSnapshot | null>(() => getContextInspectorSnapshot())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [pins, setPins] = useState<ContextPin[]>(getContextPins)

  function refresh() {
    setSnapshot(getContextInspectorSnapshot())
  }

  useEffect(() => {
    window.addEventListener('nebula-context-inspector-changed', refresh)
    const refreshPins = () => setPins(getContextPins())
    window.addEventListener('nebula-context-pins-changed', refreshPins)
    return () => {
      window.removeEventListener('nebula-context-inspector-changed', refresh)
      window.removeEventListener('nebula-context-pins-changed', refreshPins)
    }
  }, [])

  const percent = snapshot ? Math.min(100, Math.round((snapshot.totalChars / Math.max(snapshot.budgetChars, 1)) * 100)) : 0

  return (
    <div className="space-y-3 p-3 text-xs">
      <section className="rounded-md border border-cyan-300/20 bg-cyan-300/[0.07] p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-cyan-50">
          <Eye size={15} />
          Context Inspector
        </div>
        <p className="mt-1 leading-5 text-slate-400">Shows the latest local context bundle before it reached a model. It stays on this PC and can include memory or project text.</p>
        <div className="mt-3 flex gap-2">
          <button className="nebula-button-primary flex flex-1 items-center justify-center gap-2 px-3 py-2" type="button" onClick={refresh}>
            <RefreshCw size={13} />
            Refresh
          </button>
          <button className="nebula-toggle flex items-center justify-center gap-2 px-3 py-2" type="button" disabled={!snapshot} onClick={() => { clearContextInspectorSnapshot(); setSnapshot(null) }}>
            <Trash2 size={13} />
            Clear
          </button>
        </div>
      </section>

      {!snapshot && <div className="nebula-empty-state">Send a message to inspect the exact memory, workspace, file, and conversation context Nebula assembled.</div>}

      <section className="context-pins-section">
        <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 font-semibold text-slate-200"><Pin size={13} />Context pins</div><span>{pins.filter((pin) => pin.enabled).length} active</span></div>
        {pins.length === 0 ? <p>No pinned context. Pin a section below to keep it available across model switches.</p> : (
          <div className="mt-2 space-y-1.5">
            {pins.map((pin) => (
              <div key={pin.id} className="context-pin-row">
                <button type="button" onClick={() => toggleContextPin(pin.id)} aria-label={`${pin.enabled ? 'Disable' : 'Enable'} ${pin.label}`} className={pin.enabled ? 'active' : ''}><span /></button>
                <span className="min-w-0 flex-1 truncate" title={pin.path || pin.label}>{pin.label}</span>
                <button type="button" onClick={() => deleteContextPin(pin.id)} aria-label={`Delete ${pin.label}`}><Trash2 size={11} /></button>
              </div>
            ))}
          </div>
        )}
      </section>

      {snapshot && (
        <>
          <section className="grid grid-cols-3 gap-2">
            <Metric label="Sections" value={String(snapshot.sections.length)} />
            <Metric label="Budget" value={`${percent}%`} />
            <Metric label="Updated" value={new Date(snapshot.createdAt).toLocaleTimeString()} />
          </section>
          <section className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 text-slate-200"><Braces size={14} /><span className="font-semibold">Included sections</span></div>
            <div className="mt-3 space-y-2">
              {snapshot.sections.map((section) => {
                const isOpen = expanded === section.id
                return (
                  <article key={section.id} className="rounded-md border border-white/10 bg-black/20">
                    <button type="button" className="flex w-full items-center justify-between gap-2 p-2 text-left" onClick={() => setExpanded(isOpen ? null : section.id)}>
                      <span className="min-w-0 flex-1 truncate font-semibold text-slate-200">{section.title}</span>
                      <span className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[9px] uppercase text-slate-500">{section.source}</span>
                      <span className="shrink-0 text-[10px] text-slate-500">{section.chars.toLocaleString()} ch</span>
                    </button>
                    {isOpen && <div className="border-t border-white/10"><pre className="max-h-72 overflow-auto whitespace-pre-wrap px-2 py-2 font-mono text-[10px] leading-4 text-slate-400">{section.content}</pre><button type="button" className="context-pin-action" onClick={() => saveContextPin({ label: section.title, source: section.source === 'file' ? 'file' : section.source === 'memory' ? 'memory' : 'note', content: section.content, enabled: true })}><Pin size={11} />Pin this section</button></div>}
                  </article>
                )
              })}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-white/10 bg-black/20 p-2"><div className="text-[10px] uppercase tracking-[0.08em] text-slate-500">{label}</div><div className="mt-1 break-words text-slate-200">{value}</div></div>
}
