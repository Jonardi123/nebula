import { Check, RotateCcw, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  applyPatchProposal,
  applyPatchProposals,
  clearResolvedPatches,
  getPatchProposals,
  rejectPatchProposal,
  rejectPatchProposals,
} from '../lib/patchQueue'
import type { LogEvent } from '../types/agent'
import type { PatchProposal } from '../types/nebula'
import { DiffViewer } from './DiffViewer'

interface Props {
  onLog: (type: LogEvent['type'], message: string, details?: unknown) => void
}

export function PatchQueuePanel({ onLog }: Props) {
  const [patches, setPatches] = useState<PatchProposal[]>([])
  const [expandedId, setExpandedId] = useState('')
  const [busyId, setBusyId] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const refresh = useCallback(() => {
    const next = getPatchProposals()
    setPatches(next)
    if (!expandedId && next[0]) setExpandedId(next[0].id)
  }, [expandedId])

  async function apply(id: string) {
    setBusyId(id)
    try {
      const applied = await applyPatchProposal(id)
      refresh()
      onLog('tool_result', `Patch applied: ${applied?.path ?? id}`, applied)
    } catch (error) {
      refresh()
      onLog('error', `Patch apply failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusyId('')
    }
  }

  function reject(id: string) {
    const rejected = rejectPatchProposal(id)
    refresh()
    onLog('status', `Patch rejected: ${rejected?.path ?? id}`, rejected)
  }

  function clearResolved() {
    clearResolvedPatches()
    refresh()
    onLog('status', 'Resolved patches cleared.')
  }

  async function applySelected() {
    if (!selectedIds.length) return
    setBusyId('batch')
    try {
      const applied = await applyPatchProposals(selectedIds)
      setSelectedIds([])
      refresh()
      onLog('tool_result', `${applied.length} selected patch${applied.length === 1 ? '' : 'es'} applied.`, applied)
    } catch (error) {
      refresh()
      onLog('error', `Selected patches stopped safely: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusyId('')
    }
  }

  function rejectSelected() {
    const rejected = rejectPatchProposals(selectedIds)
    setSelectedIds([])
    refresh()
    onLog('status', `${rejected.length} selected patch${rejected.length === 1 ? '' : 'es'} rejected.`, rejected)
  }

  useEffect(() => {
    refresh()
    const handler = () => refresh()
    window.addEventListener('nebula-patch-queue-changed', handler)
    return () => window.removeEventListener('nebula-patch-queue-changed', handler)
  }, [refresh])

  const pending = patches.filter((patch) => patch.status === 'pending' || patch.status === 'error')
  const resolved = patches.filter((patch) => patch.status === 'applied' || patch.status === 'rejected')

  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-100">Patch Preview Queue</div>
          <div className="mt-1 text-[11px] text-slate-500">{pending.length} pending, {resolved.length} resolved</div>
        </div>
        <button className="nebula-toggle flex items-center gap-1 px-2 py-1" type="button" onClick={clearResolved}>
          <Trash2 size={12} />
          Clear
        </button>
      </div>
      <div className="rounded-md border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-[11px] leading-5 text-amber-100">
        Diffs are stored locally for review. Secret-like paths and very large patches are blocked from this queue.
      </div>

      {pending.length > 0 && (
        <div className="patch-workspace-toolbar">
          <label><input type="checkbox" checked={selectedIds.length === pending.length} onChange={(event) => setSelectedIds(event.target.checked ? pending.map((patch) => patch.id) : [])} />Select pending</label>
          <span>{selectedIds.length} selected</span>
          <button type="button" onClick={rejectSelected} disabled={!selectedIds.length || Boolean(busyId)}>Reject</button>
          <button type="button" onClick={() => void applySelected()} disabled={!selectedIds.length || Boolean(busyId)}>Apply selected</button>
        </div>
      )}

      {patches.length === 0 && (
        <div className="premium-empty-state">
          <RotateCcw size={18} />
          <div>
            <div className="text-sm font-semibold text-slate-100">No patches queued</div>
            <div className="mt-1 text-xs text-slate-400">File-write tools will appear here as reviewable diffs before disk changes.</div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {patches.map((patch) => {
          const expanded = expandedId === patch.id
          const tone =
            patch.status === 'applied'
              ? 'border-emerald-300/25 bg-emerald-300/10'
              : patch.status === 'rejected'
                ? 'border-slate-700 bg-slate-950/80'
                : patch.status === 'error'
                  ? 'border-red-300/30 bg-red-300/10'
                  : 'border-cyan-300/25 bg-cyan-300/10'

          return (
            <section key={patch.id} className={`rounded-md border p-3 ${tone}`}>
              {(patch.status === 'pending' || patch.status === 'error') && <label className="patch-select-row"><input type="checkbox" checked={selectedIds.includes(patch.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, patch.id])] : current.filter((id) => id !== patch.id))} />Include in batch</label>}
              <button className="w-full text-left" type="button" onClick={() => setExpandedId(expanded ? '' : patch.id)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-100">{patch.path}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Pill>{patch.operation}</Pill>
                      <Pill>{patch.status}</Pill>
                      <Pill>{patch.riskLevel}</Pill>
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] text-slate-500">{new Date(patch.createdAt).toLocaleTimeString()}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-slate-400">{patch.reason}</p>
                {patch.error && <p className="mt-2 text-[11px] text-red-200">{patch.error}</p>}
              </button>

              {expanded && (
                <div className="mt-3 space-y-3">
                  <DiffViewer oldContent={patch.oldContent} newContent={patch.newContent} />
                  <div className="flex justify-end gap-2">
                    {patch.status === 'pending' || patch.status === 'error' ? (
                      <>
                        <button className="nebula-toggle flex items-center gap-1 px-2 py-1" type="button" onClick={() => reject(patch.id)}>
                          <X size={12} />
                          Reject
                        </button>
                        <button className="nebula-button-primary flex items-center gap-1 px-2 py-1" type="button" disabled={busyId === patch.id} onClick={() => void apply(patch.id)}>
                          <Check size={12} />
                          Apply
                        </button>
                      </>
                    ) : (
                      <span className="text-[11px] text-slate-500">{patch.status === 'applied' ? `Applied ${patch.appliedAt ? new Date(patch.appliedAt).toLocaleString() : ''}` : 'Rejected'}</span>
                    )}
                  </div>
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function Pill({ children }: { children: string }) {
  return <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase text-slate-300">{children}</span>
}
