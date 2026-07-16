import { Activity, Command, FileCode2, Folder, GitBranch, HardDrive, MemoryStick, Radio, Sparkles } from 'lucide-react'
import type { AgentStatus } from '../types/agent'
import type { NebulaServiceState, WorkspaceAwarenessSnapshot } from '../types/nebula'

interface Props {
  agentStatus: AgentStatus
  serviceState: NebulaServiceState
  memoryReady: boolean
  model: string
  contextUsage: number
  workspace?: WorkspaceAwarenessSnapshot | null
  onOpenCommandCenter: () => void
}

function basename(path?: string) {
  return path?.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
}

export function WorkspaceRail({ agentStatus, serviceState, memoryReady, model, contextUsage, workspace, onOpenCommandCenter }: Props) {
  const recentFiles = workspace?.recentFiles.slice(0, 4) ?? []

  return (
    <aside className="workspace-rail" aria-label="Workspace context">
      <div className="workspace-rail-heading">
        <div>
          <span>Live context</span>
          <strong>{workspace?.projectName || 'No active project'}</strong>
        </div>
        <span className={`workspace-rail-signal workspace-rail-signal-${serviceState.phase}`} title={serviceState.detail} />
      </div>

      <section className="workspace-rail-section">
        <h2>Runtime</h2>
        <dl className="workspace-runtime-list">
          <div><dt><Radio size={13} />Service</dt><dd>{serviceState.label}</dd></div>
          <div><dt><Activity size={13} />Agent</dt><dd>{agentStatus.replaceAll('_', ' ')}</dd></div>
          <div><dt><MemoryStick size={13} />Memory</dt><dd>{memoryReady ? 'Ready' : 'Unavailable'}</dd></div>
        </dl>
        <div className="workspace-context-gauge">
          <div><span>Context</span><strong>{Math.round(contextUsage)}%</strong></div>
          <div className="workspace-context-track"><span style={{ width: `${Math.max(1, Math.min(100, contextUsage))}%` }} /></div>
        </div>
      </section>

      <section className="workspace-rail-section">
        <h2>Workspace</h2>
        <div className="workspace-context-primary">
          <Folder size={14} />
          <div><strong>{workspace?.projectName || 'Choose a project'}</strong><span>{workspace?.detectedFramework || 'Project context is not loaded'}</span></div>
        </div>
        {workspace?.openedFile && <div className="workspace-context-line"><FileCode2 size={13} /><span>{basename(workspace.openedFile)}</span></div>}
        {workspace?.git?.branch && <div className="workspace-context-line"><GitBranch size={13} /><span>{workspace.git.branch}</span><small>{workspace.git.statusSummary || 'clean'}</small></div>}
      </section>

      <section className="workspace-rail-section workspace-recent-files">
        <h2>Recent files</h2>
        {recentFiles.length > 0 ? recentFiles.map((path) => (
          <div key={path} title={path}><FileCode2 size={12} /><span>{basename(path)}</span></div>
        )) : <p>No observed files yet.</p>}
      </section>

      <section className="workspace-rail-section workspace-route-section">
        <h2>Nebula route</h2>
        <div><Sparkles size={14} /><span>{model}</span></div>
        <p>Routing, memory, and tools stay unified behind one assistant.</p>
      </section>

      <button type="button" className="workspace-command-action" onClick={onOpenCommandCenter}>
        <Command size={14} />
        <span>Command Center</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div className="workspace-local-note"><HardDrive size={12} />Local workspace state</div>
    </aside>
  )
}
