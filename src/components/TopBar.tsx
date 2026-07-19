import { Circle, Command, PanelLeft, PanelRight, Square, SquareTerminal } from 'lucide-react'
import type { AgentStatus } from '../types/agent'
import type { NebulaServiceState } from '../types/nebula'
import type { ActionMode } from '../types/settings'
import type { ExperienceMode } from '../types/settings'
import { publicRunStageForStatus, publicRunStageLabel } from '../lib/publicRunStage'
import { ExecutionModeControl } from './ExecutionModeControl'

interface Props {
  projectName: string
  model: string
  memoryReady: boolean
  agentStatus: AgentStatus
  actionMode: ActionMode
  notificationCount: number
  serviceState: NebulaServiceState
  experienceMode: ExperienceMode
  onToggleSidebar: () => void
  onOpenCommandCenter: () => void
  onToggleInspector: () => void
  inspectorOpen: boolean
  terminalOpen: boolean
  onToggleTerminal: () => void
  onActionModeChange: (mode: 'approval' | 'safe') => void
  onStop: () => void
}

export function TopBar({ projectName, model, memoryReady, agentStatus, actionMode, notificationCount, serviceState, experienceMode, onToggleSidebar, onOpenCommandCenter, onToggleInspector, inspectorOpen, terminalOpen, onToggleTerminal, onActionModeChange, onStop }: Props) {
  const isWorking = !['idle', 'stopped', 'error'].includes(agentStatus)
  const advancedMode = experienceMode === 'advanced'
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
        <span className="codex-runtime-summary hidden lg:inline" title={advancedMode ? `${model}; ${memoryReady ? 'memory ready' : 'memory unavailable'}` : undefined}>
          {advancedMode ? agentStatus.replaceAll('_', ' ') : publicRunStageLabel(publicRunStageForStatus(agentStatus))}
        </span>
        <ExecutionModeControl compact storedMode={actionMode} onStoredModeChange={onActionModeChange} />
        <button type="button" className={`codex-window-button ${terminalOpen ? 'codex-window-button-active' : ''}`} onClick={onToggleTerminal} aria-label="Toggle terminal dock" title="Terminal dock">
          <SquareTerminal size={14} />
        </button>
        {advancedMode && <button type="button" className="codex-window-button codex-command-button" onClick={onOpenCommandCenter} aria-label="Open Command Center" title={`Command Center (Ctrl+K)${notificationCount ? ` - ${notificationCount} unread` : ''}`}>
          <Command size={14} />
        </button>}
        {advancedMode && <button type="button" className={`codex-window-button ${inspectorOpen ? 'codex-window-button-active' : ''}`} onClick={onToggleInspector} aria-label="Toggle context rail" title="Toggle live context">
          <PanelRight size={14} />
        </button>}
        {(advancedMode || serviceState.phase !== 'online') && <span className={`codex-service-pill codex-service-${serviceState.phase}`} title={advancedMode ? `${serviceState.detail} ${actionMode} actions - Agent ${agentStatus}` : serviceState.detail}>
          <Circle size={12} />
          <span className={`codex-service-dot ${serviceState.phase === 'online' ? 'codex-service-online' : 'codex-service-offline'}`} />
          {serviceState.label}
        </span>}
        {isWorking && <button type="button" className="codex-stop-button" onClick={onStop} title={`Stop agent (${agentStatus})`} aria-label="Stop agent">
          <Square size={12} />
        </button>}
      </div>
    </header>
  )
}
