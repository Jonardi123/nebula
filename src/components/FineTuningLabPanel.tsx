import { Download, FlaskConical, RefreshCw, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { buildFineTuneDataset, downloadFineTuneDataset, getTrainingLogs } from '../lib/trainingLogs'
import type { TrainingLogEntry } from '../types/nebula'

export function FineTuningLabPanel() {
  const [logs, setLogs] = useState<TrainingLogEntry[]>(() => getTrainingLogs())
  const dataset = useMemo(() => buildFineTuneDataset(logs), [logs])

  function refresh() {
    setLogs(getTrainingLogs())
  }

  useEffect(() => {
    window.addEventListener('nebula-training-logs-changed', refresh)
    return () => window.removeEventListener('nebula-training-logs-changed', refresh)
  }, [])

  return (
    <div className="space-y-3 p-3 text-xs">
      <section className="training-hero">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-cyan-50"><FlaskConical size={15} /> Fine-Tuning Lab</div>
          <p>Audits every local trace, redacts private data, and exports only Gemma-safe examples that pass the quality gate.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className="nebula-button-primary flex items-center justify-center gap-2 px-3 py-2" type="button" disabled={dataset.audit.train + dataset.audit.validation === 0} onClick={() => { downloadFineTuneDataset(logs); refresh() }}>
            <Download size={13} />
            Export split
          </button>
          <button className="nebula-toggle flex items-center justify-center gap-2 px-3 py-2" type="button" onClick={refresh}>
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </section>

      <section className="rounded-md border border-amber-300/20 bg-amber-300/[0.07] p-3 text-[11px] leading-5 text-amber-50">
        <div className="flex items-center gap-2 font-semibold"><ShieldCheck size={13} /> Recommended target for this PC</div>
        <p className="mt-1 text-amber-100/80">Gemma 7B QLoRA runs in the included Google Colab workflow. This Windows AMD machine remains the inference target; Qwen and the review model are not trained.</p>
      </section>

      <section className="grid grid-cols-4 gap-2">
        <Metric label="Train" value={String(dataset.audit.train)} />
        <Metric label="Validation" value={String(dataset.audit.validation)} />
        <Metric label="Rejected" value={String(dataset.audit.rejected + dataset.audit.invalid)} />
        <Metric label="Duplicates" value={String(dataset.audit.duplicate)} />
      </section>

      <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
        <div className="font-semibold text-slate-100">Dataset checks</div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
          <div>Eligible source traces: <strong className="text-slate-200">{dataset.audit.accepted}</strong></div>
          <div>Redaction catches: <strong className="text-slate-200">{dataset.audit.redacted}</strong></div>
          <div>Invalid/error traces removed: <strong className="text-slate-200">{dataset.audit.invalid}</strong></div>
          <div>Specialist traces excluded: <strong className="text-slate-200">{dataset.audit.routeMismatch}</strong></div>
          <div>Identity/tool rejects: <strong className="text-slate-200">{dataset.audit.identityLeaks + dataset.audit.malformedTools + dataset.audit.unsafeTools}</strong></div>
          <div>Total local logs inspected: <strong className="text-slate-200">{dataset.audit.total}</strong></div>
        </div>
        {dataset.audit.train + dataset.audit.validation < 50 && <p className="mt-3 rounded border border-white/10 bg-black/20 p-2 leading-4 text-slate-500">The Colab bundle adds the reviewed synthetic seed set. Local traces still pass redaction, identity, route, tool, and quality checks before joining it.</p>}
      </section>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="doctor-metric doctor-metric-neutral"><span>{label}</span><strong>{value}</strong></div>
}
