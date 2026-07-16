import type { DailyBrief, NebulaServiceState, ProjectHealthReport, WorkspaceAwarenessSnapshot } from '../types/nebula'
import { readLocalJson, writeLocalJson } from './safeStorage'

const DAILY_BRIEF_KEY = 'nebula-daily-brief-v1'
const DAILY_BRIEF_EVENT = 'nebula-daily-brief-changed'

export function getDailyBrief() {
  return readLocalJson<DailyBrief | null>(DAILY_BRIEF_KEY, null)
}

export function buildDailyBrief(workspace: WorkspaceAwarenessSnapshot | null, health: ProjectHealthReport | null, service: NebulaServiceState): DailyBrief {
  const items: DailyBrief['items'] = []
  items.push({ label: 'AI service', detail: service.label, tone: service.phase === 'online' ? 'good' : service.phase === 'checking' ? 'neutral' : 'warning' })
  if (workspace) {
    items.push({ label: 'Workspace', detail: workspace.projectName, tone: 'neutral' })
    if (workspace.lastActiveTask) items.push({ label: 'Last task', detail: workspace.lastActiveTask.goal, tone: workspace.lastActiveTask.status === 'done' ? 'good' : 'warning' })
    if (workspace.recentBuildFailures[0]) items.push({ label: 'Build', detail: workspace.recentBuildFailures[0].title, tone: 'error' })
    if (workspace.unfinishedTasks.length) items.push({ label: 'Pending', detail: `${workspace.unfinishedTasks.length} unfinished task(s)`, tone: 'warning' })
  }
  if (health) items.push({ label: 'Project health', detail: health.status, tone: health.status === 'healthy' ? 'good' : health.status === 'failing' ? 'error' : 'warning' })
  const brief: DailyBrief = {
    id: crypto.randomUUID(),
    projectFolder: workspace?.projectFolder,
    title: workspace ? `Welcome back to ${workspace.projectName}` : 'Nebula is ready when you are',
    summary: workspace?.welcomeLines.slice(0, 2).join(' ') || 'Choose a project or start a conversation.',
    items: items.slice(0, 6),
    createdAt: new Date().toISOString(),
  }
  writeLocalJson(DAILY_BRIEF_KEY, brief, DAILY_BRIEF_EVENT)
  return brief
}
