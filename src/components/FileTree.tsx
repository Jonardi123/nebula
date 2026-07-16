import { Bot, Code2, Copy, File, FileJson, Folder, FolderOpen, Pin, Search, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { searchProjectFiles, type FileNode } from '../lib/fileSystem'
import { getFileInsight, toggleFavoriteFile, togglePinnedFile } from '../lib/fileInsights'
import { suggestionsForFile } from '../lib/predictiveSuggestions'
import type { ProjectSearchResult, WorkspaceAwarenessSnapshot } from '../types/nebula'

export function FileTree({
  nodes,
  onOpen,
  workspaceAwareness,
  onQuickAction,
  projectFolder,
}: {
  nodes: FileNode[]
  onOpen: (path: string) => void
  workspaceAwareness?: WorkspaceAwarenessSnapshot | null
  onQuickAction?: (actionId: string, target?: string, source?: string) => void
  projectFolder?: string
}) {
  const [query, setQuery] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [contentResults, setContentResults] = useState<ProjectSearchResult[]>([])
  const [contentSearchRunning, setContentSearchRunning] = useState(false)
  const [contentSearchError, setContentSearchError] = useState('')
  const filtered = useMemo(() => filterNodes(nodes, query), [nodes, query])
  void refreshKey

  async function runContentSearch() {
    const search = query.trim()
    if (!projectFolder || !search) return
    setContentSearchRunning(true)
    setContentSearchError('')
    try {
      setContentResults(await searchProjectFiles(projectFolder, search))
    } catch (error) {
      setContentResults([])
      setContentSearchError(error instanceof Error ? error.message : String(error))
    } finally {
      setContentSearchRunning(false)
    }
  }

  return (
    <div className="file-tree space-y-2">
      <div className="marketplace-search flex items-center gap-2 px-3 py-2">
        <Search size={13} className="text-cyan-200" />
        <input
          className="min-w-0 flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-500"
          value={query}
          placeholder="Filter files, or Enter to search contents..."
          onChange={(event) => {
            setQuery(event.target.value)
            if (!event.target.value.trim()) setContentResults([])
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            void runContentSearch()
          }}
        />
        <button type="button" className="text-slate-500 hover:text-cyan-100" title="Search file contents" disabled={!query.trim() || !projectFolder || contentSearchRunning} onClick={() => void runContentSearch()}>
          <Search size={13} />
        </button>
      </div>
      {(contentResults.length > 0 || contentSearchRunning || contentSearchError) && (
        <section className="mx-2 rounded-md border border-cyan-300/15 bg-cyan-300/[0.05] p-2">
          <div className="mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.08em] text-cyan-100/80">
            <span>Content results</span>
            <span>{contentSearchRunning ? 'Searching...' : `${contentResults.length} match${contentResults.length === 1 ? '' : 'es'}`}</span>
          </div>
          {contentSearchError && <p className="text-[11px] leading-4 text-amber-200">{contentSearchError}</p>}
          <div className="max-h-52 space-y-1 overflow-auto">
            {contentResults.map((result, index) => (
              <button key={`${result.path}:${result.line}:${index}`} type="button" className="block w-full rounded px-1.5 py-1 text-left hover:bg-white/[0.06]" onClick={() => onOpen(result.path)}>
                <span className="block truncate text-[10px] text-cyan-100">{result.path.split(/[\\/]/).slice(-2).join(' / ')}:{result.line}</span>
                <span className="block truncate text-[11px] text-slate-400">{result.text}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {filtered.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          onOpen={onOpen}
          level={0}
          workspaceAwareness={workspaceAwareness}
          onQuickAction={onQuickAction}
          onInsightChange={() => setRefreshKey((key) => key + 1)}
        />
      ))}
    </div>
  )
}

function filterNodes(nodes: FileNode[], query: string): FileNode[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return nodes
  return nodes
    .map((node) => {
      const children = node.children ? filterNodes(node.children, query) : undefined
      const matches = node.name.toLowerCase().includes(needle) || node.path.toLowerCase().includes(needle)
      if (!matches && (!children || children.length === 0)) return null
      return { ...node, children }
    })
    .filter(Boolean) as FileNode[]
}

function iconFor(node: FileNode) {
  if (node.isDir) return node.children?.length ? FolderOpen : Folder
  if (/\.json$/i.test(node.name)) return FileJson
  if (/\.(ts|tsx|js|jsx|rs|css|html)$/i.test(node.name)) return Code2
  return File
}

function TreeNode({
  node,
  level,
  onOpen,
  workspaceAwareness,
  onQuickAction,
  onInsightChange,
}: {
  node: FileNode
  level: number
  onOpen: (path: string) => void
  workspaceAwareness?: WorkspaceAwarenessSnapshot | null
  onQuickAction?: (actionId: string, target?: string, source?: string) => void
  onInsightChange: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const Icon = iconFor(node)
  const insight = !node.isDir ? getFileInsight(node.path, workspaceAwareness) : null
  const suggestions = !node.isDir ? suggestionsForFile(node.path, workspaceAwareness) : []

  async function copyPath() {
    await navigator.clipboard?.writeText(node.path).catch(() => undefined)
  }

  return (
    <div className="relative">
      <button
        className="file-node group flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left text-xs text-slate-300"
        style={{ paddingLeft: 8 + level * 14 }}
        onClick={() => !node.isDir && onOpen(node.path)}
        onContextMenu={(event) => {
          if (node.isDir) return
          event.preventDefault()
          setMenuOpen((open) => !open)
        }}
      >
        <Icon size={14} className={node.isDir ? 'text-amber-300' : 'text-slate-500'} />
        <span className="truncate">{node.name}</span>
        {insight?.gitStatus && <span className="ml-auto rounded-full bg-amber-300/15 px-1.5 py-0.5 text-[9px] text-amber-100">git</span>}
        {insight?.pinned && <Pin size={11} className="text-cyan-200" />}
        {insight?.favorite && <Star size={11} className="text-fuchsia-200" />}
        {insight && insight.importanceScore > 0 && (
          <span className="hidden rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] text-slate-500 group-hover:inline">
            {insight.importanceScore}
          </span>
        )}
      </button>
      {menuOpen && insight && (
        <div className="file-inline-menu">
          <div className="mb-2 text-[10px] uppercase tracking-[0.08em] text-slate-500">AI actions</div>
          {suggestions.map((suggestion) => (
            <button key={suggestion.id} type="button" onClick={() => onQuickAction?.(suggestion.actionId, node.path, 'file-context-menu')}>
              <Bot size={12} />
              {suggestion.label}
              <span>{suggestion.confidence}%</span>
            </button>
          ))}
          <button type="button" onClick={() => onQuickAction?.('explain-current-file', node.path, 'file-context-menu')}>
            <Bot size={12} />
            Explain
          </button>
          <button type="button" onClick={() => onQuickAction?.('find-bugs', node.path, 'file-context-menu')}>
            <Bot size={12} />
            Review
          </button>
          <button type="button" onClick={() => onQuickAction?.('optimize-code', node.path, 'file-context-menu')}>
            <Bot size={12} />
            Optimize
          </button>
          <button type="button" onClick={() => {
            togglePinnedFile(node.path)
            onInsightChange()
          }}>
            <Pin size={12} />
            {insight.pinned ? 'Unpin' : 'Pin'}
          </button>
          <button type="button" onClick={() => {
            toggleFavoriteFile(node.path)
            onInsightChange()
          }}>
            <Star size={12} />
            {insight.favorite ? 'Unfavorite' : 'Favorite'}
          </button>
          <button type="button" onClick={copyPath}>
            <Copy size={12} />
            Copy Path
          </button>
          {insight.summary && <p>{insight.summary.summary}</p>}
        </div>
      )}
      {node.children?.map((child) => (
        <TreeNode
          key={child.path}
          node={child}
          onOpen={onOpen}
          level={level + 1}
          workspaceAwareness={workspaceAwareness}
          onQuickAction={onQuickAction}
          onInsightChange={onInsightChange}
        />
      ))}
    </div>
  )
}
