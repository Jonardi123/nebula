import { Check, RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { approveMemoryProposal, getMemoryProposals, rejectMemoryProposal } from '../lib/memoryInbox'
import type { MemoryProposal } from '../types/nebula'

export function MemoryInboxPanel({ memoryFolder }: { memoryFolder: string }) {
  const [items, setItems] = useState<MemoryProposal[]>([])
  const [edits, setEdits] = useState<Record<string, string>>({})

  function refresh() {
    const next = getMemoryProposals()
    setItems(next)
    setEdits(Object.fromEntries(next.map((item) => [item.id, item.content])))
  }

  async function approve(id: string) {
    await approveMemoryProposal(memoryFolder, id, edits[id])
    refresh()
  }

  function reject(id: string) {
    rejectMemoryProposal(id)
    refresh()
  }

  useEffect(refresh, [])

  return (
    <div className="space-y-3 p-3 text-xs">
      <button className="nebula-button-primary flex w-full items-center justify-center gap-2 px-3 py-2" type="button" onClick={refresh}>
        <RefreshCw size={13} />
        Refresh Inbox
      </button>
      {items.filter((item) => item.status === 'pending').length === 0 && (
        <div className="nebula-note p-3 text-slate-300">No pending memory proposals.</div>
      )}
      {items.filter((item) => item.status === 'pending').map((item) => (
        <section key={item.id} className="skill-card rounded-md border border-slate-800 bg-slate-950 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="terminal-font rounded-md bg-slate-800 px-2 py-1 text-[11px] text-cyan-100">{item.file}</span>
            <span className="text-[11px] text-slate-500">{new Date(item.createdAt).toLocaleString()}</span>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-slate-400">{item.reason}</p>
          <textarea
            className="nebula-input mt-3 min-h-32 w-full resize-none p-3 outline-none"
            value={edits[item.id] ?? item.content}
            onChange={(event) => setEdits((current) => ({ ...current, [item.id]: event.target.value }))}
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button className="nebula-button-primary flex items-center justify-center gap-2 px-3 py-2" type="button" onClick={() => approve(item.id)}>
              <Check size={13} />
              Approve
            </button>
            <button className="nebula-toggle flex items-center justify-center gap-2 px-3 py-2" type="button" onClick={() => reject(item.id)}>
              <X size={13} />
              Reject
            </button>
          </div>
        </section>
      ))}
    </div>
  )
}
