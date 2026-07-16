import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { AmbientAssistant } from './components/AmbientAssistant'
import { ApprovalModal } from './components/ApprovalModal'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ChatPanel } from './components/ChatPanel'
import { Sidebar, type SidebarTab } from './components/Sidebar'
import { SetupWizard } from './components/SetupWizard'
import { SplashScreen } from './components/SplashScreen'
import { TopBar } from './components/TopBar'
import { WorkspaceRail } from './components/WorkspaceRail'
import { CommandCenter } from './components/CommandCenter'
import { useSettings } from './hooks/useSettings'
import { createMessage, useMessages } from './hooks/useMessages'
import { useLogs } from './hooks/useLogs'
import { useAgentStatus } from './hooks/useAgentStatus'
import { useProjectFiles } from './hooks/useProjectFiles'
import { runAgentLoop } from './lib/agent'
import { runStartupRoutines, runTriggeredRoutines, startAutomationScheduler } from './lib/automationScheduler'
import { openAmbientOverlay, registerAmbientShortcut, registerBackgroundClose, setLaunchAtStartup } from './lib/background'
import { cancelActiveLmStudioRequests, checkLmStudio, listLmStudioModelInfos } from './lib/lmstudio'
import { createLog } from './lib/logger'
import { ensureMemory } from './lib/memory'
import { warmModelInBackground, type ModelManagerEvent } from './lib/modelManager'
import { warmPredictedModelInBackground } from './lib/modelOrchestrator'
import { modelLabel } from './lib/modelRouter'
import { getUnreadNotificationCount, notify } from './lib/notifications'
import { recordModelLifecycle } from './lib/orchestratorDiagnostics'
import { isTauriRuntime } from './lib/runtime'
import { detectProjectProfile } from './lib/projectProfiles'
import { appendTaskEvent, attachTaskSourceCard, recordTaskArtifact } from './lib/runReplay'
import { captureScreen, type ScreenCaptureResult } from './lib/screen'
import { loadSettings } from './lib/settings'
import { stopRunningCommand } from './lib/commandRunner'
import { proposeMemory } from './lib/memoryInbox'
import { recordModelRun, recordModelLoadMetric } from './lib/modelStats'
import { createSourceCardFromFetch, createSourceCardsFromSearch } from './lib/sourceCards'
import { createTaskRun, recoverInterruptedTaskRuns, updateTaskRun } from './lib/tasks'
import { getQueuedTasks, markInterruptedTasksRecoverable, updateQueuedTask } from './lib/taskQueue'
import { clearTemporaryContext, getQuickAction, promptForQuickAction, recordQuickActionRun, updateQuickActionRun } from './lib/quickActions'
import { recordTrainingLog } from './lib/trainingLogs'
import { buildWorkspaceAwareness, recordWorkspaceAwarenessDiagnostic } from './lib/workspaceAwareness'
import { buildProjectHealthReport, getProjectHealthReport } from './lib/projectHealth'
import { buildDailyBrief } from './lib/dailyBrief'
import { deriveServiceState } from './lib/serviceState'
import { listFiles, readFile, type FileNode } from './lib/fileSystem'
import type { ComposerAttachment, WorkspaceAwarenessSnapshot } from './types/nebula'
import type { ApprovalRequest, ToolResult } from './types/tools'
import type { WebFetchResult, WebSearchResult } from './lib/web'
import { getEnabledToolNames } from './skills'
import type { AppSettings } from './types/settings'
import { AgentRunController } from './lib/agentRun'
import { normalizeNebulaError } from './lib/nebulaError'
import { conversationRepository, initializeStorage } from './lib/storage'
import {
  createMobileRunSink,
  applyMobileControlChange,
  mobileControlSnapshot,
  mobileIntentDirective,
  sanitizeMobileSource,
  updateMobileRuntimeStatus,
  type RemoteApprovalDecision,
  type RemoteRunCancel,
  type RemoteRunRequest,
  type RemoteMobileSettingsChange,
} from './lib/mobileBridge'

function settingsForMobileRun(settings: AppSettings, request?: RemoteRunRequest): AppSettings {
  if (!request) return settings
  const enableContext = request.includeProjectContext || request.intentMode === 'project_search' || request.intentMode === 'personal_intelligence'
  const enableWeb = request.intentMode === 'web_search' || request.intentMode === 'deep_research'
  const reviewModel = settings.singleModelEnabled ? settings.singleModel : settings.modelAssignments.review
  return {
    ...settings,
    autoWebSearch: enableWeb ? true : settings.autoWebSearch,
    contextInjectionEnabled: enableContext ? true : settings.contextInjectionEnabled,
    modelMode: request.intentMode === 'deep_thinking' && reviewModel ? 'review' : settings.modelMode,
    enableAutomaticReviewPass: request.intentMode === 'deep_thinking' && reviewModel
      ? true
      : settings.enableAutomaticReviewPass,
  }
}

function summarizeToolResult(result: ToolResult) {
  if (!result.ok) return result.error ?? 'Tool failed.'
  const output = typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2)
  return output.slice(0, 1600)
}

function providerLabel(settings: ReturnType<typeof loadSettings>) {
  if (settings.modelProvider === '9router') return '9Router'
  if (settings.modelProvider === 'openrouter') return 'OpenRouter'
  return 'LM Studio'
}

function flattenAttachmentTree(nodes: FileNode[], depth = 0): string[] {
  if (depth > 4) return []
  return nodes.flatMap((node) => [
    `${'  '.repeat(depth)}${node.isDir ? '[folder]' : '[file]'} ${node.path}`,
    ...(node.children ? flattenAttachmentTree(node.children, depth + 1) : []),
  ])
}

async function buildComposerAttachmentContext(attachments: ComposerAttachment[]) {
  if (attachments.length === 0) return ''
  const sections: string[] = []
  let remainingChars = 12000

  for (const attachment of attachments.slice(0, 8)) {
    const path = attachment.path?.trim()
    const header = `${attachment.kind}: ${path || attachment.label}${attachment.detail ? ` (${attachment.detail})` : ''}`
    if (!path || remainingChars <= 240) {
      sections.push(`- ${header}`)
      continue
    }

    try {
      if (attachment.kind === 'file') {
        const content = await readFile(path)
        const excerpt = content.slice(0, Math.min(4000, remainingChars))
        sections.push(`## Attached file\nPath: ${path}\n${excerpt}${content.length > excerpt.length ? '\n...[trimmed]' : ''}`)
        remainingChars -= excerpt.length
      } else if (attachment.kind === 'folder') {
        const tree = flattenAttachmentTree(await listFiles(path)).slice(0, 140).join('\n')
        const excerpt = tree.slice(0, Math.min(5000, remainingChars))
        sections.push(`## Attached folder\nPath: ${path}\n${excerpt || 'No readable files were found.'}${tree.length > excerpt.length ? '\n...[trimmed]' : ''}`)
        remainingChars -= excerpt.length
      } else {
        sections.push(`- ${header}`)
      }
    } catch (error) {
      sections.push(`- ${header}\n  Could not load attachment: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return `\n\n[ATTACHED LOCAL CONTEXT]\n${sections.join('\n\n')}`
}

export default function App() {
  const { settings, setSettings } = useSettings()
  const {
    messages,
    setMessages,
    setConversationMessages,
    conversations,
    conversationFolders,
    activeConversationId,
    newConversation,
    ensureConversation,
    selectConversation,
    toggleConversationPinned,
    deleteConversation,
    createConversationFolder,
    deleteConversationFolder,
    moveConversationToFolder,
  } = useMessages(settings.projectFolder)
  const [showSplash, setShowSplash] = useState(() => loadSettings().startupAnimation !== 'off')
  const { logs, addLog } = useLogs()
  const [lmOnline, setLmOnline] = useState(false)
  const [lmHealthDetail, setLmHealthDetail] = useState('')
  const [mobileModels, setMobileModels] = useState<Awaited<ReturnType<typeof listLmStudioModelInfos>>>([])
  const [memoryReady, setMemoryReady] = useState(false)
  const { agentStatus, setAgentStatus } = useAgentStatus()
  const [approval, setApproval] = useState<ApprovalRequest | null>(null)
  const [skillsVersion, setSkillsVersion] = useState(0)
  const [ambientActive, setAmbientActive] = useState(false)
  const [latestCapture, setLatestCapture] = useState<ScreenCaptureResult | null>(null)
  const [captureError, setCaptureError] = useState('')
  const [notificationCount, setNotificationCount] = useState(getUnreadNotificationCount)
  const [workspaceAwareness, setWorkspaceAwareness] = useState<WorkspaceAwarenessSnapshot | null>(null)
  const [commandCenterOpen, setCommandCenterOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab | null>(null)
  const [setupWizardOpen, setSetupWizardOpen] = useState(() => !import.meta.env.DEV && !loadSettings().setupWizardCompleted)
  const [recoveryNotice, setRecoveryNotice] = useState('')
  const { files, openedFile, setOpenedFile, chooseProject, openFile } = useProjectFiles({ settings, setSettings, workspaceAwareness, addLog })
  const approvalResolver = useRef<((approved: boolean) => void) | null>(null)
  const stopped = useRef(false)
  const activeRun = useRef<AgentRunController | null>(null)
  const activeMobileRun = useRef<{ request: RemoteRunRequest; sink: ReturnType<typeof createMobileRunSink> } | null>(null)
  const remoteApproval = useRef<{ runId: string; approvalId: string } | null>(null)
  const mobileRunRequestHandler = useRef<(request: RemoteRunRequest) => void>(() => undefined)
  const mobileCancelHandler = useRef<(request: RemoteRunCancel) => void>(() => undefined)
  const mobileApprovalHandler = useRef<(decision: RemoteApprovalDecision) => void>(() => undefined)
  const ambientHoldTimer = useRef<number | null>(null)
  const ambientHideTimer = useRef<number | null>(null)
  const draftWarmTimer = useRef<number | null>(null)
  const workspaceRefreshTimer = useRef<number | null>(null)
  const lastWorkspaceDiagnosticKey = useRef('')
  const ambientOpenRef = useRef(false)
  const startupWarmKey = useRef('')
  const nebulaStartupRoutinesRan = useRef(false)
  const previousLmOnline = useRef<boolean | null>(null)
  const previousHealthSignature = useRef('')
  const previousProjectFolder = useRef('')
  const queueRunInProgress = useRef(false)

  useEffect(() => {
    void initializeStorage().then((notice) => {
      if (notice?.interrupted) setRecoveryNotice('Nebula restored local state after an interrupted session. Review Tasks only if work was still running.')
    })
  }, [])

  useEffect(() => {
    const refresh = () => setNotificationCount(getUnreadNotificationCount())
    window.addEventListener('nebula-notifications-changed', refresh)
    return () => window.removeEventListener('nebula-notifications-changed', refresh)
  }, [])

  useEffect(() => {
    const recoveredQueue = markInterruptedTasksRecoverable()
    const recoveredRuns = recoverInterruptedTaskRuns()
    if (recoveredQueue.some((task) => task.error) || recoveredRuns.some((task) => task.status === 'stopped' && task.finalResult?.includes('restarted'))) {
      addLog(createLog('status', 'Recovered interrupted work safely. Review Tasks and Replay before retrying.'))
    }
  }, [])

  useEffect(() => {
    const openSetup = () => setSetupWizardOpen(true)
    window.addEventListener('nebula-open-setup-wizard', openSetup)
    return () => window.removeEventListener('nebula-open-setup-wizard', openSetup)
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    console.info('[Nebula dev diagnostics]', {
      tauriAvailable: isTauriRuntime(),
      projectFolder: settings.projectFolder,
      filesCount: files.length,
      openedFilePath: openedFile?.path ?? null,
    })
  }, [settings.projectFolder, files.length, openedFile?.path])

  const openAmbientAssistant = useCallback((source: 'hotkey' | 'global' | 'manual') => {
    if (ambientHideTimer.current) window.clearTimeout(ambientHideTimer.current)
    openAmbientOverlay()
      .then((opened) => {
        if (opened) {
          addLog(createLog('status', `Desktop ambient overlay opened by ${source}.`))
          return
        }

        setAmbientActive(true)
        addLog(createLog('status', `Ambient assistant opened by ${source}.`))
        if (settings.screenAwarenessEnabled) void runScreenCapture()
      })
      .catch((error) => {
        setAmbientActive(true)
        addLog(createLog('error', `Desktop overlay failed, using in-app aura: ${String(error)}`))
        if (settings.screenAwarenessEnabled) void runScreenCapture()
      })
  }, [settings.screenAwarenessEnabled])

  useEffect(() => {
    function onModelManager(event: Event) {
      const detail = (event as CustomEvent<ModelManagerEvent>).detail
      if (!detail) return
      recordModelLifecycle(detail)
      addLog(createLog('status', settings.showModelDebugInfo ? detail.message : 'Nebula model state updated.', settings.showModelDebugInfo ? detail : { state: detail.state, role: detail.role }))
      if (detail.background) return
      if (detail.state === 'loading') setAgentStatus('loading_model')
      if (detail.state === 'switching') setAgentStatus('switching_model')
      if (detail.state === 'ready' && agentStatus === 'loading_model') setAgentStatus('thinking')
      if (detail.state === 'error') setAgentStatus('error')
    }

    window.addEventListener('nebula-model-manager', onModelManager)
    return () => window.removeEventListener('nebula-model-manager', onModelManager)
  }, [agentStatus, settings.showModelDebugInfo])

  useEffect(() => {
    return () => {
      if (draftWarmTimer.current) window.clearTimeout(draftWarmTimer.current)
      if (workspaceRefreshTimer.current) window.clearTimeout(workspaceRefreshTimer.current)
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      setCommandCenterOpen((current) => !current)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!settings.projectFolder) {
      window.setTimeout(() => setWorkspaceAwareness(null), 0)
      return
    }

    let cancelled = false
    if (workspaceRefreshTimer.current) window.clearTimeout(workspaceRefreshTimer.current)
    workspaceRefreshTimer.current = window.setTimeout(() => {
      buildWorkspaceAwareness(
        settings,
        {
          logs: logs.slice(-100),
          openedFile,
          files,
        },
        { refreshGit: true, gitCacheMaxMs: 60000 },
      )
        .then((snapshot) => {
          if (cancelled || !snapshot) return
          setWorkspaceAwareness(snapshot)
          const diagnosticKey = [
            snapshot.projectFolder,
            snapshot.openedFile ?? '',
            snapshot.recentFiles.slice(0, 3).join('|'),
            snapshot.recentlyEditedFiles.slice(0, 3).join('|'),
            snapshot.recentCommands.slice(0, 2).join('|'),
            snapshot.unfinishedTasks.length,
            snapshot.recentErrors[0]?.title ?? '',
            snapshot.recentBuildFailures[0]?.title ?? '',
            snapshot.git?.branch ?? '',
            snapshot.git?.statusSummary ?? '',
          ].join('::')
          if (lastWorkspaceDiagnosticKey.current !== diagnosticKey) {
            lastWorkspaceDiagnosticKey.current = diagnosticKey
            recordWorkspaceAwarenessDiagnostic(snapshot, 'Workspace state refreshed from observed project activity.')
          }
        })
        .catch((error) => addLog(createLog('error', `Workspace awareness failed: ${String(error)}`)))
    }, 500)

    return () => {
      cancelled = true
      if (workspaceRefreshTimer.current) window.clearTimeout(workspaceRefreshTimer.current)
    }
  }, [settings.projectFolder, settings.activeProjectProfileId, openedFile?.path, openedFile?.content, files, logs.length])

  useEffect(() => {
    if (!settings.nebulaCoreEnabled || !settings.automationSchedulerEnabled) return
    if (nebulaStartupRoutinesRan.current) return
    nebulaStartupRoutinesRan.current = true
    void Promise.allSettled(
      runStartupRoutines(settings, {
        lmOnline,
        workspaceAwareness,
        onLog: (type, message, details) => addLog(createLog(type, message, details)),
      }),
    )
  }, [settings.nebulaCoreEnabled, settings.automationSchedulerEnabled])

  useEffect(() => {
    if (!settings.nebulaCoreEnabled || !settings.automationSchedulerEnabled) return
    return startAutomationScheduler(settings, {
      lmOnline,
      workspaceAwareness,
      onLog: (type, message, details) => addLog(createLog(type, message, details)),
    })
  }, [
    settings.nebulaCoreEnabled,
    settings.automationSchedulerEnabled,
    settings.automationConfirmationMode,
    settings.projectFolder,
    settings.memoryFolder,
    lmOnline,
    workspaceAwareness?.id,
  ])

  useEffect(() => {
    if (!settings.nebulaCoreEnabled || !settings.automationSchedulerEnabled) return
    if (previousLmOnline.current === null) {
      previousLmOnline.current = lmOnline
      return
    }
    if (previousLmOnline.current === lmOnline) return
    previousLmOnline.current = lmOnline
    void Promise.allSettled(
      runTriggeredRoutines(settings, lmOnline ? 'lmstudio_online' : 'lmstudio_offline', {
        lmOnline,
        workspaceAwareness,
        onLog: (type, message, details) => addLog(createLog(type, message, details)),
      }),
    )
  }, [lmOnline, settings.nebulaCoreEnabled, settings.automationSchedulerEnabled, settings.automationConfirmationMode, workspaceAwareness?.id])

  useEffect(() => {
    if (!settings.nebulaCoreEnabled || !settings.automationSchedulerEnabled || !settings.projectFolder) return
    if (previousProjectFolder.current === settings.projectFolder) return
    previousProjectFolder.current = settings.projectFolder
    void Promise.allSettled(
      runTriggeredRoutines(settings, 'project_opened', {
        lmOnline,
        workspaceAwareness,
        onLog: (type, message, details) => addLog(createLog(type, message, details)),
      }),
    )
  }, [settings.projectFolder, settings.nebulaCoreEnabled, settings.automationSchedulerEnabled, settings.automationConfirmationMode, lmOnline, workspaceAwareness?.id])

  useEffect(() => {
    ensureMemory(settings.memoryFolder)
      .then(() => {
        setMemoryReady(true)
        addLog(createLog('memory', `Memory folder ready: ${settings.memoryFolder}`))
      })
      .catch((error) => {
        setMemoryReady(false)
        addLog(createLog('error', `Memory initialization failed: ${String(error)}`))
      })
  }, [settings.memoryFolder])

  useEffect(() => {
    let cancelled = false
    async function check() {
      if (document.visibilityState === 'hidden') return
      const healthModel =
        settings.singleModelEnabled
          ? settings.singleModel || settings.model
          : settings.modelMode === 'review'
          ? settings.reviewModel
          : settings.modelMode === 'code'
            ? settings.codeModel
            : settings.modelMode === 'fast'
          ? settings.fastModel
          : settings.fastModel || settings.model
      const status = await checkLmStudio({ ...settings, model: healthModel || settings.model })
      if (!cancelled) {
        setLmOnline(status.online)
        setLmHealthDetail(status.error ?? '')
        const label = providerLabel(settings)
        const signature = `${status.online}:${status.error ?? ''}`
        if (previousHealthSignature.current !== signature) {
          previousHealthSignature.current = signature
          addLog(createLog(status.online ? 'status' : 'error', status.online ? status.error ? `${label} is reachable but needs attention: ${status.error}` : `${label} is online.` : `${label} offline: ${status.error ?? 'No response'}`))
        }
      }
    }
    check()
    const interval = window.setInterval(check, 15000)
    const onVisibility = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [settings.endpoint, settings.modelProvider, settings.nineRouterBaseUrl, settings.nineRouterApiKey, settings.nineRouterModel, settings.openRouterBaseUrl, settings.openRouterApiKey, settings.openRouterModel, settings.model, settings.modelMode, settings.fastModel, settings.codeModel, settings.reviewModel])

  useEffect(() => {
    const dailyModel = settings.singleModelEnabled
      ? settings.singleModel || settings.model
      : settings.modelAssignments?.daily || settings.fastModel || settings.model
    if (!lmOnline) {
      startupWarmKey.current = ''
      return
    }
    if (!settings.autoLoadModels || !settings.keepDailyModelWarm || !settings.warmFastModelOnStartup || !dailyModel) return

    const key = `${settings.endpoint}::${dailyModel}`
    if (startupWarmKey.current === key) return
    startupWarmKey.current = key

    warmModelInBackground({ ...settings, model: dailyModel }, 'daily', 'LM Studio online startup warm model preference.')
    addLog(createLog('status', `Daily model warm requested: ${dailyModel}`))
    void notify({ type: 'model_loaded', title: 'Daily model warm requested', message: dailyModel })
  }, [
    lmOnline,
    settings.endpoint,
    settings.model,
    settings.fastModel,
    settings.modelAssignments?.daily,
    settings.singleModel,
    settings.singleModelEnabled,
    settings.maxTokens,
    settings.autoLoadModels,
    settings.keepDailyModelWarm,
    settings.warmFastModelOnStartup,
  ])

  useEffect(() => {
    if (!settings.projectFolder || settings.activeProjectProfileId) return
    let cancelled = false
    detectProjectProfile(settings.projectFolder, settings)
      .then((profile) => {
        if (!cancelled) setSettings((current) => ({ ...current, activeProjectProfileId: profile.id }))
      })
      .catch((error) => addLog(createLog('error', `Startup profile detection failed: ${String(error)}`)))

    return () => {
      cancelled = true
    }
  }, [settings.projectFolder, settings.activeProjectProfileId])

  useEffect(() => {
    ambientOpenRef.current = ambientActive
  }, [ambientActive])

  useEffect(() => {
    function clearHoldTimer() {
      if (ambientHoldTimer.current) {
        window.clearTimeout(ambientHoldTimer.current)
        ambientHoldTimer.current = null
      }
    }

    function scheduleAmbientClose() {
      if (!ambientOpenRef.current) return
      if (ambientHideTimer.current) window.clearTimeout(ambientHideTimer.current)
      ambientHideTimer.current = window.setTimeout(() => setAmbientActive(false), 8000)
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && ambientOpenRef.current) {
        event.preventDefault()
        setAmbientActive(false)
        return
      }

      if (!event.ctrlKey || event.code !== 'Space' || ambientHoldTimer.current || ambientOpenRef.current) return
      event.preventDefault()
      ambientHoldTimer.current = window.setTimeout(() => {
        ambientHoldTimer.current = null
        openAmbientAssistant('hotkey')
      }, settings.assistantHoldMs ?? 650)
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.code !== 'Space' && event.key !== 'Control') return
      clearHoldTimer()
      scheduleAmbientClose()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      clearHoldTimer()
      if (ambientHideTimer.current) window.clearTimeout(ambientHideTimer.current)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [openAmbientAssistant, settings.assistantHoldMs])

  useEffect(() => {
    if (!settings.globalShortcutEnabled) return
    let cleanup: (() => void | Promise<void>) | undefined
    let cancelled = false

    registerAmbientShortcut(settings.assistantHoldMs ?? 650, () => {
      openAmbientAssistant('global')
    })
      .then((unregister) => {
        if (cancelled) {
          void unregister()
          return
        }
        cleanup = unregister
        addLog(createLog('status', 'Global Ctrl+Space ambient shortcut registered.'))
      })
      .catch((error) => addLog(createLog('error', `Global shortcut failed: ${String(error)}`)))

    return () => {
      cancelled = true
      void cleanup?.()
    }
  }, [openAmbientAssistant, settings.assistantHoldMs, settings.globalShortcutEnabled])

  useEffect(() => {
    let cancelled = false

    setLaunchAtStartup(settings.launchAtStartup ?? true)
      .then((enabled) => {
        if (!cancelled) addLog(createLog('status', enabled ? 'Nebula will launch at Windows sign-in.' : 'Nebula autostart is off.'))
      })
      .catch((error) => addLog(createLog('error', `Autostart update failed: ${String(error)}`)))

    return () => {
      cancelled = true
    }
  }, [settings.launchAtStartup])

  useEffect(() => {
    let cleanup: (() => void | Promise<void>) | undefined
    let cancelled = false

    registerBackgroundClose(settings.keepRunningInBackground ?? true, () => {
      addLog(createLog('status', 'Nebula is hidden but still running. Hold Ctrl+Space to bring it back.'))
    })
      .then((unlisten) => {
        if (cancelled) {
          void unlisten()
          return
        }
        cleanup = unlisten
      })
      .catch((error) => addLog(createLog('error', `Background close handler failed: ${String(error)}`)))

    return () => {
      cancelled = true
      void cleanup?.()
    }
  }, [settings.keepRunningInBackground])

  const contextUsage = useMemo(() => {
    const chars = messages.slice(-18).reduce((total, message) => total + message.content.length, 0)
    return Math.min(100, (chars / Math.max(settings.contextBudgetChars || 18000, 1)) * 100)
  }, [messages, settings.contextBudgetChars])
  const serviceState = useMemo(() => deriveServiceState(settings, lmOnline, agentStatus, lmHealthDetail), [settings, lmOnline, agentStatus, lmHealthDetail])

  useEffect(() => {
    if (!settings.dailyBriefEnabled) return
    const health = workspaceAwareness ? buildProjectHealthReport(workspaceAwareness) : settings.projectFolder ? getProjectHealthReport(settings.projectFolder) : null
    buildDailyBrief(workspaceAwareness, health, serviceState)
  }, [settings.dailyBriefEnabled, settings.projectFolder, workspaceAwareness, serviceState])

  async function runScreenCapture() {
    setCaptureError('')
    try {
      const capture = await captureScreen()
      setLatestCapture(capture)
      addLog(createLog('tool_result', `Screen captured: ${capture.path}`))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setCaptureError(message)
      addLog(createLog('error', `Screen capture failed: ${message}`))
    }
  }

  async function runQuickAction(actionId: string, target?: string, source = 'unknown') {
    const action = getQuickAction(actionId)
    if (!action) {
      addLog(createLog('error', `Unknown quick action: ${actionId}`))
      return
    }
    if (action.requiresFile && !target && !openedFile?.path) {
      addLog(createLog('error', `${action.label} needs a selected file.`))
      return
    }

    const actualTarget = target ?? openedFile?.path
    const run = recordQuickActionRun({
      actionId: action.id,
      label: action.label,
      source,
      target: actualTarget,
      status: 'running',
    })
    addLog(createLog('status', `Quick action started: ${action.label}`, { actionId, target: actualTarget, source }))

    if (action.id === 'clear-temp-context') {
      const ok = window.confirm('Clear temporary Nebula context? Memory, tasks, profiles, and timeline history will be kept.')
      if (!ok) {
        updateQuickActionRun(run.id, { status: 'error', error: 'User cancelled.' })
        addLog(createLog('status', 'Clear Temporary Context cancelled.'))
        return
      }
      clearTemporaryContext()
      setMessages([createMessage('assistant', 'Temporary context cleared. Memory, tasks, profiles, and timeline history were kept.')])
      setOpenedFile(null)
      updateQuickActionRun(run.id, { status: 'done' })
      addLog(createLog('status', 'Temporary context cleared.'))
      return
    }

    try {
      const prompt = promptForQuickAction(action, actualTarget)
      if (action.taskMode) {
        const task = createTaskRun(`Quick Action: ${action.label}`)
        updateQuickActionRun(run.id, { taskId: task.id })
        appendTaskEvent(task.id, {
          type: 'notification',
          label: `Quick action: ${action.label}`,
          detail: `Source: ${source}${actualTarget ? `\nTarget: ${actualTarget}` : ''}`,
        })
        await sendMessage(prompt, task.id)
      } else {
        await sendMessage(prompt)
      }
      updateQuickActionRun(run.id, { status: 'done' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateQuickActionRun(run.id, { status: 'error', error: message })
      addLog(createLog('error', `Quick action failed: ${message}`))
    }
  }

  async function sendMessage(content: string, taskId?: string, attachments: ComposerAttachment[] = [], remoteRequest?: RemoteRunRequest) {
    const mobileSink = remoteRequest ? createMobileRunSink(remoteRequest.runId) : null
    if (remoteRequest && activeRun.current) {
      await mobileSink?.event('error', { message: 'Nebula is already working on a request from another surface.', code: 'agent_busy' })
      return
    }
    if (!remoteRequest) activeRun.current?.cancel('superseded')
    const run = new AgentRunController()
    activeRun.current = run
    if (remoteRequest && mobileSink) activeMobileRun.current = { request: remoteRequest, sink: mobileSink }
    run.start()
    stopped.current = false
    const targetConversationId = remoteRequest?.conversationId || activeConversationId
    const targetSession = conversations.find((conversation) => conversation.id === targetConversationId)
    const allTargetMessages = targetSession?.messages ?? (targetConversationId === activeConversationId ? messages : [])
    const sourceIndex = remoteRequest?.sourceMessageId
      ? allTargetMessages.findIndex((message) => message.id === remoteRequest.sourceMessageId)
      : -1
    const targetHistory = (sourceIndex >= 0 ? allTargetMessages.slice(0, sourceIndex) : allTargetMessages).slice(-16)
    const updateTargetMessages = (update: React.SetStateAction<import('./types/agent').ChatMessage[]>) => {
      if (targetConversationId === activeConversationId) setMessages(update)
      else setConversationMessages(targetConversationId, update)
    }
    const reusedSource = sourceIndex >= 0 && allTargetMessages[sourceIndex]?.role === 'user'
      ? allTargetMessages[sourceIndex]
      : undefined
    const userMessage = reusedSource ?? createMessage('user', content, attachments)
    if (remoteRequest?.mode === 'retry' || remoteRequest?.mode === 'regenerate') {
      if (!reusedSource) {
        await mobileSink?.event('error', { message: 'The original user message is no longer available.', code: 'source_message_not_found' })
        run.fail()
        if (activeRun.current === run) activeRun.current = null
        if (activeMobileRun.current?.request.runId === remoteRequest.runId) activeMobileRun.current = null
        await mobileSink?.flush()
        return
      }
      updateTargetMessages((current) => {
        const index = current.findIndex((message) => message.id === reusedSource.id)
        return index >= 0 ? current.slice(0, index + 1) : current
      })
    } else {
      updateTargetMessages((current) => [...current, userMessage])
    }
    await mobileSink?.event('accepted', { conversationId: targetConversationId })
    addLog(createLog('user_message', content))
    appendTaskEvent(taskId, { type: 'user_prompt', label: 'User prompt', detail: content })
    const attachmentContext = await buildComposerAttachmentContext(attachments)
    if (run.signal.aborted || activeRun.current !== run) return
    const intentDirective = remoteRequest ? mobileIntentDirective(remoteRequest.intentMode) : ''
    const projectDirective = remoteRequest?.includeProjectContext
      ? '[PROJECT CONTEXT]\nInclude the active project context when it is available, and say clearly when it is not.\n\n'
      : ''
    const agentContent = `${projectDirective}${intentDirective}${content}${attachmentContext}`
    const agentUserMessage = agentContent === content ? userMessage : { ...userMessage, content: agentContent }
    const runSettings = settingsForMobileRun(settings, remoteRequest)

    const history = targetHistory
    let runModel = settings.model
    let firstTokenMs: number | undefined
    let loadMs: number | undefined
    let assistantTextBuffer = ''
    const toolCallsForTraining: string[] = []
    const toolResultsForTraining: string[] = []
    const errorsForTraining: string[] = []
    let routeLabel = ''
    let requestFailed = false
    const startedAt = performance.now()
    try {
      await runAgentLoop(
      runSettings,
      agentUserMessage,
      history,
      {
        setStatus: (status) => {
          if (run.signal.aborted || activeRun.current !== run) return
          setAgentStatus(status)
          void mobileSink?.event('status', { status })
          addLog(createLog('status', `Agent status: ${status}`))
        },
        onMessage: (message) => {
          if (run.signal.aborted || activeRun.current !== run) return
          if (message.role === 'assistant' && message.content) assistantTextBuffer += message.content
          updateTargetMessages((current) => [...current, message])
          if (message.role === 'assistant' && message.content) void mobileSink?.event('message', { messageId: message.id, content: message.content })
        },
        onAssistantToken: (messageId, token) => {
          if (run.signal.aborted || activeRun.current !== run) return
          assistantTextBuffer += token
          updateTargetMessages((current) =>
            current.map((message) => (message.id === messageId ? { ...message, content: message.content + token } : message)),
          )
          mobileSink?.token(messageId, token)
        },
        onToolRequest: (request) => {
          if (run.signal.aborted || activeRun.current !== run) return
          toolCallsForTraining.push(`${request.tool}: ${JSON.stringify(request.args)}`)
          void mobileSink?.event('tool_request', { request: { tool: request.tool, args: {} } })
          addLog(createLog('tool_request', `${request.tool} requested`, request))
          appendTaskEvent(taskId, {
            type: 'tool_call',
            label: `Tool call: ${request.tool}`,
            detail: JSON.stringify(request.args, null, 2),
            data: request,
          })
          recordTaskArtifact(taskId, {
            tool: request.tool,
            file: typeof request.args.path === 'string' ? request.args.path : undefined,
            command: typeof request.args.command === 'string' ? request.args.command : undefined,
          })
        },
        onToolResult: (result) => {
          if (run.signal.aborted || activeRun.current !== run) return
          const summarized = `${result.tool}: ${summarizeToolResult(result)}`
          void mobileSink?.event('tool_result', { result: { ok: result.ok, tool: result.tool } })
          if (result.ok) toolResultsForTraining.push(summarized)
          else errorsForTraining.push(summarized)
          addLog(createLog(result.ok ? 'tool_result' : 'error', JSON.stringify(result, null, 2)))
          appendTaskEvent(taskId, {
            type: result.ok ? 'tool_result' : 'error',
            label: `${result.tool} ${result.ok ? 'completed' : 'failed'}`,
            detail: summarizeToolResult(result),
            data: result,
          })

          if (result.ok && result.tool === 'web_search' && Array.isArray(result.output)) {
            const cards = createSourceCardsFromSearch(result.output as WebSearchResult[], taskId)
            cards.forEach((card) => {
              attachTaskSourceCard(taskId, card.id)
              appendTaskEvent(taskId, {
                type: 'web_source',
                label: `Source: ${card.title}`,
                detail: card.url,
                data: card,
              })
              const source = sanitizeMobileSource(card)
              if (source) void mobileSink?.event('source', { source })
            })
          }

          if (result.ok && result.tool === 'web_fetch' && result.output && typeof result.output === 'object' && 'url' in result.output) {
            const card = createSourceCardFromFetch(result.output as WebFetchResult, taskId)
            attachTaskSourceCard(taskId, card.id)
            appendTaskEvent(taskId, {
              type: 'web_source',
              label: `Fetched: ${card.title}`,
              detail: card.url,
              data: card,
            })
            const source = sanitizeMobileSource(card)
            if (source) void mobileSink?.event('source', { source })
          }

          if (
            result.ok &&
            ['write_file', 'create_file', 'append_file'].includes(result.tool) &&
            result.output &&
            typeof result.output === 'object' &&
            'patchQueued' in result.output
          ) {
            void notify({
              type: 'needs_input',
              title: 'Patch queued',
              message: String((result.output as { path?: unknown }).path ?? 'Review the pending diff in Patches.'),
              data: result.output,
            })
          }

          if (
            result.ok &&
            result.tool === 'run_command' &&
            result.output &&
            typeof result.output === 'object' &&
            'code' in result.output &&
            Number((result.output as { code?: number | null }).code ?? 0) !== 0
          ) {
            void notify({
              type: 'build_failed',
              title: 'Command failed',
              message: summarizeToolResult(result).slice(0, 220),
              data: result,
            })
          }
        },
        onModelEvent: (message) => addLog(createLog('status', message)),
        onModelResolved: (model) => {
          runModel = model
          routeLabel = settings.showModelDebugInfo ? model : 'Nebula unified route'
          appendTaskEvent(taskId, {
            type: 'model_route',
            label: settings.showModelDebugInfo ? `Model route: ${model}` : 'Nebula route selected',
            detail: settings.showModelDebugInfo ? model : 'Internal route hidden.',
          })
        },
        onModelMetric: (model, metric) => {
          if (metric.firstTokenMs !== undefined) firstTokenMs = metric.firstTokenMs
          if (metric.loadMs !== undefined) loadMs = metric.loadMs
          recordModelLoadMetric(model, {
            lastFirstTokenMs: metric.firstTokenMs,
            lastLoadMs: metric.loadMs,
          })
        },
        onModelError: (model, error) => {
          errorsForTraining.push(`${model}: ${error}`)
          addLog(createLog('error', `${model}: ${error}`))
        },
        requestApproval: (request) =>
          new Promise((resolve) => {
            if (run.signal.aborted || activeRun.current !== run) { resolve(false); return }
            setApproval(request)
            approvalResolver.current = resolve
            if (remoteRequest) {
              remoteApproval.current = { runId: remoteRequest.runId, approvalId: request.id }
              void mobileSink?.event('approval_required', { approval: { ...request, runId: remoteRequest.runId } })
            }
            addLog(createLog('approval', `Waiting for approval: ${request.toolRequest.tool}`))
          }),
      },
      () => stopped.current,
        {
          openedFile,
          recentLogs: logs.slice(-24),
        },
        run.signal,
      )
      run.complete()
    } catch (error) {
      requestFailed = true
      run.fail()
      const normalized = normalizeNebulaError(error)
      const message = normalized.cause ?? normalized.message
      if (stopped.current || normalized.code === 'cancelled') {
        setAgentStatus('stopped')
        addLog(createLog('status', 'Request cancelled. Conversation context was preserved.'))
        appendTaskEvent(taskId, { type: 'notification', label: 'Task stopped', detail: 'The active request was cancelled by the user.' })
        await mobileSink?.event('cancelled', { message: 'Nebula stopped the active request.' })
      } else {
      const friendly = `Nebula could not complete that request: ${normalized.message}\n\nYour chat, project, memory, and task history are still available locally. Check Model Doctor if this was a model or LM Studio issue.`
      errorsForTraining.push(message)
      setAgentStatus('error')
      addLog(createLog('error', `Agent loop failed safely: ${message}`))
      appendTaskEvent(taskId, { type: 'error', label: 'Agent request failed', detail: message })
      assistantTextBuffer += friendly
      updateTargetMessages((current) => [...current, createMessage('assistant', friendly)])
      await mobileSink?.event('error', { message: normalized.message, code: normalized.code })
      }
    }
    await conversationRepository.flush().catch(() => undefined)
    if (mobileSink && !requestFailed && !stopped.current) await mobileSink.event('completed', { conversationId: targetConversationId })
    if (activeRun.current === run) activeRun.current = null
    if (remoteRequest && activeMobileRun.current?.request.runId === remoteRequest.runId) activeMobileRun.current = null
    if (remoteRequest && remoteApproval.current?.runId === remoteRequest.runId) remoteApproval.current = null
    await mobileSink?.flush()
    recordModelRun(runModel, performance.now() - startedAt, assistantTextBuffer, {
      lastFirstTokenMs: firstTokenMs,
      lastLoadMs: loadMs,
    })
    if (assistantTextBuffer.trim()) {
      recordTrainingLog({
        source: taskId ? 'task' : 'chat',
        prompt: content,
        response: assistantTextBuffer,
        model: runModel,
        routeLabel,
        projectFolder: settings.projectFolder,
        openedFile: openedFile?.path,
        toolCalls: toolCallsForTraining,
        toolResults: toolResultsForTraining,
        errors: errorsForTraining,
        accepted: errorsForTraining.length === 0,
        tags: [
          taskId ? 'task' : 'chat',
          remoteRequest?.intentMode ?? settings.modelMode ?? 'auto',
          toolCallsForTraining.length ? 'tools' : 'no-tools',
        ],
        durationMs: performance.now() - startedAt,
      })
    }
    if (taskId) {
      appendTaskEvent(taskId, {
        type: 'final',
        label: stopped.current ? 'Task stopped' : 'Task finished',
        detail: assistantTextBuffer.slice(-1400) || 'Task completed in chat thread.',
      })
      updateTaskRun(taskId, {
        status: stopped.current ? 'stopped' : requestFailed ? 'error' : 'done',
        finalResult: assistantTextBuffer.slice(-900) || 'Task completed in chat thread.',
        steps: [
          { id: crypto.randomUUID(), label: 'Understand goal', status: 'done' },
          { id: crypto.randomUUID(), label: 'Plan work', status: 'done' },
          { id: crypto.randomUUID(), label: 'Use tools if needed', status: 'done' },
          { id: crypto.randomUUID(), label: 'Summarize result', status: 'done' },
        ],
      })
      await notify({
        type: stopped.current ? 'needs_input' : 'task_done',
        title: stopped.current ? 'Task stopped' : requestFailed ? 'Task needs attention' : 'Task complete',
        message: content.slice(0, 120),
        data: { taskId },
      })
    }
    if (settings.memoryReviewMode === 'suggest' && content.length > 24 && /\b(fix|learn|remember|preference|works|solved|lesson)\b/i.test(content)) {
      proposeMemory('lessons_learned.md', `User/task note: ${content}`, 'Potential useful lesson from chat/task.')
      addLog(createLog('memory', 'Memory proposal created.'))
      await notify({
        type: 'memory_proposal',
        title: 'Memory proposal created',
        message: 'A possible useful lesson is waiting in Memory Inbox.',
      })
    }
  }

  async function startTask(goal: string) {
    const task = createTaskRun(goal)
    addLog(createLog('status', `Task started: ${goal}`))
    await sendMessage(
      `[TASK MODE]\nGoal: ${goal}\nCreate a short plan, use tools if needed, track important files/commands, and finish with a concise result.`,
      task.id,
    )
  }

  async function startFixMyApp(goal: string) {
    const task = createTaskRun(`Fix My App: ${goal}`)
    const health = workspaceAwareness ? buildProjectHealthReport(workspaceAwareness) : null
    addLog(createLog('status', `Fix My App started: ${goal}`))
    appendTaskEvent(task.id, {
      type: 'notification',
      label: 'Fix My App workflow',
      detail: 'Evidence-first repair mode. Inspect project health and key files, run safe checks, then queue reviewable patches only when the root cause is clear.',
    })
    await sendMessage(
      `[FIX MY APP]\nProblem or goal: ${goal}\nObserved project health: ${health ? `${health.status}; ${health.checks.map((check) => `${check.label}: ${check.detail}`).join(' | ')}` : 'No persisted health report yet.'}\nUse the active project profile and verify the failure with the smallest useful files and safe checks such as git status, npm run build, or npm test. Fix the root cause. File-write tools must create reviewable Patch Workspace proposals and must never auto-apply them. Finish with evidence, the proposed patch list, and the exact verification still needed.`,
      task.id,
    )
  }

  async function runQueuedTask(id: string) {
    if (queueRunInProgress.current) {
      addLog(createLog('status', 'A queued task is already running.'))
      return
    }
    const queued = getQueuedTasks().find((task) => task.id === id)
    if (!queued || queued.status !== 'queued') return

    queueRunInProgress.current = true
    updateQueuedTask(id, {
      status: 'running',
      startedAt: new Date().toISOString(),
      attempts: queued.attempts + 1,
      error: undefined,
    })
    addLog(createLog('status', `Queued task started: ${queued.label}`))
    try {
      if (queued.kind === 'fix') await startFixMyApp(queued.goal)
      else await startTask(queued.goal)
      updateQueuedTask(id, { status: 'done', completedAt: new Date().toISOString() })
      addLog(createLog('status', `Queued task finished: ${queued.label}`))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateQueuedTask(id, { status: 'error', completedAt: new Date().toISOString(), error: message })
      addLog(createLog('error', `Queued task failed: ${message}`))
    } finally {
      queueRunInProgress.current = false
    }
  }

  async function submitAmbientPrompt(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    if (settings.screenshotAskEnabled && latestCapture) {
      await sendMessage(
        `[SCREEN ASK]\nCaptured screenshot: ${latestCapture.path}\nDimensions: ${latestCapture.width}x${latestCapture.height}\nUser question: ${trimmed}\nUse the screenshot path as current screen context. If vision is not available locally, say what extra context you need instead of pretending to see it.`,
      )
      return
    }
    await sendMessage(trimmed)
  }

  function handleLauncherAction(action: string) {
    const panelTabs: SidebarTab[] = ['jarvis', 'models', 'modelDoctor', 'modelProfiler', 'mobile', 'training', 'fineTuning', 'settings', 'skills', 'permissions', 'context', 'privacy', 'diagnostics', 'timeline', 'replay', 'quick', 'launcher']
    if (panelTabs.includes(action as SidebarTab)) {
      setSidebarTab(action as SidebarTab)
      addLog(createLog('status', `Opened panel: ${action}`))
      return
    }
    if (action === 'setup') {
      setSetupWizardOpen(true)
      addLog(createLog('status', 'Opened setup wizard.'))
      return
    }
    if (action === 'memory') {
      setSidebarTab('inbox')
      addLog(createLog('status', 'Opened panel: memory inbox'))
      return
    }
    if (action === 'capture_screen' || action === 'screenshot_ask') {
      void runScreenCapture()
      openAmbientAssistant('manual')
      return
    }
    if (getQuickAction(action)) {
      void runQuickAction(action, undefined, 'launcher')
      return
    }
    addLog(createLog('status', `Launcher action selected: ${action}`))
  }

  function handleDraftChange(draft: string) {
    if (!settings.warmModelWhileTyping || !settings.autoLoadModels) return
    if (draftWarmTimer.current) window.clearTimeout(draftWarmTimer.current)
    draftWarmTimer.current = window.setTimeout(() => {
      warmPredictedModelInBackground(settings, draft, 'User typing prediction.')
    }, 450)
  }

  useEffect(() => {
    let cleanup: (() => void) | undefined

    listen<string>('ambient-submit', (event) => {
      const content = String(event.payload ?? '').trim()
      if (content) void submitAmbientPrompt(content)
    })
      .then((unlisten) => {
        cleanup = unlisten
      })
      .catch((error) => addLog(createLog('error', `Ambient overlay listener failed: ${String(error)}`)))

    return () => cleanup?.()
  }, [settings, messages, latestCapture])

  mobileRunRequestHandler.current = (request) => {
    const conversationId = request.conversationId || crypto.randomUUID()
    ensureConversation(conversationId, settings.projectFolder)
    void sendMessage(request.content, undefined, request.attachments ?? [], { ...request, conversationId })
  }

  mobileCancelHandler.current = (request) => {
    const active = activeMobileRun.current
    if (!active || active.request.runId !== request.runId || active.request.clientId !== request.clientId) return
    void stopAgent()
  }

  mobileApprovalHandler.current = (decision) => {
    const active = activeMobileRun.current
    const pending = remoteApproval.current
    if (!active || !pending || active.request.runId !== decision.runId || active.request.clientId !== decision.clientId || pending.approvalId !== decision.approvalId) return
    if (approval?.requiresTypedConfirm && decision.approved && decision.confirmation !== 'CONFIRM') return
    decideApproval(decision.approved)
  }

  useEffect(() => {
    if (!isTauriRuntime()) return
    let disposed = false
    const cleanups: Array<() => void> = []
    void Promise.all([
      listen<RemoteRunRequest>('nebula-mobile-run-request', (event) => mobileRunRequestHandler.current(event.payload)),
      listen<RemoteRunCancel>('nebula-mobile-run-cancel', (event) => mobileCancelHandler.current(event.payload)),
      listen<RemoteApprovalDecision>('nebula-mobile-approval-decision', (event) => mobileApprovalHandler.current(event.payload)),
      listen<RemoteMobileSettingsChange>('nebula-mobile-settings-change', (event) => {
        setSettings((current) => applyMobileControlChange(current, event.payload.change))
        addLog(createLog('status', `Mobile updated ${Object.keys(event.payload.change).join(', ') || 'assistant settings'}.`))
      }),
    ]).then((listeners) => {
      if (disposed) listeners.forEach((cleanup) => cleanup())
      else cleanups.push(...listeners)
    }).catch((error) => addLog(createLog('error', `Mobile bridge listener failed: ${String(error)}`)))
    return () => { disposed = true; cleanups.forEach((cleanup) => cleanup()) }
  }, [])

  useEffect(() => {
    if (!lmOnline) { setMobileModels([]); return }
    let disposed = false
    void listLmStudioModelInfos(settings).then((models) => { if (!disposed) setMobileModels(models) }).catch(() => { if (!disposed) setMobileModels([]) })
    return () => { disposed = true }
  }, [lmOnline, settings.endpoint, settings.modelProvider, settings.nineRouterBaseUrl, settings.openRouterBaseUrl])

  useEffect(() => {
    const enabledTools = getEnabledToolNames()
    const hasProject = Boolean(settings.projectFolder.trim())
    const projectName = settings.projectFolder.split(/[\\/]/).filter(Boolean).at(-1) || 'Active project'
    void updateMobileRuntimeStatus({
      agentStatus,
      service: lmOnline ? 'online' : 'offline',
      model: settings.showModelDebugInfo ? modelLabel(settings) : 'Nebula unified',
      memoryReady,
      activeRunSource: activeMobileRun.current ? 'mobile' : activeRun.current ? 'desktop' : null,
      activeProject: hasProject ? { name: projectName } : null,
      capabilities: {
        webSearch: enabledTools.has('web_search'),
        deepResearch: enabledTools.has('web_search') && enabledTools.has('web_fetch'),
        deepThinking: true,
        projectSearch: hasProject,
        projectContext: hasProject,
        guidedLearning: true,
        personalIntelligence: memoryReady && settings.contextInjectionEnabled !== false,
      },
      mobileControl: mobileControlSnapshot(settings),
      models: mobileModels.map((model) => ({
        key: model.id,
        displayName: model.displayName,
        loaded: model.loaded,
        sizeBytes: model.sizeBytes,
        architecture: model.architecture,
        quantization: model.quantization,
      })),
    })
  }, [agentStatus, lmOnline, memoryReady, mobileModels, settings])

  async function stopAgent() {
    const mobile = activeMobileRun.current
    stopped.current = true
    activeRun.current?.cancel('user')
    cancelActiveLmStudioRequests()
    setApproval(null)
    approvalResolver.current?.(false)
    approvalResolver.current = null
    await stopRunningCommand().catch(() => undefined)
    setAgentStatus('stopped')
    addLog(createLog('status', 'Stop requested. Running command stopped if one existed.'))
    await mobile?.sink.event('cancelled', { message: 'Nebula stopped the active request.' })
  }

  function startNewConversation() {
    newConversation(settings.projectFolder)
    setSidebarTab(null)
    addLog(createLog('status', 'Started a new recoverable chat session.'))
  }

  function decideApproval(approved: boolean) {
    addLog(createLog('approval', approved ? 'User approved action.' : 'User rejected action.'))
    const mobile = activeMobileRun.current
    if (mobile && remoteApproval.current?.runId === mobile.request.runId) {
      void mobile.sink.event('approval_resolved', { approvalId: remoteApproval.current.approvalId, approved })
      remoteApproval.current = null
    }
    setApproval(null)
    approvalResolver.current?.(approved)
    approvalResolver.current = null
  }

  return (
    <>
      <div className={`nebula-app flex h-full flex-col text-slate-100 ${sidebarCollapsed ? 'nebula-sidebar-collapsed' : ''}`}>
        <TopBar
          projectName={settings.projectFolder.split(/[\\/]/).filter(Boolean).at(-1) ?? ''}
          model={settings.showModelDebugInfo ? modelLabel(settings) : 'Nebula unified'}
          memoryReady={memoryReady}
          agentStatus={agentStatus}
          actionMode={settings.actionMode ?? 'fast'}
          notificationCount={notificationCount}
          serviceState={serviceState}
          onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
          onOpenCommandCenter={() => setCommandCenterOpen(true)}
          onToggleInspector={() => setInspectorOpen((current) => !current)}
          inspectorOpen={inspectorOpen}
          onStop={stopAgent}
        />
        <main className="nebula-main-grid codex-focus-grid flex min-h-0 flex-1 gap-2 p-2">
          {!sidebarCollapsed && <ErrorBoundary name="Sidebar">
            <Sidebar
              settings={settings}
              logs={logs}
              files={files}
              openedFile={openedFile}
              onPickProject={chooseProject}
              onOpenFile={openFile}
              onSettingsChange={setSettings}
              skillsVersion={skillsVersion}
              onSkillsChange={() => setSkillsVersion((current) => current + 1)}
              onStartTask={startTask}
              onFixMyApp={startFixMyApp}
              onRunQueuedTask={(id) => void runQueuedTask(id)}
              onLauncherAction={handleLauncherAction}
              onQuickAction={runQuickAction}
              conversations={conversations}
              activeConversationId={activeConversationId}
              onNewConversation={startNewConversation}
              onSelectConversation={(id) => {
                selectConversation(id)
                setSidebarTab(null)
              }}
              onToggleConversationPinned={toggleConversationPinned}
              onDeleteConversation={deleteConversation}
              conversationFolders={conversationFolders}
              onCreateConversationFolder={createConversationFolder}
              onDeleteConversationFolder={deleteConversationFolder}
              onMoveConversationToFolder={moveConversationToFolder}
              agentStatus={agentStatus}
              lmOnline={lmOnline}
              memoryReady={memoryReady}
              workspaceAwareness={workspaceAwareness}
              onLog={(type, message, details) => addLog(createLog(type, message, details))}
              activeTab={sidebarTab}
              onActiveTabChange={setSidebarTab}
            />
          </ErrorBoundary>}
          <ErrorBoundary name="Workspace">
            <section className="nebula-workspace flex min-w-0 flex-1 flex-col">
              {recoveryNotice && <div className="nebula-recovery-notice" role="status">
                <span>{recoveryNotice}</span>
                <button type="button" onClick={() => setRecoveryNotice('')} aria-label="Dismiss recovery notice">Dismiss</button>
              </div>}
              <ChatPanel
                messages={messages}
                disabled={['loading_model', 'switching_model', 'thinking', 'reviewing', 'running_tool'].includes(agentStatus)}
                onSend={(content, attachments) => void sendMessage(content, undefined, attachments)}
                onDraftChange={handleDraftChange}
                projectName={settings.projectFolder.split(/[\\/]/).filter(Boolean).at(-1) ?? ''}
                agentStatus={agentStatus}
                contextUsage={contextUsage}
                workspaceAwareness={workspaceAwareness}
                onQuickAction={runQuickAction}
                settings={settings}
                onSettingsChange={setSettings}
              />
            </section>
          </ErrorBoundary>
          {inspectorOpen && <ErrorBoundary name="Live context">
            <WorkspaceRail
              agentStatus={agentStatus}
              serviceState={serviceState}
              memoryReady={memoryReady}
              model={settings.showModelDebugInfo ? modelLabel(settings) : 'Nebula unified'}
              contextUsage={contextUsage}
              workspace={workspaceAwareness}
              onOpenCommandCenter={() => setCommandCenterOpen(true)}
            />
          </ErrorBoundary>}
        </main>
        <AmbientAssistant
          active={ambientActive}
          settings={settings}
          latestCapture={latestCapture}
          captureError={captureError}
          onClose={() => setAmbientActive(false)}
          onCaptureScreen={runScreenCapture}
          onSubmitVoice={submitAmbientPrompt}
        />
        <ApprovalModal approval={approval} onDecision={decideApproval} />
        <CommandCenter
          open={commandCenterOpen}
          settings={settings}
          onClose={() => setCommandCenterOpen(false)}
          onAction={handleLauncherAction}
          onOpenPanel={setSidebarTab}
          onSend={(content) => void sendMessage(content)}
          onPickProject={chooseProject}
          conversations={conversations}
          onSelectConversation={selectConversation}
          onLog={(type, message, details) => addLog(createLog(type, message, details))}
        />
        <SetupWizard
          open={setupWizardOpen}
          settings={settings}
          onChange={setSettings}
          onClose={() => setSetupWizardOpen(false)}
        />
      </div>
      {showSplash && <SplashScreen mode={settings.startupAnimation ?? 'cinematic'} onComplete={() => setShowSplash(false)} />}
    </>
  )
}
