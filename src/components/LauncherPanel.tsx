import { FolderSearch, Play, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { buildLauncherIndex, launchItem, searchLauncherItems } from '../lib/launcher'
import type { LauncherItem } from '../types/nebula'
import type { AppSettings } from '../types/settings'
import type { LogEvent } from '../types/agent'

export function LauncherPanel({
  settings,
  onLog,
  onAction,
}: {
  settings: AppSettings
  onLog: (type: LogEvent['type'], message: string, details?: unknown) => void
  onAction?: (action: string) => void
}) {
  const [items, setItems] = useState<LauncherItem[]>([])
  const [query, setQuery] = useState('')
  const results = useMemo(() => searchLauncherItems(items, query), [items, query])

  async function refresh() {
    const next = await buildLauncherIndex(settings)
    setItems(next)
    onLog('status', `Launcher indexed ${next.length} items.`)
  }

  async function run(item: LauncherItem) {
    if (item.kind === 'action' && onAction) {
      onAction(item.value)
      onLog('tool_result', `Action selected: ${item.value}`, item)
      return
    }
    const message = await launchItem(item)
    onLog('tool_result', message, item)
  }

  useEffect(() => {
    void refresh()
  }, [settings.projectFolder, JSON.stringify(settings.launcherIndexedFolders ?? [])])

  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="marketplace-search flex items-center gap-2 px-3 py-2">
        <FolderSearch size={14} className="text-cyan-200" />
        <input
          className="min-w-0 flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-500"
          placeholder="Search apps, projects, files, actions..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" onClick={refresh} className="text-slate-400 hover:text-cyan-100">
          <RefreshCw size={13} />
        </button>
      </div>
      <div className="space-y-2">
        {results.map((item) => (
          <button key={item.id} className="skill-card w-full rounded-md border border-slate-800 bg-slate-950 p-3 text-left" type="button" onClick={() => run(item)}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-100">{item.label}</div>
                <div className="mt-1 truncate text-[11px] text-slate-500">{item.description}</div>
              </div>
              <span className="flex shrink-0 items-center gap-1 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 text-[11px] text-cyan-100">
                <Play size={10} />
                {item.kind}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
