import { AlertTriangle, Check, X } from 'lucide-react'
import { useState } from 'react'
import type { ApprovalRequest } from '../types/tools'
import { DiffViewer } from './DiffViewer'

interface Props {
  approval: ApprovalRequest | null
  onDecision: (approved: boolean) => void
}

export function ApprovalModal({ approval, onDecision }: Props) {
  const [confirm, setConfirm] = useState('')
  if (!approval) return null

  const canApprove = !approval.requiresTypedConfirm || confirm === 'CONFIRM'

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6">
      <div className="glass-panel w-full max-w-2xl rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-amber-400/15 text-amber-300">
            <AlertTriangle size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">Approval Required</h2>
            <p className="mt-1 text-sm text-slate-400">{approval.reason}</p>
          </div>
          <span className="rounded-md border border-amber-500/40 px-2 py-1 text-xs text-amber-200">{approval.riskLevel}</span>
        </div>
        <div className="mt-4 rounded-md border border-slate-800 bg-slate-950 p-3">
          <div className="mb-2 text-xs uppercase text-slate-500">Exact action</div>
          <pre className="terminal-font whitespace-pre-wrap text-xs text-slate-200">{JSON.stringify(approval.toolRequest, null, 2)}</pre>
        </div>
        {approval.oldContent !== undefined && approval.newContent !== undefined && (
          <div className="mt-3">
            <DiffViewer oldContent={approval.oldContent} newContent={approval.newContent} />
          </div>
        )}
        {approval.requiresTypedConfirm && (
          <input
            className="mt-3 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none"
            placeholder="Type CONFIRM"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-700 px-3 text-slate-200 hover:bg-slate-800" onClick={() => onDecision(false)}>
            <X size={15} />
            Reject
          </button>
          <button className="inline-flex h-9 items-center gap-2 rounded-md bg-cyan-400 px-3 text-slate-950 hover:bg-cyan-300" disabled={!canApprove} onClick={() => onDecision(true)}>
            <Check size={15} />
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}
