import { Bot, Eye, FileText, FlaskConical, FolderOpen, MessageSquare, Play, Search, Settings, ShieldCheck, Sparkles, Stethoscope, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildLauncherIndex, launchItem, searchLauncherItems } from '../lib/launcher'
import type { ConversationSession, LauncherItem } from '../types/nebula'
import type { AppSettings } from '../types/settings'
import type { LogEvent } from '../types/agent'
import type { SidebarTab } from './Sidebar'

interface Props {
  open: boolean
  settings: AppSettings
  onClose: () => void
  onAction: (action: string) => void
  onOpenPanel: (tab: SidebarTab | null) => void
  onSend: (content: string) => void
  onPickProject?: () => void
  conversations?: ConversationSession[]
  onSelectConversation?: (id: string) => void
  onLog: (type: LogEvent['type'], message: string, details?: unknown) => void
}

const panelActions: Array<{ id: string; label: string; description: string; tab: SidebarTab; icon: React.ReactNode }> = [
  { id: 'panel:models', label: 'Open Models', description: 'Manage daily, code, and review models', tab: 'models', icon: <Bot size={15} /> },
  { id: 'panel:model-doctor', label: 'Open Model Doctor', description: 'Diagnose LM Studio and model loading issues', tab: 'modelDoctor', icon: <Stethoscope size={15} /> },
  { id: 'panel:training', label: 'Open Training Logs', description: 'Export accepted local examples as JSONL', tab: 'training', icon: <FileText size={15} /> },
  { id: 'panel:fine-tuning', label: 'Open Fine-Tuning Lab', description: 'Build a redacted QLoRA train and validation split', tab: 'fineTuning', icon: <FlaskConical size={15} /> },
  { id: 'panel:context', label: 'Open Context Inspector', description: 'Review the latest context bundle before it reached a model', tab: 'context', icon: <Eye size={15} /> },
  { id: 'panel:privacy', label: 'Open Privacy Dashboard', description: 'Inspect local data locations and provider exposure', tab: 'privacy', icon: <ShieldCheck size={15} /> },
  { id: 'panel:skills', label: 'Open Skills', description: 'View and manage Nebula skills', tab: 'skills', icon: <Sparkles size={15} /> },
  { id: 'panel:settings', label: 'Open Settings', description: 'Configure Nebula', tab: 'settings', icon: <Settings size={15} /> },
]

function actionToLauncherItem(action: (typeof panelActions)[number]): LauncherItem {
  return {
    id: action.id,
    label: action.label,
    description: action.description,
    kind: 'action',
    value: action.tab,
  }
}

function iconFor(item: LauncherItem) {
  if (item.id.startsWith('panel:model-doctor')) return <Stethoscope size={15} />
  if (item.id.startsWith('panel:training')) return <FileText size={15} />
  if (item.id.startsWith('panel:fine-tuning')) return <FlaskConical size={15} />
  if (item.id.startsWith('panel:context')) return <Eye size={15} />
  if (item.id.startsWith('panel:privacy')) return <ShieldCheck size={15} />
  if (item.kind === 'file') return <FileText size={15} />
  if (item.kind === 'project') return <FolderOpen size={15} />
  if (item.kind === 'conversation') return <MessageSquare size={15} />
  if (item.kind === 'action') return <Sparkles size={15} />
  return <Play size={15} />
}

export function CommandCenter({ open, settings, onClose, onAction, onOpenPanel, onSend, onPickProject, conversations = [], onSelectConversation, onLog }: Props) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<LauncherItem[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const results = useMemo(() => searchLauncherItems(items, query), [items, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    window.setTimeout(() => inputRef.current?.focus(), 30)
    buildLauncherIndex(settings)
      .then((next) => setItems([
        ...panelActions.map(actionToLauncherItem),
        ...conversations.map((conversation) => ({
          id: `conversation:${conversation.id}`,
          label: conversation.title,
          description: conversation.messages.slice(-8).map((message) => message.content).join(' ').replace(/\s+/g, ' ').slice(0, 480),
          kind: 'conversation' as const,
          value: conversation.id,
        })),
        ...next,
      ]))
      .catch((error) => onLog('error', `Command Center index failed: ${String(error)}`))
  }, [open, settings.projectFolder, settings.launcherIndexedFolders])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((current) => Math.min(results.length - 1, current + 1))
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((current) => Math.max(0, current - 1))
      }
      if (event.key === 'Enter') {
        const first = results[activeIndex] || results[0]
        if (first) void run(first)
        else if (query.trim()) {
          onSend(query.trim())
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeIndex, open, onClose, onSend, query, results])

  useEffect(() => setActiveIndex(0), [query])

  async function run(item: LauncherItem) {
    if (item.kind === 'conversation') {
      onSelectConversation?.(item.value)
      onClose()
      return
    }
    if (item.id.startsWith('panel:')) {
      onOpenPanel(item.value as SidebarTab)
      onLog('status', `Command Center opened ${item.label}.`, item)
      onClose()
      return
    }
    if (item.kind === 'action') {
      if (item.value === 'settings' || item.value === 'models' || item.value === 'memory') {
        onOpenPanel(item.value === 'memory' ? 'inbox' : (item.value as SidebarTab))
      } else {
        onAction(item.value)
      }
      onClose()
      return
    }
    const message = await launchItem(item)
    onLog('tool_result', message, item)
    onClose()
  }

  if (!open) return null

  return (
    <div className="command-center-backdrop" onPointerDown={onClose}>
      <div className="command-center-shell" onPointerDown={(event) => event.stopPropagation()}>
        <div className="command-center-search">
          <Search size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search actions, files, models, panels, or type a prompt..."
          />
          <button type="button" onClick={onClose} aria-label="Close Command Center">
            <X size={16} />
          </button>
        </div>

        <div className="command-center-hints">
          <button type="button" onClick={onPickProject}>Choose project</button>
          <button type="button" onClick={() => onOpenPanel('modelDoctor')}>Model Doctor</button>
          <button type="button" onClick={() => onOpenPanel('training')}>Training Logs</button>
          <button type="button" onClick={() => onOpenPanel('fineTuning')}>LoRA Lab</button>
        </div>

        <div className="command-center-results">
          {results.map((item, index) => (
            <button key={item.id} type="button" className={`command-center-row ${index === activeIndex ? 'command-center-row-active' : ''}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => void run(item)}>
              <span className="command-center-icon">{iconFor(item)}</span>
              <span className="min-w-0 flex-1">
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              <em>{item.kind}</em>
            </button>
          ))}
          {results.length === 0 && (
            <button
              type="button"
              className="command-center-empty"
              onClick={() => {
                if (query.trim()) onSend(query.trim())
                onClose()
              }}
            >
              Send "{query.trim() || 'new prompt'}" to Nebula
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
