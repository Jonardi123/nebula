import { AlertTriangle, CheckCircle2, FileText, GitBranch, ListTodo, TerminalSquare } from 'lucide-react'
import type { ReactNode } from 'react'
import type { WorkspaceAwarenessSnapshot } from '../types/nebula'

interface Props {
  workspace: WorkspaceAwarenessSnapshot
}

export function ProjectBriefCard({ workspace }: Props) {
  const changedFiles = [
    ...(workspace.git?.changedFiles ?? []),
    ...workspace.recentlyEditedFiles,
  ]
    .filter(Boolean)
    .filter((value, index, array) => array.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index)
    .slice(0, 5)
  const recentFiles = workspace.recentFiles.slice(0, 5)
  const commands = workspace.recentCommands.slice(0, 3)
  const issues = [...workspace.recentBuildFailures, ...workspace.recentErrors].slice(0, 3)
  const tasks = workspace.unfinishedTasks.slice(0, 3)

  return (
    <section className="project-brief-card mb-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="dashboard-kicker">Project Brief</div>
          <h2 className="mt-1 text-lg font-semibold text-slate-50">{workspace.projectName}</h2>
          <p className="mt-1 truncate text-xs text-slate-500">{workspace.projectFolder}</p>
        </div>
        <span className={`workspace-mini-pill ${workspace.git?.available ? '' : 'border-amber-300/25 bg-amber-300/10 text-amber-100'}`}>
          <GitBranch size={11} />
          {workspace.git?.available ? `${workspace.git.branch ?? 'git'} - ${workspace.git.statusSummary ?? 'unknown'}` : 'git unavailable'}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <BriefSection icon={<FileText size={14} />} title="Recent Files" empty="No recent files observed.">
          {(changedFiles.length ? changedFiles : recentFiles).map((file) => (
            <BriefLine key={file} text={file} tone={changedFiles.includes(file) ? 'changed' : undefined} />
          ))}
        </BriefSection>

        <BriefSection icon={<TerminalSquare size={14} />} title="Recent Commands" empty="No commands observed yet.">
          {commands.map((command) => (
            <BriefLine key={command} text={command} monospace />
          ))}
        </BriefSection>

        <BriefSection icon={<ListTodo size={14} />} title="Unfinished Work" empty={workspace.lastActiveTask ? `Last task: ${workspace.lastActiveTask.goal}` : 'No unfinished tasks observed.'}>
          {tasks.map((task) => (
            <BriefLine key={task.id} text={`${task.goal} (${task.status})`} />
          ))}
        </BriefSection>

        <BriefSection icon={issues.length ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />} title="Recent Issues" empty="No recent errors or build failures observed.">
          {issues.map((issue) => (
            <BriefLine key={`${issue.time}:${issue.title}`} text={issue.detail ? `${issue.title}: ${issue.detail}` : issue.title} tone="issue" />
          ))}
        </BriefSection>
      </div>
    </section>
  )
}

function BriefSection({
  icon,
  title,
  empty,
  children,
}: {
  icon: ReactNode
  title: string
  empty: string
  children: ReactNode[]
}) {
  const hasChildren = children.length > 0
  return (
    <div className="brief-section">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-violet-200/80">
        {icon}
        {title}
      </div>
      <div className="space-y-1.5">
        {hasChildren ? children : <div className="text-xs leading-5 text-slate-500">{empty}</div>}
      </div>
    </div>
  )
}

function BriefLine({ text, monospace, tone }: { text: string; monospace?: boolean; tone?: 'changed' | 'issue' }) {
  const color = tone === 'issue' ? 'text-amber-100' : tone === 'changed' ? 'text-cyan-100' : 'text-slate-300'
  return (
    <div className={`min-w-0 truncate rounded-md border border-white/10 bg-white/[0.025] px-2 py-1.5 text-xs ${color} ${monospace ? 'terminal-font' : ''}`}>
      {text}
    </div>
  )
}
