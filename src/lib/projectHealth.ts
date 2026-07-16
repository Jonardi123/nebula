import type { ProjectHealthReport, WorkspaceAwarenessSnapshot } from '../types/nebula'
import { readLocalJson, writeLocalJson } from './safeStorage'

const PROJECT_HEALTH_KEY = 'nebula-project-health-v1'
const PROJECT_HEALTH_EVENT = 'nebula-project-health-changed'

function readReports() {
  return readLocalJson<ProjectHealthReport[]>(PROJECT_HEALTH_KEY, [], (value) => Array.isArray(value) ? value.filter((item): item is ProjectHealthReport => Boolean(item && typeof item === 'object' && typeof item.projectFolder === 'string')) : [])
}

export function getProjectHealthReports() {
  return readReports()
}

export function getProjectHealthReport(projectFolder: string) {
  return readReports().find((report) => report.projectFolder.toLowerCase() === projectFolder.toLowerCase()) ?? null
}

export function buildProjectHealthReport(snapshot: WorkspaceAwarenessSnapshot): ProjectHealthReport {
  const timestamp = new Date().toISOString()
  const previous = getProjectHealthReport(snapshot.projectFolder)
  const hasBuildFailure = snapshot.recentBuildFailures.length > 0
  const hasErrors = snapshot.recentErrors.length > 0
  const gitUnavailable = snapshot.git && !snapshot.git.available
  const checks: ProjectHealthReport['checks'] = [
    { id: 'metadata', label: 'Project metadata', status: snapshot.metadataFiles.length ? 'success' : 'warning', detail: snapshot.metadataFiles.length ? `${snapshot.metadataFiles.length} metadata files observed.` : 'No project metadata was observed.' },
    { id: 'git', label: 'Git workspace', status: gitUnavailable ? 'warning' : snapshot.git?.available ? 'success' : 'unknown', detail: snapshot.git?.statusSummary || snapshot.git?.error || 'Git status has not been observed.' },
    { id: 'build', label: 'Recent build', status: hasBuildFailure ? 'error' : 'unknown', detail: hasBuildFailure ? snapshot.recentBuildFailures[0].title : 'No recent build result is available.' },
    { id: 'tasks', label: 'Task continuity', status: snapshot.unfinishedTasks.length ? 'warning' : 'success', detail: snapshot.unfinishedTasks.length ? `${snapshot.unfinishedTasks.length} unfinished task(s).` : 'No unfinished tasks observed.' },
  ]
  const status: ProjectHealthReport['status'] = hasBuildFailure ? 'failing' : hasErrors || snapshot.unfinishedTasks.length ? 'attention' : snapshot.metadataFiles.length ? 'healthy' : 'unknown'
  const report: ProjectHealthReport = {
    id: previous?.id ?? crypto.randomUUID(),
    projectFolder: snapshot.projectFolder,
    projectName: snapshot.projectName,
    status,
    framework: snapshot.detectedFramework,
    branch: snapshot.git?.branch,
    checks,
    recentErrors: [...snapshot.recentBuildFailures, ...snapshot.recentErrors].slice(0, 6).map((issue) => issue.title),
    suggestedActions: [
      ...(hasBuildFailure ? ['Open Fix My App with the latest build failure.'] : []),
      ...(snapshot.unfinishedTasks.length ? ['Resume or close unfinished tasks.'] : []),
      ...(snapshot.pendingTodos.length ? [`Review ${snapshot.pendingTodos.length} observed TODO item(s).`] : []),
      ...(!hasBuildFailure && !hasErrors ? ['Run a build or test to refresh health evidence.'] : []),
    ].slice(0, 4),
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
  writeLocalJson(PROJECT_HEALTH_KEY, [report, ...readReports().filter((item) => item.id !== report.id)].slice(0, 40), PROJECT_HEALTH_EVENT)
  return report
}
