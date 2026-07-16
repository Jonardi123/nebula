import { Circle, Command, PanelLeft, PanelRight, Square } from 'lucide-react'
import type { AgentStatus } from '../types/agent'
import type { NebulaServiceState } from '../types/nebula'
import type { ActionMode } from '../types/settings'

interface Props {
  projectName: string
  model: string
  memoryReady: boolean
  agentStatus: AgentStatus
  actionMode: ActionMode
  notificationCount: number
  serviceState: NebulaServiceState
  onToggleSidebar: () => void
  onOpenCommandCenter: () => void
  onToggleInspector: () => void
  inspectorOpen: boolean
  onStop: () => void
}

export function TopBar({ projectName, model, memoryReady, agentStatus, actionMode, notificationCount, serviceState, onToggleSidebar, onOpenCommandCenter, onToggleInspector, inspectorOpen, onStop }: Props) {
  const isWorking = !['idle', 'stopped', 'error'].includes(agentStatus)
  const normalizedProjectName = projectName.trim()
  const showProjectCrumb = Boolean(normalizedProjectName) && normalizedProjectName.toLowerCase() !== 'nebula'
  return (
    <header className="nebula-topbar codex-topbar flex shrink-0 items-center justify-between">
      <div className="codex-menu-cluster flex min-w-0 items-center">
        <button type="button" className="codex-window-button codex-sidebar-toggle" aria-label="Toggle sidebar" onClick={onToggleSidebar}>
          <PanelLeft size={14} />
        </button>
        {showProjectCrumb && <span className="codex-project-crumb hidden md:inline">{normalizedProjectName}</span>}
      </div>
      <div className="codex-status-cluster flex min-w-0 items-center gap-2 text-xs">
        <span className="codex-runtime-summary hidden lg:inline" title={`${model}; ${memoryReady ? 'memory ready' : 'memory unavailable'}`}>
          {agentStatus.replaceAll('_', ' ')}
        </span>
        <button type="button" className="codex-window-button codex-command-button" onClick={onOpenCommandCenter} aria-label="Open Command Center" title={`Command Center (Ctrl+K)${notificationCount ? ` - ${notificationCount} unread` : ''}`}>
          <Command size={14} />
        </button>
        <button type="button" className={`codex-window-button ${inspectorOpen ? 'codex-window-button-active' : ''}`} onClick={onToggleInspector} aria-label="Toggle context rail" title="Toggle live context">
          <PanelRight size={14} />
        </button>
        <span className={`codex-service-pill codex-service-${serviceState.phase}`} title={`${serviceState.detail} ${actionMode} actions - Agent ${agentStatus}`}>
          <Circle size={12} />
          <span className={`codex-service-dot ${serviceState.phase === 'online' ? 'codex-service-online' : 'codex-service-offline'}`} />
          {serviceState.label}
        </span>
        {isWorking && <button type="button" className="codex-stop-button" onClick={onStop} title={`Stop agent (${agentStatus})`} aria-label="Stop agent">
          <Square size={12} />
        </button>}
      </div>
    </header>
  )
}
