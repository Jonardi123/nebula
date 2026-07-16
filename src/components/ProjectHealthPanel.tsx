import { Activity, AlertTriangle, CheckCircle2, CircleHelp, RefreshCw, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { buildProjectHealthReport, getProjectHealthReport } from '../lib/projectHealth'
import type { ProjectHealthReport, WorkspaceAwarenessSnapshot } from '../types/nebula'

export function ProjectHealthPanel({ workspace }: { workspace?: WorkspaceAwarenessSnapshot | null }) {
  const [report, setReport] = useState<ProjectHealthReport | null>(() => workspace ? getProjectHealthReport(workspace.projectFolder) : null)

  useEffect(() => {
    setReport(workspace ? getProjectHealthReport(workspace.projectFolder) : null)
  }, [workspace])

  if (!workspace) return <div className="premium-empty-state mx-3 mt-3"><Activity size={18} /><div><strong>Project health is waiting</strong><p>Choose a project to build an evidence-based report.</p></div></div>
  const activeWorkspace = workspace

  function refresh() {
    setReport(buildProjectHealthReport(activeWorkspace))
  }

  return (
    <section className="project-health-panel">
      <header>
        <div><strong>{workspace.projectName}</strong><span>Project health</span></div>
        <button type="button" onClick={refresh} aria-label="Refresh project health"><RefreshCw size={13} /></button>
      </header>
      {!report ? <button type="button" className="nebula-button-primary w-full px-3 py-2" onClick={refresh}>Create health report</button> : (
        <>
          <div className={`project-health-status project-health-${report.status}`}>{report.status}</div>
          <div className="space-y-1.5">
            {report.checks.map((check) => {
              const Icon = check.status === 'success' ? CheckCircle2 : check.status === 'error' ? XCircle : check.status === 'warning' ? AlertTriangle : CircleHelp
              return <div key={check.id} className="project-health-check"><Icon size={13} /><span><strong>{check.label}</strong><small>{check.detail}</small></span></div>
            })}
          </div>
          {report.suggestedActions.length > 0 && <ul>{report.suggestedActions.map((action) => <li key={action}>{action}</li>)}</ul>}
        </>
      )}
    </section>
  )
}
