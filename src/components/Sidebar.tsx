import { Activity, BarChart3, Bell, Bot, ChevronRight, Cpu, Eye, FileText, FlaskConical, Folder, FolderCog, FolderPlus, Gauge, History, Inbox, ListTodo, MemoryStick, MessageSquarePlus, Newspaper, Pin, PlayCircle, Radar, Search, Settings, ShieldCheck, Smartphone, Sparkles, Trash2, Wrench, X, Zap } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { FileNode } from '../lib/fileSystem'
import type { LogEvent } from '../types/agent'
import type { AgentStatus } from '../types/agent'
import type { ConversationFolder, ConversationSearchResult, ConversationSession, WorkspaceAwarenessSnapshot } from '../types/nebula'
import { conversationRepository } from '../lib/storage'
import type { AppSettings, ProfileAvatarPreset } from '../types/settings'
import { FileTree } from './FileTree'

const AgentActivityPanel = lazy(() => import('./AgentActivityPanel').then((module) => ({ default: module.AgentActivityPanel })))
const AgentsPanel = lazy(() => import('./AgentsPanel').then((module) => ({ default: module.AgentsPanel })))
const BenchPanel = lazy(() => import('./BenchPanel').then((module) => ({ default: module.BenchPanel })))
const DiagnosticsPanel = lazy(() => import('./DiagnosticsPanel').then((module) => ({ default: module.DiagnosticsPanel })))
const ContextInspectorPanel = lazy(() => import('./ContextInspectorPanel').then((module) => ({ default: module.ContextInspectorPanel })))
const FineTuningLabPanel = lazy(() => import('./FineTuningLabPanel').then((module) => ({ default: module.FineTuningLabPanel })))
const LauncherPanel = lazy(() => import('./LauncherPanel').then((module) => ({ default: module.LauncherPanel })))
const InsightsPanel = lazy(() => import('./InsightsPanel').then((module) => ({ default: module.InsightsPanel })))
const JarvisModePanel = lazy(() => import('./JarvisModePanel').then((module) => ({ default: module.JarvisModePanel })))
const MemoryPanel = lazy(() => import('./MemoryPanel').then((module) => ({ default: module.MemoryPanel })))
const MemoryInboxPanel = lazy(() => import('./MemoryInboxPanel').then((module) => ({ default: module.MemoryInboxPanel })))
const MobileConnectionPanel = lazy(() => import('./MobileConnectionPanel').then((module) => ({ default: module.MobileConnectionPanel })))
const ModelControlCenter = lazy(() => import('./ModelControlCenter').then((module) => ({ default: module.ModelControlCenter })))
const NotificationsPanel = lazy(() => import('./NotificationsPanel').then((module) => ({ default: module.NotificationsPanel })))
const PatchQueuePanel = lazy(() => import('./PatchQueuePanel').then((module) => ({ default: module.PatchQueuePanel })))
const PermissionCenterPanel = lazy(() => import('./PermissionCenterPanel').then((module) => ({ default: module.PermissionCenterPanel })))
const PrivacyPanel = lazy(() => import('./PrivacyPanel').then((module) => ({ default: module.PrivacyPanel })))
const ProjectProfilesPanel = lazy(() => import('./ProjectProfilesPanel').then((module) => ({ default: module.ProjectProfilesPanel })))
const ProjectHealthPanel = lazy(() => import('./ProjectHealthPanel').then((module) => ({ default: module.ProjectHealthPanel })))
const QuickActionsPanel = lazy(() => import('./QuickActionsPanel').then((module) => ({ default: module.QuickActionsPanel })))
const ReplayPanel = lazy(() => import('./ReplayPanel').then((module) => ({ default: module.ReplayPanel })))
const SettingsPanel = lazy(() => import('./SettingsPanel').then((module) => ({ default: module.SettingsPanel })))
const SkillsPanel = lazy(() => import('./SkillsPanel').then((module) => ({ default: module.SkillsPanel })))
const SourceCardsPanel = lazy(() => import('./SourceCardsPanel').then((module) => ({ default: module.SourceCardsPanel })))
const TasksPanel = lazy(() => import('./TasksPanel').then((module) => ({ default: module.TasksPanel })))
const TimelinePanel = lazy(() => import('./TimelinePanel').then((module) => ({ default: module.TimelinePanel })))
const ToolsPanel = lazy(() => import('./ToolsPanel').then((module) => ({ default: module.ToolsPanel })))
const TrainingLogsPanel = lazy(() => import('./TrainingLogsPanel').then((module) => ({ default: module.TrainingLogsPanel })))
const EMPTY_CONVERSATIONS: ConversationSession[] = []
const EMPTY_CONVERSATION_FOLDERS: ConversationFolder[] = []

export type SidebarTab =
  | 'files'
  | 'jarvis'
  | 'profiles'
  | 'models'
  | 'modelDoctor'
  | 'modelProfiler'
  | 'mobile'
  | 'quick'
  | 'patches'
  | 'tasks'
  | 'activity'
  | 'memory'
  | 'inbox'
  | 'sources'
  | 'agents'
  | 'skills'
  | 'permissions'
  | 'context'
  | 'privacy'
  | 'launcher'
  | 'notifications'
  | 'timeline'
  | 'replay'
  | 'insights'
  | 'diagnostics'
  | 'bench'
  | 'training'
  | 'fineTuning'
  | 'tools'
  | 'settings'

interface Props {
  settings: AppSettings
  logs: LogEvent[]
  files: FileNode[]
  openedFile?: { path: string; content: string } | null
  onPickProject?: () => void
  _unused?: never
  onOpenFile: (path: string) => void
  onSettingsChange: (settings: AppSettings) => void
  skillsVersion: number
  onSkillsChange: () => void
  onStartTask: (goal: string) => void
  onFixMyApp: (goal: string) => void
  onRunQueuedTask?: (id: string) => void
  onLauncherAction: (action: string) => void
  onQuickAction: (actionId: string, target?: string, source?: string) => void
  conversations?: ConversationSession[]
  activeConversationId?: string
  onNewConversation?: () => void
  onSelectConversation?: (id: string) => void
  onToggleConversationPinned?: (id: string) => void
  onDeleteConversation?: (id: string) => void
  conversationFolders?: ConversationFolder[]
  onCreateConversationFolder?: (name: string) => string
  onDeleteConversationFolder?: (id: string) => void
  onMoveConversationToFolder?: (conversationId: string, folderId?: string) => void
  agentStatus: AgentStatus
  lmOnline: boolean
  memoryReady: boolean
  workspaceAwareness?: WorkspaceAwarenessSnapshot | null
  onLog: (type: LogEvent['type'], message: string, details?: unknown) => void
  activeTab?: SidebarTab | null
  onActiveTabChange?: (tab: SidebarTab | null) => void
}

const tabGroups: Array<{ label: string; items: { id: SidebarTab; label: string; short: string; icon: React.ReactNode }[] }> = [
  {
    label: 'Work',
    items: [
      { id: 'files', label: 'Files', short: 'Files', icon: <FileText size={15} /> },
      { id: 'jarvis', label: 'Nebula Core', short: 'Core', icon: <Radar size={15} /> },
      { id: 'profiles', label: 'Project Profiles', short: 'Profiles', icon: <FolderCog size={15} /> },
      { id: 'models', label: 'Model Control', short: 'Models', icon: <Cpu size={15} /> },
      { id: 'quick', label: 'Quick Actions', short: 'Quick', icon: <Zap size={15} /> },
      { id: 'patches', label: 'Patches', short: 'Patches', icon: <FileText size={15} /> },
      { id: 'tasks', label: 'Tasks', short: 'Tasks', icon: <ListTodo size={15} /> },
      { id: 'launcher', label: 'Launcher', short: 'Launch', icon: <Search size={15} /> },
    ],
  },
  {
    label: 'Brain',
    items: [
      { id: 'memory', label: 'Memory', short: 'Memory', icon: <MemoryStick size={15} /> },
      { id: 'inbox', label: 'Memory Inbox', short: 'Inbox', icon: <Inbox size={15} /> },
      { id: 'sources', label: 'Source Cards', short: 'Sources', icon: <Newspaper size={15} /> },
      { id: 'agents', label: 'Agents', short: 'Agents', icon: <Bot size={15} /> },
      { id: 'activity', label: 'Agent Activity', short: 'Activity', icon: <Activity size={15} /> },
      { id: 'skills', label: 'Skills', short: 'Skills', icon: <Sparkles size={15} /> },
      { id: 'permissions', label: 'Permission Center', short: 'Perms', icon: <ShieldCheck size={15} /> },
      { id: 'context', label: 'Context Inspector', short: 'Context', icon: <Eye size={15} /> },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'mobile', label: 'Mobile Connection', short: 'Mobile', icon: <Smartphone size={15} /> },
      { id: 'bench', label: 'Bench', short: 'Bench', icon: <Gauge size={15} /> },
      { id: 'notifications', label: 'Notifications', short: 'Notify', icon: <Bell size={15} /> },
      { id: 'timeline', label: 'Timeline', short: 'Timeline', icon: <History size={15} /> },
      { id: 'replay', label: 'Replay', short: 'Replay', icon: <PlayCircle size={15} /> },
      { id: 'insights', label: 'AI Insights', short: 'Insights', icon: <BarChart3 size={15} /> },
      { id: 'diagnostics', label: 'Diagnostics', short: 'Diag', icon: <Activity size={15} /> },
      { id: 'privacy', label: 'Privacy', short: 'Privacy', icon: <ShieldCheck size={15} /> },
      { id: 'training', label: 'Training Logs', short: 'Training', icon: <FileText size={15} /> },
      { id: 'fineTuning', label: 'Fine-Tuning Lab', short: 'LoRA Lab', icon: <FlaskConical size={15} /> },
      { id: 'tools', label: 'Tools', short: 'Tools', icon: <Wrench size={15} /> },
      { id: 'settings', label: 'Settings', short: 'Settings', icon: <Settings size={15} /> },
    ],
  },
]

const avatarPresets: Array<{ id: ProfileAvatarPreset; label: string; description: string }> = [
  { id: 'nova', label: 'Nova', description: 'Focused stellar core' },
  { id: 'aurora', label: 'Aurora', description: 'Flowing polar light' },
  { id: 'eclipse', label: 'Eclipse', description: 'Dark orbit and corona' },
  { id: 'plasma', label: 'Plasma', description: 'Electric cosmic cloud' },
]

export function Sidebar({
  settings,
  logs,
  files,
  onPickProject,
  onOpenFile,
  onSettingsChange,
  skillsVersion,
  onSkillsChange,
  onStartTask,
  onFixMyApp,
  onRunQueuedTask,
  onLauncherAction,
  onQuickAction,
  conversations = EMPTY_CONVERSATIONS,
  activeConversationId,
  onNewConversation,
  onSelectConversation,
  onToggleConversationPinned,
  onDeleteConversation,
  conversationFolders = EMPTY_CONVERSATION_FOLDERS,
  onCreateConversationFolder,
  onDeleteConversationFolder,
  onMoveConversationToFolder,
  agentStatus,
  lmOnline,
  memoryReady,
  workspaceAwareness = null,
  onLog,
  activeTab,
  onActiveTabChange,
}: Props) {
  const [localTab, setLocalTab] = useState<SidebarTab | null>(null)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [avatarDataUrl, setAvatarDataUrl] = useState('')
  const [conversationQuery, setConversationQuery] = useState('')
  const [conversationMatches, setConversationMatches] = useState<ConversationSearchResult[]>([])
  const [folderFilter, setFolderFilter] = useState('all')
  const [folderEditorOpen, setFolderEditorOpen] = useState(false)
  const [folderDraft, setFolderDraft] = useState('')
  const activePanelRef = useRef<HTMLDivElement | null>(null)
  const sidebarRef = useRef<HTMLElement | null>(null)
  const avatarMenuRef = useRef<HTMLDivElement | null>(null)
  const onLogRef = useRef(onLog)
  const tab = activeTab === undefined ? localTab : activeTab
  const activeItem = tabGroups.flatMap((group) => group.items).find((item) => item.id === tab)
  const matchById = useMemo(() => new Map(conversationMatches.map((match) => [match.conversationId, match])), [conversationMatches])
  const recentChats = useMemo(() => {
    const matchedIds = new Set(conversationMatches.map((match) => match.conversationId))
    return conversations.filter((chat) => matchedIds.has(chat.id) && (folderFilter === 'all' || (folderFilter === 'unfiled' ? !chat.folderId : chat.folderId === folderFilter))).slice(0, 48)
  }, [conversationMatches, conversations, folderFilter])
  const setTab = useCallback((next: SidebarTab | null) => {
    if (onActiveTabChange) onActiveTabChange(next)
    else setLocalTab(next)
  }, [onActiveTabChange])

  useEffect(() => {
    const query = conversationQuery.trim()
    if (!query) {
      setConversationMatches(conversations.slice(0, 48).map((session) => ({
        conversationId: session.id,
        title: session.title,
        folderId: session.folderId,
        projectFolder: session.projectFolder,
        excerpt: session.messages.find((message) => message.role === 'user')?.content.slice(0, 180) ?? '',
        score: session.pinned ? 2 : 1,
        updatedAt: session.updatedAt,
      })))
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void conversationRepository.search(query, 48).then((results) => {
        if (!cancelled) setConversationMatches(results)
      }).catch(() => {
        if (!cancelled) setConversationMatches([])
      })
    }, 160)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [conversationQuery, conversations])

  function createFolder() {
    const name = folderDraft.trim()
    if (!name) return
    const id = onCreateConversationFolder?.(name)
    setFolderDraft('')
    setFolderEditorOpen(false)
    if (id) setFolderFilter(id)
  }

  useEffect(() => {
    activePanelRef.current?.scrollTo(0, 0)
  }, [tab])

  useEffect(() => {
    if (!tab) return
    function dismiss(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (activePanelRef.current?.contains(target) || sidebarRef.current?.contains(target)) return
      setTab(null)
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setTab(null)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', onEscape)
    }
  }, [tab, setTab])

  useEffect(() => {
    onLogRef.current = onLog
  }, [onLog])

  useEffect(() => {
    if (!avatarOpen) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (target instanceof Node && avatarMenuRef.current?.contains(target)) return
      setAvatarOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setAvatarOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [avatarOpen])

  useEffect(() => {
    let cancelled = false
    if (settings.profileAvatarMode !== 'image' || !settings.profileAvatarPath) {
      setAvatarDataUrl('')
      return
    }

    invoke<string>('read_avatar_image', { path: settings.profileAvatarPath })
      .then((dataUrl) => {
        if (!cancelled) setAvatarDataUrl(dataUrl)
      })
      .catch((error) => {
        if (cancelled) return
        setAvatarDataUrl('')
        onLogRef.current('error', `Avatar image failed to load: ${String(error)}`)
      })

    return () => {
      cancelled = true
    }
  }, [settings.profileAvatarMode, settings.profileAvatarPath])

  function openPanel(next: SidebarTab) {
    setTab(tab === next ? null : next)
  }

  async function chooseAvatarImage() {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: 'Choose Nebula avatar image',
        filters: [
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
        ],
      })
      const path = Array.isArray(selected) ? selected[0] : selected
      if (!path) return
      onSettingsChange({
        ...settings,
        profileAvatarMode: 'image',
        profileAvatarPath: path,
      })
      setAvatarOpen(false)
    } catch (error) {
      onLog('error', `Avatar picker failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function selectAvatarPreset(profileAvatarPreset: ProfileAvatarPreset) {
    onSettingsChange({
      ...settings,
      profileAvatarMode: 'preset',
      profileAvatarPreset,
    })
  }

  const avatarSrc = avatarDataUrl

  return (
    <aside ref={sidebarRef} className="nebula-sidebar platform-sidebar codex-sidebar flex w-[292px] shrink-0 flex-col">
      <div className="codex-sidebar-primary">
        <button type="button" className="codex-nav-row" onClick={() => {
          onNewConversation?.()
          setTab(null)
        }}>
          <MessageSquarePlus size={15} />
          <span>New chat</span>
        </button>
        <button type="button" className={`codex-nav-row ${tab === 'launcher' ? 'codex-nav-row-active' : ''}`} onClick={() => openPanel('launcher')}>
          <Search size={15} />
          <span>Search</span>
        </button>
        <button type="button" className={`codex-nav-row ${tab === 'files' ? 'codex-nav-row-active' : ''}`} onClick={() => openPanel('files')}>
          <FileText size={15} />
          <span>Projects</span>
        </button>
        <button type="button" className={`codex-nav-row ${tab === 'tasks' ? 'codex-nav-row-active' : ''}`} onClick={() => openPanel('tasks')}>
          <ListTodo size={15} />
          <span>Tasks</span>
        </button>
        <button type="button" className={`codex-nav-row ${tab === 'skills' ? 'codex-nav-row-active' : ''}`} onClick={() => openPanel('skills')}>
          <Sparkles size={15} />
          <span>Skills</span>
        </button>
        <button type="button" className={`codex-nav-row ${tab === 'diagnostics' ? 'codex-nav-row-active' : ''}`} onClick={() => openPanel('diagnostics')}>
          <Activity size={15} />
          <span>Diagnostics</span>
        </button>
      </div>

      <div className="codex-chat-list min-h-0 flex-1 overflow-auto">
        <div className="codex-chat-search">
          <Search size={12} />
          <input value={conversationQuery} onChange={(event) => setConversationQuery(event.target.value)} placeholder="Search chats" aria-label="Search conversations" />
        </div>
        <div className="codex-folder-toolbar">
          <button type="button" className={folderFilter === 'all' ? 'active' : ''} onClick={() => setFolderFilter('all')}>All</button>
          <button type="button" className={folderFilter === 'unfiled' ? 'active' : ''} onClick={() => setFolderFilter('unfiled')}>Unfiled</button>
          {conversationFolders.map((folder) => (
            <span key={folder.id} className={folderFilter === folder.id ? 'active' : ''}>
              <button type="button" onClick={() => setFolderFilter(folder.id)}><Folder size={11} />{folder.name}</button>
              <button type="button" onClick={() => onDeleteConversationFolder?.(folder.id)} aria-label={`Delete ${folder.name}`}><X size={10} /></button>
            </span>
          ))}
          <button type="button" className="codex-folder-add" onClick={() => setFolderEditorOpen((current) => !current)} aria-label="Create chat folder"><FolderPlus size={12} /></button>
        </div>
        {folderEditorOpen && <div className="codex-folder-editor"><input autoFocus value={folderDraft} onChange={(event) => setFolderDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') createFolder(); if (event.key === 'Escape') setFolderEditorOpen(false) }} placeholder="Folder name" /><button type="button" onClick={createFolder}>Add</button></div>}
        <div className="codex-sidebar-section-label">Chats</div>
        {recentChats.length > 0 ? (
          recentChats.map((chat) => (
            <div key={chat.id} className={`codex-chat-row-shell ${chat.id === activeConversationId ? 'codex-chat-row-shell-active' : ''}`}>
              <button
                type="button"
                className="codex-chat-row"
                onClick={() => {
                  onSelectConversation?.(chat.id)
                  setTab(null)
                }}
                title={chat.title}
              >
                <span>{chat.title}</span>
                {conversationQuery && <small>{matchById.get(chat.id)?.excerpt}</small>}
                <time>{relativeTime(chat.updatedAt)}</time>
              </button>
              <select
                className="codex-chat-folder-select"
                value={chat.folderId || ''}
                onChange={(event) => onMoveConversationToFolder?.(chat.id, event.target.value || undefined)}
                aria-label={`Move ${chat.title} to folder`}
                title="Move chat to folder"
              >
                <option value="">No folder</option>
                {conversationFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
              <button
                type="button"
                className={`codex-chat-row-action ${chat.pinned ? 'codex-chat-row-action-active' : ''}`}
                onClick={() => onToggleConversationPinned?.(chat.id)}
                aria-label={chat.pinned ? 'Unpin chat' : 'Pin chat'}
                title={chat.pinned ? 'Unpin chat' : 'Pin chat'}
              >
                <Pin size={11} />
              </button>
              <button
                type="button"
                className="codex-chat-row-action codex-chat-row-delete"
                onClick={() => onDeleteConversation?.(chat.id)}
                aria-label="Delete chat"
                title={chat.id === activeConversationId && agentStatus !== 'idle' ? 'Wait for the active response before deleting this chat' : 'Delete chat'}
                disabled={chat.id === activeConversationId && agentStatus !== 'idle'}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))
        ) : (
          <div className="codex-empty-history">No chats yet</div>
        )}
        <details className="codex-more-tools">
          <summary>
            More tools
            <ChevronRight size={13} />
          </summary>
          {tabGroups.map((group) => (
            <div key={group.label} className="codex-more-group">
              <div className="codex-sidebar-section-label">{group.label}</div>
              {group.items.filter((item) => !['files', 'launcher', 'tasks', 'skills', 'diagnostics', 'settings'].includes(item.id)).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openPanel(item.id)}
                  className={`codex-more-row ${tab === item.id ? 'codex-more-row-active' : ''}`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </details>
      </div>

      <div className="codex-sidebar-footer">
        <div className="codex-avatar-menu-wrap" ref={avatarMenuRef}>
          <button
            type="button"
            className="codex-avatar-button"
            onClick={() => setAvatarOpen((current) => !current)}
            aria-label="Customize Nebula avatar"
            title="Customize avatar"
          >
            {avatarSrc ? (
              <img className="codex-user-image" src={avatarSrc} alt="" onError={() => setAvatarDataUrl('')} />
            ) : (
              <span className={`codex-user-orb codex-user-orb-${settings.profileAvatarPreset ?? 'nova'}`} aria-hidden="true" />
            )}
          </button>
          {avatarOpen && (
            <div className="codex-avatar-popover">
              <div className="codex-avatar-popover-title">Avatar</div>
              <div className="codex-avatar-preview" aria-label="Current avatar preview">
                {avatarSrc ? (
                  <img className="codex-avatar-preview-image" src={avatarSrc} alt="" onError={() => setAvatarDataUrl('')} />
                ) : (
                  <span className={`codex-avatar-preview-orb codex-user-orb codex-user-orb-${settings.profileAvatarPreset ?? 'nova'}`} aria-hidden="true" />
                )}
                <div>
                  <strong>{avatarSrc ? 'Custom image' : avatarPresets.find((preset) => preset.id === (settings.profileAvatarPreset ?? 'nova'))?.label ?? 'Nebula preset'}</strong>
                  <span>{avatarSrc ? 'Loaded from your PC' : avatarPresets.find((preset) => preset.id === (settings.profileAvatarPreset ?? 'nova'))?.description ?? 'Built-in Nebula style'}</span>
                </div>
              </div>
              <button type="button" className="codex-avatar-action" onClick={() => void chooseAvatarImage()}>
                Choose image
              </button>
              <div className="codex-avatar-presets">
                {avatarPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={settings.profileAvatarMode === 'preset' && settings.profileAvatarPreset === preset.id ? 'codex-avatar-preset-active' : ''}
                    onClick={() => selectAvatarPreset(preset.id)}
                    title={preset.label}
                    aria-label={`Use ${preset.label} avatar`}
                  >
                    <span className={`codex-user-orb codex-user-orb-${preset.id}`} aria-hidden="true" />
                    <span className="codex-avatar-preset-label">{preset.label}</span>
                  </button>
                ))}
              </div>
              {settings.profileAvatarPath && (
                <button
                  type="button"
                  className="codex-avatar-action codex-avatar-clear"
                  onClick={() => onSettingsChange({ ...settings, profileAvatarMode: 'preset', profileAvatarPath: '' })}
                >
                  Clear image
                </button>
              )}
            </div>
          )}
        </div>
        <button type="button" className="codex-project-footer" onClick={() => openPanel('profiles')}>
          <span className="min-w-0 flex-1">
            <strong>{settings.projectFolder.split(/[\\/]/).filter(Boolean).at(-1) || 'Nebula'}</strong>
            <small>{agentStatus.replaceAll('_', ' ')}</small>
          </span>
        </button>
        <button type="button" className="codex-footer-icon" onClick={() => openPanel('settings')} aria-label="Open Settings">
          <Settings size={15} />
        </button>
      </div>

      {createPortal(<div ref={activePanelRef} className={`sidebar-active-panel codex-panel-drawer min-h-0 overflow-auto ${tab ? 'codex-panel-drawer-open' : ''}`}>
        {tab && (
          <div className="sidebar-active-panel-title">
            <span className="flex-1">{activeItem?.label ?? 'Panel'}</span>
            <button type="button" className="codex-panel-close" onClick={() => setTab(null)} aria-label="Close panel">
              <X size={14} />
            </button>
          </div>
        )}
        <Suspense fallback={<PanelLoadingState />}>
        <div className="sidebar-panel-content">
          {tab === 'files' && <FileTree nodes={files} onOpen={onOpenFile} workspaceAwareness={workspaceAwareness} onQuickAction={onQuickAction} projectFolder={settings.projectFolder} />}
          {tab === 'files' && onPickProject && <button type="button" className="mx-3 mt-2 text-xs text-slate-500 hover:text-slate-300" onClick={onPickProject}>Pick folder</button>}
          {tab === 'jarvis' && (
            <JarvisModePanel
              settings={settings}
              logs={logs}
              agentStatus={agentStatus}
              lmOnline={lmOnline}
              memoryReady={memoryReady}
              workspaceAwareness={workspaceAwareness}
              onOpenPanel={(next) => setTab(next as SidebarTab)}
              onLog={onLog}
            />
          )}
          {tab === 'profiles' && <><ProjectHealthPanel workspace={workspaceAwareness} /><ProjectProfilesPanel settings={settings} onChange={onSettingsChange} onLog={onLog} /></>}
          {tab === 'models' && <ModelControlCenter settings={settings} onChange={onSettingsChange} onLog={onLog} />}
          {tab === 'modelDoctor' && <ModelControlCenter settings={settings} onChange={onSettingsChange} onLog={onLog} initialView="doctor" />}
          {tab === 'modelProfiler' && <ModelControlCenter settings={settings} onChange={onSettingsChange} onLog={onLog} initialView="speed" />}
          {tab === 'quick' && <QuickActionsPanel onRun={(id, t, src) => onQuickAction(id, t, src)} />}
          {tab === 'patches' && <PatchQueuePanel onLog={onLog} />}
          {tab === 'tasks' && <TasksPanel onStartTask={onStartTask} onFixMyApp={onFixMyApp} onRunQueuedTask={onRunQueuedTask} />}
          {tab === 'activity' && <AgentActivityPanel logs={logs} agentStatus={agentStatus} />}
          {tab === 'memory' && <MemoryPanel settings={settings} />}
          {tab === 'inbox' && <MemoryInboxPanel memoryFolder={settings.memoryFolder} />
          }
          {tab === 'sources' && <SourceCardsPanel onLog={onLog} />}
          {tab === 'agents' && <AgentsPanel skillsVersion={skillsVersion} onSkillsChange={onSkillsChange} />}
          {tab === 'skills' && <SkillsPanel skillsVersion={skillsVersion} onSkillsChange={onSkillsChange} />}
          {tab === 'permissions' && <PermissionCenterPanel settings={settings} onChange={onSettingsChange} />}
          {tab === 'context' && <ContextInspectorPanel />}
          {tab === 'launcher' && <LauncherPanel settings={settings} onAction={onLauncherAction} onLog={onLog} />}
          {tab === 'notifications' && <NotificationsPanel />}
          {tab === 'timeline' && <TimelinePanel logs={logs} />}
          {tab === 'replay' && <ReplayPanel logs={logs} />}
          {tab === 'insights' && <InsightsPanel logs={logs} />}
          {tab === 'diagnostics' && <DiagnosticsPanel settings={settings} />}
          {tab === 'privacy' && <PrivacyPanel settings={settings} />}
          {tab === 'mobile' && <MobileConnectionPanel />}
          {tab === 'bench' && <BenchPanel settings={settings} onLog={onLog} />}
          {tab === 'training' && <TrainingLogsPanel />}
          {tab === 'fineTuning' && <FineTuningLabPanel />}
          {tab === 'tools' && <ToolsPanel />}
          {tab === 'settings' && <SettingsPanel settings={settings} logs={logs} onChange={onSettingsChange} />}
        </div>
        </Suspense>
      </div>, document.body)}
    </aside>
  )
}

function PanelLoadingState() {
  return (
    <div className="sidebar-panel-content" role="status" aria-live="polite">
      <div className="mx-3 my-4 space-y-3">
        <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
        <div className="h-16 animate-pulse rounded-md bg-white/5" />
        <span className="sr-only">Loading panel</span>
      </div>
    </div>
  )
}

function relativeTime(value: string) {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return ''
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days}d`
  return `${Math.floor(days / 7)}w`
}
