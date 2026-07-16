import type { MemoryFile } from './memory'
import type { RiskLevel, ToolName } from './tools'

export interface ModelInfo {
  id: string
  displayName: string
  loaded: boolean
  instanceId?: string
  publisher?: string
  architecture?: string
  quantization?: string
  sizeBytes?: number
  params?: string
  maxContextLength?: number
  capabilities: string[]
}

export type NebulaServicePhase = 'checking' | 'online' | 'offline' | 'degraded' | 'error'

export interface NebulaServiceState {
  provider: 'lmstudio' | '9router' | 'openrouter'
  phase: NebulaServicePhase
  label: string
  detail?: string
  checkedAt: string
}

export type ModelRuntimePhase = 'unloaded' | 'checking' | 'loading' | 'warm' | 'ready' | 'thinking' | 'reviewing' | 'error'

export interface ModelRuntimeState {
  role: 'daily' | 'code' | 'review'
  model: string
  phase: ModelRuntimePhase
  loaded: boolean
  remote: boolean
  lastLoadMs?: number
  lastFirstTokenMs?: number
  lastResponseMs?: number
  lastError?: string
  updatedAt: string
}

export type ComposerAttachmentKind = 'file' | 'folder' | 'screen' | 'context'

export interface ComposerAttachment {
  id: string
  kind: ComposerAttachmentKind
  label: string
  path?: string
  detail?: string
}

export interface ModelBenchmarkResult {
  id: string
  model: string
  test: 'hello' | 'tool_json' | 'code' | 'review'
  ok: boolean
  latencyMs: number
  output: string
  error?: string
  createdAt: string
}

export interface ModelRunStat {
  model: string
  role?: 'daily' | 'code' | 'review'
  lastResponseMs?: number
  lastFirstTokenMs?: number
  lastLoadMs?: number
  lastUnloadMs?: number
  roughTokensPerSecond?: number
  lastError?: string
  lastFallback?: string
  loadedModelCount?: number
  supportsMultipleLoadedModels?: boolean
  approxJsHeapMb?: number
  updatedAt: string
}

export interface TaskStep {
  id: string
  label: string
  status: 'pending' | 'active' | 'done' | 'error'
  detail?: string
}

export interface ProjectProfile {
  id: string
  folder: string
  name: string
  detectedFramework: string
  packageManager: string
  commonScripts: string[]
  preferredModels: {
    daily?: string
    code?: string
    review?: string
  }
  ignoredFolders: string[]
  summary: string
  notes: string
  metadataFiles: string[]
  updatedAt: string
  createdAt: string
}

export interface TaskTimelineEvent {
  id: string
  type:
    | 'user_prompt'
    | 'model_route'
    | 'tool_call'
    | 'tool_result'
    | 'file_read'
    | 'file_write'
    | 'command'
    | 'web_source'
    | 'error'
    | 'notification'
    | 'final'
  label: string
  detail?: string
  timestamp: string
  data?: unknown
}

export interface SourceCard {
  id: string
  title: string
  url: string
  snippet: string
  summary?: string
  dateChecked: string
  trustHints: string[]
  taskId?: string
  savedToMemory?: boolean
  createdAt: string
}

export interface PatchProposal {
  id: string
  path: string
  operation: 'write' | 'create' | 'append'
  sourceTool: ToolName
  status: 'pending' | 'applied' | 'rejected' | 'error'
  riskLevel: RiskLevel
  reason: string
  oldContent: string
  newContent: string
  createdAt: string
  updatedAt: string
  appliedAt?: string
  error?: string
}

export interface TaskRun {
  id: string
  goal: string
  status: 'running' | 'done' | 'error' | 'stopped'
  steps: TaskStep[]
  files: string[]
  commands: string[]
  toolCalls: string[]
  timeline: TaskTimelineEvent[]
  sourceCardIds: string[]
  finalResult?: string
  createdAt: string
  updatedAt: string
}

export interface MemoryProposal {
  id: string
  file: MemoryFile
  content: string
  reason: string
  sourceId?: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
}

export interface LauncherItem {
  id: string
  label: string
  description: string
  kind: 'app' | 'project' | 'file' | 'action' | 'conversation'
  value: string
}

export interface ModelRouteRecommendation {
  id: string
  role: 'daily' | 'code' | 'review'
  currentModel: string
  recommendedModel: string
  confidence: number
  reasons: string[]
  createdAt: string
}

export interface RegisteredNebulaModel {
  id: string
  role: 'daily' | 'code' | 'review'
  label: string
  purpose: string
  preferredFor: string[]
  fallbackModels: string[]
  keepWarm: boolean
  idleUnloadMs: number
}

export interface NebulaRouteDecision {
  id: string
  mode: 'fast' | 'code' | 'review'
  requestedModel: string
  role: 'daily' | 'code' | 'review'
  reason: string
  reviewAfter: boolean
  secondOpinion: boolean
  mergeStrategy: 'primary_only' | 'append_review' | 'compare_then_merge'
  confidence: number
  debugLabel: string
  selectedSkills: Array<{
    id: string
    name: string
    confidence: number
    reason: string
  }>
  createdAt: string
}

export interface NebulaContextSection {
  id: string
  title: string
  priority: number
  source: 'memory' | 'project' | 'file' | 'conversation' | 'task' | 'log' | 'system'
  content: string
}

export interface NebulaContextBundle {
  id: string
  prompt: string
  sections: NebulaContextSection[]
  totalChars: number
  budgetChars: number
  summary: {
    memoryHits: number
    projectFiles: string[]
    openedFile?: string
    recentTasks: number
    recentMessages: number
  }
  createdAt: string
}

export interface ContextInspectorSection {
  id: string
  title: string
  source: NebulaContextSection['source']
  priority: number
  chars: number
  content: string
}

export interface ContextInspectorSnapshot {
  id: string
  model?: string
  route?: string
  totalChars: number
  budgetChars: number
  sections: ContextInspectorSection[]
  createdAt: string
}

export interface NebulaDiagnosticEvent {
  id: string
  type: 'route' | 'model_lifecycle' | 'context' | 'metric' | 'review' | 'workspace'
  label: string
  detail?: string
  model?: string
  role?: 'daily' | 'code' | 'review'
  data?: unknown
  createdAt: string
}

export interface ResourceSnapshot {
  checkedAt: string
  cpuLoadPercent?: number
  ramTotalMb?: number
  ramAvailableMb?: number
  processWorkingSetMb?: number
  systemDrive?: string
  systemDriveTotalMb?: number
  systemDriveFreeMb?: number
  gpuName?: string
  vramTotalMb?: number
  vramNote?: string
  jsHeapMb?: number
  error?: string
}

export interface NebulaNotification {
  id: string
  type: 'task_done' | 'build_failed' | 'model_loaded' | 'needs_input' | 'memory_proposal' | 'info' | 'error'
  title: string
  message: string
  read: boolean
  createdAt: string
  data?: unknown
}

export type TimelineFilter = 'all' | 'chat' | 'code' | 'review' | 'skills' | 'errors' | 'system'

export type TimelineStatus = 'success' | 'warning' | 'error' | 'running'

export interface TimelineDetail {
  label: string
  value: string
}

export interface TimelineItem {
  id: string
  time: string
  filter: Exclude<TimelineFilter, 'all'>
  type: string
  title: string
  status: TimelineStatus
  source: 'chat' | 'log' | 'task' | 'diagnostics' | 'skills' | 'memory' | 'sources' | 'notifications'
  relatedSkill?: string
  relatedModel?: string
  details: TimelineDetail[]
}

export interface WorkspaceGitStatus {
  available: boolean
  branch?: string
  statusSummary?: string
  changedFiles: string[]
  checkedAt: string
  error?: string
}

export interface WorkspaceTodo {
  source: string
  line?: number
  text: string
}

export interface WorkspaceTaskSummary {
  id: string
  goal: string
  status: TaskRun['status']
  updatedAt: string
}

export interface WorkspaceIssueSummary {
  time: string
  title: string
  detail?: string
}

export interface WorkspaceAwarenessSnapshot {
  id: string
  projectFolder: string
  projectName: string
  projectProfileId?: string
  detectedFramework?: string
  packageManager?: string
  packageName?: string
  packageVersion?: string
  readmeTitle?: string
  projectSummary?: string
  metadataFiles: string[]
  commonScripts: string[]
  recentFiles: string[]
  recentlyEditedFiles: string[]
  recentCommands: string[]
  openedFile?: string
  lastActiveTask?: WorkspaceTaskSummary
  unfinishedTasks: WorkspaceTaskSummary[]
  pendingTodos: WorkspaceTodo[]
  recentErrors: WorkspaceIssueSummary[]
  recentBuildFailures: WorkspaceIssueSummary[]
  git?: WorkspaceGitStatus
  welcomeLines: string[]
  createdAt: string
  updatedAt: string
}

export interface SkillDraft {
  id: string
  name: string
  description: string
  permissions: string[]
  exposedTools: Array<{
    name: string
    description: string
  }>
  promptAdditions: string[]
  examples: string[]
  riskLevel: 'safe' | 'needs_approval' | 'high_risk' | 'blocked'
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type QuickActionRisk = 'safe' | 'needs_confirmation'

export type QuickActionScope = 'workspace' | 'file' | 'models' | 'session'

export interface QuickAction {
  id: string
  label: string
  description: string
  prompt: string
  scope: QuickActionScope
  risk: QuickActionRisk
  preferredSkills: string[]
  requiresFile?: boolean
  taskMode?: boolean
}

export interface QuickActionRun {
  id: string
  actionId: string
  label: string
  source: string
  target?: string
  status: 'queued' | 'running' | 'done' | 'error'
  createdAt: string
  updatedAt: string
  taskId?: string
  error?: string
}

export interface AgentActivityState {
  id: string
  name: string
  state: 'idle' | 'thinking' | 'running' | 'waiting' | 'reviewing' | 'error'
  currentTask?: string
  startedAt?: string
  durationMs?: number
  selectedModel?: string
  activeSkill?: string
  estimatedCompletion?: string
  note?: string
}

export interface FileSummary {
  path: string
  summary: string
  generatedAt: string
  source: 'metadata' | 'background'
}

export interface FileInsight {
  path: string
  name: string
  extension: string
  gitStatus?: string
  recentlyEdited: boolean
  referenceCount: number
  importanceScore: number
  favorite: boolean
  pinned: boolean
  summary?: FileSummary
}

export interface PredictiveSuggestion {
  id: string
  label: string
  reason: string
  confidence: number
  actionId: string
  target?: string
}

export interface InsightMetric {
  id: string
  label: string
  value: string
  detail?: string
  tone?: 'neutral' | 'good' | 'warn' | 'danger'
}

export interface TrainingLogEntry {
  id: string
  source: 'chat' | 'task' | 'quick_action' | 'voice' | 'system'
  prompt: string
  response: string
  model: string
  routeLabel?: string
  projectFolder?: string
  openedFile?: string
  toolCalls: string[]
  toolResults: string[]
  errors: string[]
  accepted: boolean
  tags: string[]
  durationMs: number
  createdAt: string
}

export interface ConversationSession {
  id: string
  title: string
  messages: import('./agent').ChatMessage[]
  projectFolder?: string
  folderId?: string
  pinned: boolean
  createdAt: string
  updatedAt: string
}

export interface ConversationStore {
  version: number
  activeId: string
  sessions: ConversationSession[]
  folders: ConversationFolder[]
}

export interface ConversationFolder {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface ConversationSearchResult {
  conversationId: string
  title: string
  folderId?: string
  projectFolder?: string
  excerpt: string
  messageId?: string
  score: number
  updatedAt: string
}

export interface ProjectHealthReport {
  id: string
  projectFolder: string
  projectName: string
  status: 'healthy' | 'attention' | 'failing' | 'unknown'
  framework?: string
  branch?: string
  checks: Array<{
    id: string
    label: string
    status: 'success' | 'warning' | 'error' | 'unknown'
    detail: string
  }>
  recentErrors: string[]
  suggestedActions: string[]
  createdAt: string
  updatedAt: string
}

export interface ContextPin {
  id: string
  label: string
  source: 'file' | 'memory' | 'project' | 'note'
  content: string
  path?: string
  projectFolder?: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface MemoryQualityScore {
  id: string
  file: MemoryFile
  line: number
  content: string
  score: number
  status: 'healthy' | 'stale' | 'needs_source' | 'duplicate' | 'temporary'
  reasons: string[]
  checkedAt: string
}

export interface VoiceDiagnosticSnapshot {
  supported: boolean
  permission: 'unknown' | 'granted' | 'denied' | 'prompt' | 'unsupported'
  language: string
  lastTranscriptAt?: string
  lastError?: string
  checkedAt: string
}

export interface DailyBrief {
  id: string
  projectFolder?: string
  title: string
  summary: string
  items: Array<{ label: string; detail: string; tone: 'neutral' | 'good' | 'warning' | 'error' }>
  createdAt: string
}

export type QueuedTaskKind = 'task' | 'fix' | 'quick_action'
export type QueuedTaskStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface QueuedTask {
  id: string
  kind: QueuedTaskKind
  goal: string
  label: string
  status: QueuedTaskStatus
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  taskId?: string
  attempts: number
  error?: string
}

export interface ProjectSearchResult {
  path: string
  line: number
  text: string
  matchCount?: number
}

export interface TrainingDatasetAudit {
  total: number
  accepted: number
  rejected: number
  redacted: number
  invalid: number
  duplicate: number
  train: number
  validation: number
  qualityRejected: number
  sensitive: number
  identityLeaks: number
  malformedTools: number
  unsafeTools: number
  routeMismatch: number
}

export interface TrainingDatasetBundle {
  trainJsonl: string
  validationJsonl: string
  audit: TrainingDatasetAudit
}

export interface ModelDoctorCheck {
  id: string
  title: string
  status: 'success' | 'warning' | 'error'
  detail: string
  fix?: string
}

export interface CommandCenterEvent {
  id: string
  title: string
  detail: string
  type: 'agent' | 'automation' | 'memory' | 'file' | 'model' | 'system' | 'error'
  status: 'success' | 'warning' | 'error' | 'running' | 'queued'
  source?: string
  createdAt: string
}

export type NebulaRoutineRiskLevel = 'safe' | 'needs_confirmation' | 'high_risk' | 'blocked'

export type NebulaRoutineTriggerType =
  | 'manual'
  | 'app_startup'
  | 'scheduled_time'
  | 'interval'
  | 'lmstudio_online'
  | 'lmstudio_offline'
  | 'project_opened'

export interface NebulaRoutineTrigger {
  type: NebulaRoutineTriggerType
  timeOfDay?: string
  intervalMinutes?: number
}

export type NebulaRoutineStepType =
  | 'refresh_diagnostics'
  | 'search_memory'
  | 'summarize_project'
  | 'open_known_app'
  | 'web_search'
  | 'web_fetch'
  | 'run_safe_command'
  | 'send_notification'
  | 'ask_user'
  | 'placeholder'

export interface NebulaRoutineStep {
  id: string
  label: string
  type: NebulaRoutineStepType
  input?: string
  riskLevel: NebulaRoutineRiskLevel
  enabled: boolean
  disabled?: boolean
  note?: string
}

export interface NebulaRoutine {
  id: string
  name: string
  description: string
  trigger: NebulaRoutineTrigger
  steps: NebulaRoutineStep[]
  riskLevel: NebulaRoutineRiskLevel
  enabled: boolean
  createdAt: string
  updatedAt: string
  runHistory: string[]
  lastRunAt?: string
  lastRunStatus?: NebulaRoutineRunStatus
}

export type NebulaRoutineRunStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface NebulaRoutineStepResult {
  id: string
  stepId: string
  label: string
  type: NebulaRoutineStepType
  status: 'pending' | 'running' | 'success' | 'warning' | 'error' | 'skipped' | 'cancelled'
  output?: string
  error?: string
  startedAt?: string
  completedAt?: string
}

export interface NebulaRoutineRun {
  id: string
  routineId: string
  routineName: string
  triggerType: NebulaRoutineTriggerType
  status: NebulaRoutineRunStatus
  stepResults: NebulaRoutineStepResult[]
  summary: string
  createdAt: string
  startedAt?: string
  completedAt?: string
  error?: string
}

export type AutomationRoutineStep = NebulaRoutineStep
export type AutomationRoutine = NebulaRoutine
export type AutomationRunRecord = NebulaRoutineRun

export interface SetupWizardState {
  step: 'welcome' | 'lmstudio' | 'models' | 'workspace' | 'permissions' | 'finish'
  checkedLmStudio: boolean
  lmStudioOnline: boolean
  selectedProjectFolder: string
  selectedMemoryFolder: string
  dailyModel: string
  codeModel: string
  reviewModel: string
}

export interface RoutineTemplate {
  id: string
  name: string
  description: string
  category: 'system' | 'project' | 'models' | 'daily' | 'desktop'
  trigger: NebulaRoutineTrigger
  steps: NebulaRoutineStep[]
  riskLevel: NebulaRoutineRiskLevel
}

export interface PermissionCapability {
  id: string
  label: string
  description: string
  category: 'core' | 'workspace' | 'automation' | 'voice' | 'web' | 'desktop'
  riskLevel: NebulaRoutineRiskLevel
  enabled: boolean
  settingKeys: string[]
  usedBy: string[]
  locked?: boolean
  lockedReason?: string
}

export interface ModelSpeedProfileResult {
  id: string
  role: 'daily' | 'code' | 'review'
  model: string
  ok: boolean
  totalMs: number
  firstTokenMs?: number
  roughTokensPerSecond?: number
  outputPreview: string
  error?: string
  createdAt: string
}

export interface RoutineResultCardModel {
  id: string
  routineName: string
  status: NebulaRoutineRunStatus
  durationMs?: number
  summary: string
  completedSteps: number
  failedSteps: number
  warningSteps: number
  totalSteps: number
  createdAt: string
  nextAction: 'none' | 'retry' | 'inspect'
}

export interface MemoryCoreCategory {
  id: 'preferences' | 'projects' | 'people' | 'commands' | 'mistakes' | 'facts'
  label: string
  description: string
  file: MemoryFile
  examples: string[]
}

export interface MemoryIndexEntry {
  id: string
  categoryId: MemoryCoreCategory['id']
  file: MemoryFile
  line: number
  text: string
  keywords: string[]
  updatedAt: string
}

export interface MemorySearchRankedResult extends MemoryIndexEntry {
  score: number
  reason: string
}
