import { AlertTriangle, FileText, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { assessMemoryQuality } from '../lib/memoryQuality'
import { MEMORY_FILES, readMemory, searchMemory } from '../lib/memory'
import type { MemoryQualityScore } from '../types/nebula'
import type { AppSettings } from '../types/settings'

export function MemoryPanel({ settings }: { settings: AppSettings }) {
  const [content, setContent] = useState('Pick a memory file or search memory.')
  const [query, setQuery] = useState('')
  const [quality, setQuality] = useState<MemoryQualityScore[]>([])
  const [scanning, setScanning] = useState(false)

  async function openFile(file: (typeof MEMORY_FILES)[number]) {
    setContent(await readMemory(settings.memoryFolder, file).catch((error) => `Could not read ${file}: ${String(error)}`))
  }

  async function runSearch() {
    const results = await searchMemory(settings.memoryFolder, query).catch(() => [])
    setContent(results.map((result) => `${result.file}:${result.line} ${result.text}`).join('\n') || 'No memory matches.')
  }

  async function scanQuality() {
    setScanning(true)
    try {
      setQuality(await assessMemoryQuality(settings.memoryFolder))
    } finally {
      setScanning(false)
    }
  }

  const attention = quality.filter((item) => item.status !== 'healthy')

  return (
    <div className="space-y-3 p-3 text-xs">
      <header className="memory-quality-header">
        <div><div className="flex items-center gap-2 text-sm font-semibold text-slate-100"><ShieldCheck size={15} />Memory Core</div><p>Local memory with source and staleness checks.</p></div>
        <button type="button" onClick={() => void scanQuality()} disabled={scanning}><RefreshCw className={scanning ? 'animate-spin' : ''} size={13} />Audit</button>
      </header>
      <div className="memory-file-strip">
        {MEMORY_FILES.map((file) => <button key={file} type="button" onClick={() => void openFile(file)}><FileText size={12} />{file.replace('.md', '').replaceAll('_', ' ')}</button>)}
      </div>
      <div className="memory-search-row"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runSearch() }} placeholder="Search memory" /><button type="button" onClick={() => void runSearch()} aria-label="Search memory"><Search size={13} /></button></div>
      {quality.length > 0 && (
        <section className="memory-quality-summary">
          <div><strong>{quality.length}</strong><span>entries</span></div>
          <div><strong>{attention.length}</strong><span>need review</span></div>
          <div><strong>{quality.length ? Math.round(quality.reduce((sum, item) => sum + item.score, 0) / quality.length) : 0}</strong><span>quality</span></div>
        </section>
      )}
      {attention.slice(0, 8).map((item) => <article key={item.id} className="memory-quality-issue"><AlertTriangle size={13} /><div><strong>{item.file}:{item.line} · {item.status.replaceAll('_', ' ')}</strong><p>{item.content}</p><small>{item.reasons.join(' ')}</small></div></article>)}
      <pre className="memory-content-view">{content}</pre>
    </div>
  )
}
