import {
  ArrowDown, Brain, Check, ChevronDown, Copy, FileText, FolderSearch, Globe2,
  GraduationCap, Link2, Menu, Mic, MoreHorizontal, Paperclip, Pencil, Pin, Plus,
  RotateCcw, Search, Send, Settings, Share2, Sparkles, Square, SquarePen, Trash2,
  Waypoints, WifiOff, X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MobileApiError, cancelRun, configureApiBridge, configureApiCache, copyText, createConversation, decideApproval, deleteConversation,
  getAttachmentBlob, getCachedConversations, getConversations, getStatus, hasDeviceToken,
  pairDevice, searchConversations, shareText, startRun, streamRun, unpairDevice,
  updateConversation,
} from './api'
import { deletePrivateValue, draftKey, readPrivateValue, writePrivateValue } from './idb'
import type {
  ApprovalEvent, ConversationStore, MobileAttachment, MobileConversation, MobileMessage,
  MobileCapabilities, MobileIntentMode, MobilePreferences, MobileRunMode,
  MobileSourceCard, RunEvent, RuntimeStatus, SearchResult,
} from './types'
import { shouldDisplayMobileMessage } from './messageDisplay'
import { useMobileViewport } from './useMobileViewport'
import { DEFAULT_MOBILE_PREFERENCES, loadMobilePreferences, saveMobilePreferences } from './mobileSettings'
import { impact, notifyHaptic, openPublicSource, showCompletionNotification } from './platform'
import { MobileSettingsScreen } from './MobileSettingsScreen'
import { MobileVoiceController, type MobileVoiceFailure, type MobileVoicePhase } from './voice'

const EMPTY_STORE: ConversationStore = { version: 2, activeId: '', sessions: [], folders: [] }
const FALLBACK_CAPABILITIES: MobileCapabilities = {
  webSearch: false,
  deepResearch: false,
  deepThinking: true,
  projectSearch: false,
  projectContext: false,
  guidedLearning: true,
  personalIntelligence: false,
}

const INTENT_LABELS: Record<MobileIntentMode, string> = {
  auto: 'Auto',
  web_search: 'Web Search',
  deep_research: 'Deep Research',
  deep_thinking: 'Deep Thinking',
  project_search: 'Project Search',
  guided_learning: 'Guided Learning',
  personal_intelligence: 'Personal Intelligence',
}

function now() { return new Date().toISOString() }

function message(role: MobileMessage['role'], content: string, id: string = crypto.randomUUID()): MobileMessage {
  return { id, role, content, createdAt: now() }
}

function relativeTime(value: string) {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return ''
  const elapsed = Math.max(0, Date.now() - timestamp)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function assistantStatus(value?: string) {
  if (!value || value === 'idle') return 'Ready'
  if (value === 'loading_model' || value === 'switching_model') return 'Preparing'
  if (value === 'thinking') return 'Reading context'
  if (value === 'running_tool' || value === 'waiting_approval') return 'Using a tool'
  if (value === 'reviewing') return 'Checking the answer'
  if (value === 'stopped') return 'Stopped'
  if (value === 'error') return 'Needs attention'
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
}

function mobileErrorMessage(code?: string, message?: string) {
  if (code === 'bridge_offline') return 'Your phone cannot reach Nebula on the PC. Check Tailscale and make sure Nebula is open.'
  if (code === 'bridge_timeout') return 'Nebula on your PC did not respond in time. Check the PC connection and try again.'
  if (code === 'offline') return 'Your local AI is offline. Open LM Studio on your PC and make sure its server is enabled.'
  if (code === 'unloaded_model') return 'Your selected local model is not loaded yet. Open Nebula on your PC and press Fix it.'
  if (code === 'missing_model') return 'Nebula could not find an available local model. Choose one on your PC, then try again.'
  if (code === 'timeout') return 'The local model took too long to answer. You can safely try again.'
  if (code === 'stream_interrupted') return 'The connection to your PC dropped before Nebula finished. Reconnect to see whether the run completed there.'
  if (code === 'agent_busy') return 'Nebula is already working on another request. Stop or finish that run first.'
  if (code === 'permission_denied') return 'Nebula needs permission on your PC before it can complete that action.'
  return message || 'Nebula could not finish that request.'
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
}

function safeStore(value: ConversationStore | null): ConversationStore {
  if (!value || !Array.isArray(value.sessions) || !Array.isArray(value.folders)) return EMPTY_STORE
  return value
}

export function App() {
  const [phase, setPhase] = useState<'boot' | 'pair' | 'ready'>('boot')
  const [online, setOnline] = useState(false)
  const [runtime, setRuntime] = useState<RuntimeStatus>({ agentStatus: 'checking', service: 'checking' })
  const [store, setStore] = useState<ConversationStore>(EMPTY_STORE)
  const [activeId, setActiveId] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [runId, setRunId] = useState('')
  const [runStatus, setRunStatus] = useState('')
  const [approval, setApproval] = useState<ApprovalEvent | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [pairCode, setPairCode] = useState('')
  const [pairing, setPairing] = useState(false)
  const [error, setError] = useState('')
  const [listening, setListening] = useState(false)
  const [voicePhase, setVoicePhase] = useState<MobileVoicePhase>('idle')
  const [voiceFailure, setVoiceFailure] = useState<MobileVoiceFailure | null>(null)
  const [preferences, setPreferences] = useState<MobilePreferences>(DEFAULT_MOBILE_PREFERENCES)
  const [preferencesReady, setPreferencesReady] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showInstallHint, setShowInstallHint] = useState(() => !isStandalone())
  const [updateReady, setUpdateReady] = useState(false)
  const [showScrollLatest, setShowScrollLatest] = useState(false)
  const [draftReadyFor, setDraftReadyFor] = useState('')
  const [messageMenu, setMessageMenu] = useState<MobileMessage | null>(null)
  const [conversationMenu, setConversationMenu] = useState<MobileConversation | null>(null)
  const [renameMode, setRenameMode] = useState(false)
  const [renameTitle, setRenameTitle] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [intentMode, setIntentMode] = useState<MobileIntentMode>('auto')
  const [includeProjectContext, setIncludeProjectContext] = useState(false)
  const [sourceCards, setSourceCards] = useState<Record<string, MobileSourceCard[]>>({})
  const streamAbort = useRef<AbortController | null>(null)
  const voiceController = useRef<MobileVoiceController | null>(null)
  const voiceFinalText = useRef('')
  const voiceSubmitTimer = useRef<number | null>(null)
  const voiceCaptureActive = useRef(false)
  const assistantBuffer = useRef('')
  const pendingTokenBuffer = useRef('')
  const pendingTokenMessageId = useRef('')
  const pendingTokenConversationId = useRef('')
  const tokenFlushTimer = useRef<number | null>(null)
  const messageList = useRef<HTMLDivElement | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const textarea = useRef<HTMLTextAreaElement | null>(null)
  const nearBottom = useRef(true)
  const edgeGesture = useRef<{ x: number; y: number; active: boolean } | null>(null)
  const drawerGesture = useRef<{ x: number; y: number; active: boolean } | null>(null)
  const keyboardOpen = useMobileViewport()

  useEffect(() => {
    let active = true
    void loadMobilePreferences().then((loaded) => {
      if (!active) return
      configureApiBridge(loaded.bridgeUrl)
      configureApiCache(loaded.cacheHistory)
      setPreferences(loaded)
      setPreferencesReady(true)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (/^https:\/\//i.test(preferences.bridgeUrl)) configureApiBridge(preferences.bridgeUrl)
    configureApiCache(preferences.cacheHistory)
    const root = document.documentElement
    root.dataset.mobileTheme = preferences.theme
    root.classList.toggle('mobile-compact', preferences.compactMessages)
    root.classList.toggle('mobile-reduced-motion', preferences.reducedMotion)
    root.classList.toggle('mobile-reduced-transparency', preferences.reducedTransparency)
    root.classList.toggle('mobile-high-contrast', preferences.highContrast)
    root.classList.toggle('mobile-nowrap-code', !preferences.wrapCode)
    root.style.setProperty('--mobile-text-scale', String(preferences.textScale))
    root.style.setProperty('--accent-intensity', String(preferences.accentIntensity))
  }, [preferences])

  function patchPreferences(change: Partial<MobilePreferences>) {
    setPreferences((current) => {
      const next = { ...current, ...change }
      void saveMobilePreferences(next)
      return next
    })
    void impact(preferences.haptics)
  }

  const activeConversation = useMemo(
    () => store.sessions.find((conversation) => conversation.id === activeId) ?? store.sessions[0],
    [activeId, store.sessions],
  )
  const visibleMessages = useMemo(
    () => (activeConversation?.messages ?? []).filter(shouldDisplayMobileMessage),
    [activeConversation],
  )
  const latestMessageContent = visibleMessages.at(-1)?.content
  const capabilities = runtime.capabilities ?? FALLBACK_CAPABILITIES
  const activeSources = activeConversation ? sourceCards[activeConversation.id] ?? [] : []

  const replaceConversation = useCallback((id: string, update: (conversation: MobileConversation) => MobileConversation) => {
    setStore((current) => ({
      ...current,
      sessions: current.sessions.map((conversation) => conversation.id === id ? update(conversation) : conversation),
    }))
  }, [])

  const flushStreamingTokens = useCallback(() => {
    if (tokenFlushTimer.current !== null) window.clearTimeout(tokenFlushTimer.current)
    tokenFlushTimer.current = null
    const content = pendingTokenBuffer.current
    const messageId = pendingTokenMessageId.current
    const conversationId = pendingTokenConversationId.current
    pendingTokenBuffer.current = ''
    pendingTokenMessageId.current = ''
    pendingTokenConversationId.current = ''
    if (!content || !messageId || !conversationId) return
    replaceConversation(conversationId, (conversation) => {
      const exists = conversation.messages.some((item) => item.id === messageId)
      return {
        ...conversation,
        updatedAt: now(),
        messages: exists
          ? conversation.messages.map((item) => item.id === messageId ? { ...item, content: item.content + content } : item)
          : [...conversation.messages, message('assistant', content, messageId)],
      }
    })
  }, [replaceConversation])

  const queueStreamingToken = useCallback((conversationId: string, messageId: string, token: string) => {
    if (pendingTokenMessageId.current && (pendingTokenMessageId.current !== messageId || pendingTokenConversationId.current !== conversationId)) {
      flushStreamingTokens()
    }
    pendingTokenConversationId.current = conversationId
    pendingTokenMessageId.current = messageId
    pendingTokenBuffer.current += token
    if (tokenFlushTimer.current === null) tokenFlushTimer.current = window.setTimeout(flushStreamingTokens, 40)
  }, [flushStreamingTokens])

  const refresh = useCallback(async () => {
    try {
      const [status, conversations] = await Promise.all([getStatus(), getConversations()])
      setRuntime(status.runtime ?? {})
      setOnline(true)
      setStore(safeStore(conversations))
      setActiveId((current) => conversations.sessions.some((item) => item.id === current) ? current : conversations.activeId || conversations.sessions[0]?.id || '')
      setError('')
      return true
    } catch (cause) {
      setOnline(false)
      if (cause instanceof MobileApiError && cause.status === 401) {
        await unpairDevice()
        setPhase('pair')
      }
      const cached = await getCachedConversations()
      if (cached) {
        setStore(safeStore(cached))
        setActiveId((current) => current || cached.activeId || cached.sessions[0]?.id || '')
      }
      return false
    }
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const status = await getStatus()
      setRuntime(status.runtime ?? {})
      setOnline(true)
      return true
    } catch (cause) {
      setOnline(false)
      if (cause instanceof MobileApiError && cause.status === 401) {
        await unpairDevice()
        setPhase('pair')
      }
      return false
    }
  }, [])

  useEffect(() => {
    if (!preferencesReady) return
    let cancelled = false
    void (async () => {
      const paired = await hasDeviceToken()
      if (!paired) { if (!cancelled) setPhase('pair'); return }
      await refresh()
      if (!cancelled) setPhase('ready')
    })()
    return () => { cancelled = true }
  }, [preferencesReady, refresh])

  useEffect(() => {
    if (phase !== 'ready' || !preferences.autoReconnect) return
    let disposed = false
    let timer = 0
    let delay = 3_000
    const schedule = (milliseconds: number) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(tick, milliseconds)
    }
    const tick = async () => {
      if (disposed) return
      if (document.visibilityState !== 'visible' || runId) { schedule(5_000); return }
      const wasOnline = online
      const ok = await refreshStatus()
      if (ok && !wasOnline) await refresh()
      delay = ok ? 15_000 : Math.min(delay * 2, 30_000)
      schedule(delay)
    }
    const wake = () => {
      delay = 3_000
      if (!runId) void refresh()
      schedule(3_000)
    }
    const sleep = () => window.clearTimeout(timer)
    const visibilityChanged = () => document.visibilityState === 'visible' ? wake() : sleep()
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', visibilityChanged)
    schedule(online ? 15_000 : delay)
    return () => {
      disposed = true
      window.clearTimeout(timer)
      window.removeEventListener('online', wake)
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }, [online, phase, preferences.autoReconnect, refresh, refreshStatus, runId])

  useEffect(() => {
    const container = messageList.current
    if (preferences.autoScroll && container && nearBottom.current) container.scrollTo({ top: container.scrollHeight, behavior: runId ? 'auto' : 'smooth' })
  }, [visibleMessages.length, latestMessageContent, preferences.autoScroll, runId])

  useEffect(() => {
    if (!preferences.autoScroll || !keyboardOpen || !nearBottom.current) return
    const timer = window.setTimeout(() => {
      const container = messageList.current
      container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [keyboardOpen, preferences.autoScroll])

  useEffect(() => {
    let active = true
    setDraftReadyFor('')
    if (!activeId || !preferences.persistDrafts) { setText(''); return }
    void readPrivateValue<string>(draftKey(activeId)).then((draft) => {
      if (!active) return
      setText(draft ?? '')
      setDraftReadyFor(activeId)
    })
    return () => { active = false }
  }, [activeId, preferences.persistDrafts])

  useEffect(() => {
    if (!preferences.persistDrafts || !activeId || draftReadyFor !== activeId) return
    const timer = window.setTimeout(() => {
      if (text) void writePrivateValue(draftKey(activeId), text)
      else void deletePrivateValue(draftKey(activeId))
    }, 240)
    return () => window.clearTimeout(timer)
  }, [activeId, draftReadyFor, preferences.persistDrafts, text])

  useEffect(() => {
    const input = textarea.current
    if (!input) return
    input.style.height = '42px'
    input.style.height = `${Math.min(110, Math.max(42, input.scrollHeight))}px`
  }, [text])

  useEffect(() => {
    const ready = () => setUpdateReady(true)
    window.addEventListener('nebula-mobile-update-ready', ready)
    return () => window.removeEventListener('nebula-mobile-update-ready', ready)
  }, [])

  useEffect(() => () => {
    streamAbort.current?.abort()
    void voiceController.current?.dispose()
    if (voiceSubmitTimer.current !== null) window.clearTimeout(voiceSubmitTimer.current)
    if (tokenFlushTimer.current !== null) window.clearTimeout(tokenFlushTimer.current)
  }, [])

  useEffect(() => {
    if (!drawerOpen && !searchOpen && !settingsOpen && !messageMenu && !conversationMenu && !modeMenuOpen) return
    const closeOverlay = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setDrawerOpen(false)
      setSearchOpen(false)
      setSearchText('')
      setSettingsOpen(false)
      setMessageMenu(null)
      setConversationMenu(null)
      setModeMenuOpen(false)
    }
    window.addEventListener('keydown', closeOverlay)
    return () => window.removeEventListener('keydown', closeOverlay)
  }, [conversationMenu, drawerOpen, messageMenu, modeMenuOpen, searchOpen, settingsOpen])

  useEffect(() => {
    const query = searchText.trim()
    if (!query || !online) { setSearchResults([]); return }
    const timer = window.setTimeout(() => {
      void searchConversations(query).then(setSearchResults).catch(() => setSearchResults([]))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [online, searchText])

  async function submitPairing(event: React.FormEvent) {
    event.preventDefault()
    if (pairCode.trim().length !== 6) return
    setPairing(true)
    setError('')
    try {
      await pairDevice(pairCode.trim(), 'Jonard iPhone')
      setPhase('ready')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pairing failed.')
    } finally {
      setPairing(false)
    }
  }

  async function beginNewConversation() {
    if (!online) return
    try {
      const created = await createConversation()
      const conversation: MobileConversation = {
        id: created.id, title: 'New chat', pinned: false, createdAt: now(), updatedAt: now(),
        messages: [message('assistant', 'Nebula online. What should we work on?', `boot-${created.id}`)],
      }
      setStore((current) => ({ ...current, activeId: created.id, sessions: [conversation, ...current.sessions] }))
      setActiveId(created.id)
      setDrawerOpen(false)
      setIntentMode('auto')
      setIncludeProjectContext(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create a conversation.')
    }
  }

  function applyRunEvent(event: RunEvent, conversationId: string) {
    if (event.type !== 'token') flushStreamingTokens()
    if (event.type === 'accepted') {
      setRunStatus('Thinking')
      return
    }
    if (event.type === 'status') {
      setRunStatus(assistantStatus(event.status))
      return
    }
    if (event.type === 'token') {
      const id = event.messageId || `assistant-${event.runId}`
      const token = event.token ?? ''
      assistantBuffer.current += token
      if (!preferences.streamResponses) return
      queueStreamingToken(conversationId, id, token)
      return
    }
    if (event.type === 'message' && event.content) {
      replaceConversation(conversationId, (conversation) => ({ ...conversation, updatedAt: now(), messages: [...conversation.messages, message('assistant', event.content!)] }))
      assistantBuffer.current += event.content
      return
    }
    if (event.type === 'tool_request') { if (preferences.showToolActivity) setRunStatus(`Using ${event.request?.tool?.replaceAll('_', ' ') ?? 'a tool'}`); return }
    if (event.type === 'tool_result') { if (preferences.showToolActivity) setRunStatus('Reading result'); return }
    if (event.type === 'source' && event.source) {
      setSourceCards((current) => {
        const existing = current[conversationId] ?? []
        if (existing.some((source) => source.url === event.source!.url)) return current
        return { ...current, [conversationId]: [...existing, event.source!] }
      })
      return
    }
    if (event.type === 'approval_required' && event.approval) {
      setApproval(event.approval)
      setRunStatus('Needs approval')
      void notifyHaptic(preferences.haptics && preferences.notifyOnApproval, false)
      return
    }
    if (event.type === 'approval_resolved') { setApproval(null); setConfirmation(''); return }
    if (event.type === 'error') setError(mobileErrorMessage((event as RunEvent & { code?: string }).code, event.message))
    if (event.type === 'cancelled') setRunStatus('Stopped')
  }

  async function executeRun(
    conversationId: string,
    content: string,
    submittedFiles: File[],
    mode: MobileRunMode = 'new',
    sourceMessageId?: string,
    requestedIntent: MobileIntentMode = 'auto',
    requestedProjectContext = false,
    voiceOrigin = false,
  ) {
    setRunStatus('Connecting')
    assistantBuffer.current = ''
    pendingTokenBuffer.current = ''
    pendingTokenMessageId.current = ''
    pendingTokenConversationId.current = ''
    nearBottom.current = true
    setShowScrollLatest(false)
    try {
      setSourceCards((current) => ({ ...current, [conversationId]: [] }))
      const run = await startRun(conversationId, content, submittedFiles, mode, sourceMessageId, requestedIntent, requestedProjectContext)
      setRunId(run.runId)
      const abort = new AbortController()
      streamAbort.current = abort
      await streamRun(run.runId, (event) => applyRunEvent(event, conversationId), abort.signal)
      if ((preferences.readAloud || (voiceOrigin && preferences.voiceSpeakVoiceReplies)) && assistantBuffer.current.trim()) {
        const controller = voiceController.current ?? new MobileVoiceController({ onPhase: setVoicePhase })
        voiceController.current = controller
        await controller.speak({
          text: assistantBuffer.current.replace(/```[\s\S]*?```/g, 'The full code is in chat.').replace(/[`*_>#]/g, '').slice(0, 1800),
          locale: preferences.voiceLanguage,
          rate: preferences.speechRate,
          pitch: preferences.speechPitch,
        }).catch(() => undefined)
      }
      await notifyHaptic(preferences.haptics && preferences.notifyOnComplete, true)
      await showCompletionNotification(preferences.notifyOnComplete && document.visibilityState !== 'visible', activeConversation?.title || 'Your response is ready')
      if (preferences.completionSound) playCompletionSound()
      await refresh()
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        const messageText = cause instanceof MobileApiError
          ? mobileErrorMessage(cause.code, cause.message)
          : cause instanceof Error ? cause.message : 'Nebula could not send that message.'
        setError(messageText)
      }
    } finally {
      flushStreamingTokens()
      setRunId('')
      setRunStatus('')
      streamAbort.current = null
      setApproval(null)
    }
  }

  async function send(contentOverride?: string, voiceOrigin = false) {
    const content = (contentOverride ?? text).trim()
    if ((!content && attachments.length === 0) || runId || !online) return
    setError('')
    voiceCaptureActive.current = false
    if (voiceSubmitTimer.current !== null) window.clearTimeout(voiceSubmitTimer.current)
    let conversationId = activeConversation?.id
    if (!conversationId) {
      try {
        const created = await createConversation()
        conversationId = created.id
        const conversation: MobileConversation = { id: conversationId, title: 'New chat', pinned: false, createdAt: now(), updatedAt: now(), messages: [] }
        setStore((current) => ({ ...current, sessions: [conversation, ...current.sessions], activeId: conversationId! }))
        setActiveId(conversationId)
      } catch (cause) {
        setOnline(false)
        setError(cause instanceof MobileApiError ? mobileErrorMessage(cause.code, cause.message) : 'Could not create a conversation.')
        return
      }
    }
    const submittedFiles = attachments
    const submittedIntent = intentMode
    const submittedProjectContext = includeProjectContext
    const display = content || `Attached ${submittedFiles.map((file) => file.name).join(', ')}`
    const optimisticAttachments: MobileAttachment[] = submittedFiles.map((file) => ({
      id: `pending-${crypto.randomUUID()}`, kind: 'file', label: file.name, mimeType: file.type,
    }))
    const userMessage = { ...message('user', display), attachments: optimisticAttachments }
    replaceConversation(conversationId, (conversation) => ({
      ...conversation,
      title: conversation.title === 'New chat' ? display.slice(0, 54) : conversation.title,
      updatedAt: now(), messages: [...conversation.messages, userMessage],
    }))
    setText('')
    setAttachments([])
    setIntentMode('auto')
    setIncludeProjectContext(false)
    setDraftReadyFor(conversationId)
    void deletePrivateValue(draftKey(conversationId))
    await executeRun(conversationId, content || display, submittedFiles, 'new', undefined, submittedIntent, submittedProjectContext, voiceOrigin)
  }

  async function rerun(source: MobileMessage, mode: Exclude<MobileRunMode, 'new'>) {
    if (!online || runId || !activeConversation || source.role !== 'user') return
    const sourceIndex = activeConversation.messages.findIndex((item) => item.id === source.id)
    if (sourceIndex < 0) return
    setMessageMenu(null)
    setError('')
    replaceConversation(activeConversation.id, (conversation) => ({
      ...conversation, updatedAt: now(), messages: conversation.messages.slice(0, sourceIndex + 1),
    }))
    await executeRun(activeConversation.id, source.content, [], mode, source.id, intentMode, includeProjectContext)
  }

  function sourceUserFor(item: MobileMessage) {
    if (item.role === 'user') return item
    const index = activeConversation?.messages.findIndex((message) => message.id === item.id) ?? -1
    if (index < 0) return undefined
    return activeConversation?.messages.slice(0, index).reverse().find((message) => message.role === 'user')
  }

  async function performMessageAction(action: 'copy' | 'share' | 'rerun') {
    const selected = messageMenu
    if (!selected) return
    try {
      if (action === 'copy') await copyText(selected.content)
      else if (action === 'share') await shareText(selected.content)
      else {
        const source = sourceUserFor(selected)
        if (source) await rerun(source, selected.role === 'assistant' ? 'regenerate' : 'retry')
      }
      setMessageMenu(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That action could not be completed.')
    }
  }

  async function stop() {
    if (!runId) return
    const activeRunId = runId
    setRunStatus('Stopping')
    setApproval(null)
    const cancellation = cancelRun(activeRunId)
    streamAbort.current?.abort()
    try { await cancellation } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nebula could not confirm cancellation with your PC.')
    }
  }

  async function answerApproval(approved: boolean) {
    if (!approval || !runId) return
    if (approval.requiresTypedConfirm && approved && confirmation !== 'CONFIRM') return
    try {
      await decideApproval(approval.id, runId, approved, approval.requiresTypedConfirm ? confirmation : undefined)
      setApproval(null)
      setConfirmation('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit that decision.')
    }
  }

  async function toggleVoice(forceOnline = false) {
    if (voicePhase === 'speaking') {
      await voiceController.current?.stopSpeaking()
    }
    if (listening) {
      await voiceController.current?.stop()
      return
    }
    if (voiceSubmitTimer.current !== null) window.clearTimeout(voiceSubmitTimer.current)
    voiceFinalText.current = ''
    voiceCaptureActive.current = true
    setVoiceFailure(null)
    setError('')
    const controller = new MobileVoiceController({
      onPhase: (next) => {
        setVoicePhase(next)
        setListening(next === 'listening')
      },
      onInterim: (interim) => setText(`${voiceFinalText.current}${voiceFinalText.current && interim ? ' ' : ''}${interim}`),
      onFinal: (finalText) => {
        voiceFinalText.current = finalText.trim()
        setText(voiceFinalText.current)
      },
      onEnd: () => {
        if (!voiceCaptureActive.current) return
        voiceCaptureActive.current = false
        setListening(false)
        const finalText = voiceFinalText.current.trim()
        if (!preferences.voiceAutoSubmit || !finalText || runId) return
        setVoicePhase('submit_countdown')
        voiceSubmitTimer.current = window.setTimeout(() => {
          setVoicePhase('thinking')
          void send(finalText, true)
        }, preferences.voiceSilenceMs || 1200)
      },
      onError: (failure) => {
        voiceCaptureActive.current = false
        if (failure.code === 'cancelled') return
        setVoiceFailure(failure)
        setVoicePhase('error')
        setListening(false)
        setError(failure.message)
      },
    })
    await voiceController.current?.dispose()
    voiceController.current = controller
    try {
      await controller.start({ locale: preferences.voiceLanguage || navigator.language || 'en-US', allowOnline: forceOnline || preferences.voiceOnlineConsent })
    } catch (cause) {
      voiceCaptureActive.current = false
      const failure = cause as MobileVoiceFailure
      setVoiceFailure(failure)
      setVoicePhase('error')
      setListening(false)
      setError(failure.message)
    }
  }

  function onFiles(files: FileList | null) {
    if (!files) return
    const selected = Array.from(files).filter((file) => file.size <= 5 * 1024 * 1024).slice(0, 6)
    if (selected.reduce((total, file) => total + file.size, 0) > 8 * 1024 * 1024) {
      setError('Attachments must total 8 MB or less.')
      return
    }
    setAttachments(selected)
    setModeMenuOpen(false)
  }

  function chooseIntent(next: MobileIntentMode, available: boolean) {
    if (!available) return
    setIntentMode((current) => current === next ? 'auto' : next)
    setModeMenuOpen(false)
    void impact(preferences.haptics)
  }

  function handleMessageScroll() {
    const container = messageList.current
    if (!container) return
    const closeToBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 72
    nearBottom.current = closeToBottom
    setShowScrollLatest(!closeToBottom)
  }

  function scrollToLatest() {
    nearBottom.current = true
    setShowScrollLatest(false)
    const container = messageList.current
    container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
  }

  function beginEdgeGesture(event: React.TouchEvent) {
    const touch = event.touches[0]
    if (!touch || drawerOpen || touch.clientX > 30) return
    edgeGesture.current = { x: touch.clientX, y: touch.clientY, active: true }
  }

  function moveEdgeGesture(event: React.TouchEvent) {
    const start = edgeGesture.current
    const touch = event.touches[0]
    if (!start?.active || !touch) return
    if (Math.abs(touch.clientY - start.y) > Math.abs(touch.clientX - start.x)) start.active = false
  }

  function finishEdgeGesture(event: React.TouchEvent) {
    const start = edgeGesture.current
    const touch = event.changedTouches[0]
    edgeGesture.current = null
    if (start?.active && touch && touch.clientX - start.x > 70) setDrawerOpen(true)
  }

  function beginDrawerGesture(event: React.TouchEvent) {
    const touch = event.touches[0]
    if (touch) drawerGesture.current = { x: touch.clientX, y: touch.clientY, active: true }
  }

  function moveDrawerGesture(event: React.TouchEvent) {
    const start = drawerGesture.current
    const touch = event.touches[0]
    if (!start?.active || !touch) return
    if (Math.abs(touch.clientY - start.y) > Math.abs(touch.clientX - start.x)) start.active = false
  }

  function finishDrawerGesture(event: React.TouchEvent) {
    const start = drawerGesture.current
    const touch = event.changedTouches[0]
    drawerGesture.current = null
    if (start?.active && touch && touch.clientX - start.x < -65) setDrawerOpen(false)
  }

  async function applyConversationChange(change: { title?: string; pinned?: boolean }) {
    if (!conversationMenu) return
    try {
      const updated = await updateConversation(conversationMenu.id, change)
      setStore((current) => ({ ...current, sessions: current.sessions.map((item) => item.id === updated.id ? { ...item, ...updated } : item) }))
      setConversationMenu(null)
      setRenameMode(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update that chat.')
    }
  }

  async function removeConversation() {
    if (!conversationMenu) return
    try {
      const removedId = conversationMenu.id
      const result = await deleteConversation(removedId)
      setStore((current) => ({ ...current, activeId: result.activeId, sessions: current.sessions.filter((item) => item.id !== removedId) }))
      setActiveId(result.activeId)
      void deletePrivateValue(draftKey(removedId))
      setConversationMenu(null)
      setDeleteConfirm(false)
      if (!result.activeId) await beginNewConversation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete that chat.')
    }
  }

  async function activateUpdate() {
    const registration = await navigator.serviceWorker?.getRegistration()
    if (!registration?.waiting) { window.location.reload(); return }
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
    registration.waiting.postMessage({ type: 'SKIP_WAITING' })
  }

  if (phase === 'boot' || !preferencesReady) {
    return <main className="mobile-stage center-stage"><div className="boot-mark"><img src="/nebula-icon.png" alt="" /><span /></div><p>Waking Nebula</p></main>
  }

  if (phase === 'pair') {
    return (
      <main className="mobile-stage center-stage pair-stage">
        <div className="cosmic-haze" aria-hidden="true" />
        <section className="pair-card liquid-panel">
          <img className="pair-logo" src="/nebula-icon.png" alt="" />
          <p className="eyebrow">PRIVATE COMPANION</p>
          <h1>Connect to Nebula</h1>
          <p className="pair-copy">Generate a six-digit pairing code from Mobile Connection on your PC, then enter it here.</p>
          <form onSubmit={submitPairing}>
            <input
              className="pair-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              value={pairCode} onChange={(event) => setPairCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000" aria-label="Pairing code" autoFocus
            />
            <button className="primary-button" disabled={pairCode.length !== 6 || pairing}>{pairing ? 'Pairing...' : 'Connect privately'}</button>
          </form>
          {error && <p className="inline-error" role="alert">{error}</p>}
          <p className="privacy-note">Your prompts remain between this device and your PC through your private Tailscale network.</p>
        </section>
      </main>
    )
  }

  return (
    <main
      className={`mobile-stage chat-stage ${keyboardOpen ? 'chat-keyboard-open' : ''}`}
      onTouchStart={beginEdgeGesture} onTouchMove={moveEdgeGesture} onTouchEnd={finishEdgeGesture}
    >
      <div className="ambient-field" aria-hidden="true"><span /><span /><span /><span /></div>
      <header className="mobile-header">
        <button className="header-control" onClick={() => setDrawerOpen(true)} aria-label="Open conversations"><Menu size={22} /></button>
        <button className="chat-title" onClick={() => setSearchOpen(true)} aria-label="Search conversations">
          <span>Chat <ChevronDown size={17} /></span>
          <small><i className={online ? 'online-dot' : 'offline-dot'} />{preferences.showModelName && runtime.model ? runtime.model : online ? assistantStatus(runtime.agentStatus) : 'PC offline'}</small>
        </button>
        <button className="header-control" onClick={() => void beginNewConversation()} disabled={!online} aria-label="New conversation"><SquarePen size={21} /></button>
      </header>

      {!online && <div className="offline-banner"><WifiOff size={15} /> Cached history. Wake your PC and open Nebula to continue.</div>}
      {showInstallHint && <div className="install-banner liquid-panel"><span>Install Nebula from Safari: Share, then Add to Home Screen.</span><button onClick={() => setShowInstallHint(false)} aria-label="Dismiss"><X size={15} /></button></div>}
      {updateReady && <div className="update-banner"><span>A Nebula update is ready.</span><button onClick={() => void activateUpdate()}>Update</button></div>}
      {preferences.showDiagnostics && (
        <div className="mobile-diagnostics-strip" role="status">
          <span>{online ? 'Bridge online' : 'Bridge offline'}</span>
          <span>{runtime.agentStatus || 'idle'}</span>
          <span>{runtime.model ? 'Model ready' : 'No active model'}</span>
        </div>
      )}

      <section ref={messageList} onScroll={handleMessageScroll} className={`message-list ${visibleMessages.length === 0 ? 'empty-list' : ''}`}>
        {visibleMessages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-orb"><img src="/nebula-icon.png" alt="" /></div>
            <p className="eyebrow">NEBULA IS READY</p>
            <h1>What should we work on?</h1>
            <p>Your PC handles the model, memory, and tools. This is the quiet window into it.</p>
          </div>
        ) : visibleMessages.map((item) => <Message key={item.id} message={item} showTimestamp={preferences.showTimestamps} onMenu={setMessageMenu} />)}
        {activeSources.length > 0 && <SourceCards sources={activeSources} onError={setError} />}
        {runId && runStatus && <div className="run-status"><span /><span /><span />{runStatus}</div>}
      </section>

      {showScrollLatest && <button className="scroll-latest" onClick={scrollToLatest} aria-label="Scroll to latest message"><ArrowDown size={18} /></button>}

      {error && <div className="toast-error" role="alert"><span>{error}</span>{voiceFailure?.requiresOnlineConsent && <button onClick={() => { patchPreferences({ voiceOnlineConsent: true }); void toggleVoice(true) }}>Allow online</button>}{voiceFailure?.code.includes('denied') && <button onClick={() => void voiceController.current?.openSettings()}>Settings</button>}<button onClick={() => { setError(''); setVoiceFailure(null) }} aria-label="Dismiss error"><X size={15} /></button></div>}

      <footer className="composer-wrap">
        {attachments.length > 0 && <div className="attachment-strip">{attachments.map((file) => <PendingAttachment key={`${file.name}-${file.size}-${file.lastModified}`} file={file} onRemove={() => setAttachments((current) => current.filter((item) => item !== file))} />)}</div>}
        <div className={`mobile-composer liquid-panel ${listening ? 'composer-listening' : ''}`}>
          {(intentMode !== 'auto' || includeProjectContext) && <div className="composer-context-row">
            {intentMode !== 'auto' && <button onClick={() => setIntentMode('auto')}><Sparkles size={12} />{INTENT_LABELS[intentMode]}<X size={11} /></button>}
            {includeProjectContext && <button onClick={() => setIncludeProjectContext(false)}><FolderSearch size={12} />{runtime.activeProject?.name || 'Project Context'}<X size={11} /></button>}
          </div>}
          <div className="composer-main" onPointerDown={(event) => { if (!(event.target as HTMLElement).closest('button, textarea')) textarea.current?.focus() }}>
            <button className="composer-button composer-add" onClick={() => setModeMenuOpen(true)} disabled={!online || Boolean(runId)} aria-label="Add tools and context"><Plus size={22} /></button>
            <textarea
              ref={textarea}
              value={text} onChange={(event) => { if (voiceSubmitTimer.current !== null) window.clearTimeout(voiceSubmitTimer.current); if (voicePhase === 'submit_countdown') setVoicePhase('idle'); setText(event.target.value) }}
              placeholder={online ? 'Ask Nebula' : 'PC offline'} disabled={!online || Boolean(runId)} rows={1}
              onKeyDown={(event) => { if (event.key === 'Enter' && preferences.submitOnEnter && !event.shiftKey) { event.preventDefault(); void send() } }}
            />
            <button className={`composer-button ${listening ? 'active' : ''}`} onClick={() => void toggleVoice()} disabled={!online || Boolean(runId)} aria-label="Voice input"><Mic size={20} /></button>
            {runId ? (
              <button className="send-button stop-button" onClick={() => void stop()} aria-label="Stop Nebula"><Square size={15} fill="currentColor" /></button>
            ) : (
              <button className="send-button" onClick={() => void send()} disabled={!online || (!text.trim() && attachments.length === 0)} aria-label="Send"><Send size={18} /></button>
            )}
          </div>
          <input ref={fileInput} type="file" multiple accept="image/png,image/jpeg,image/webp,text/*,.md,.json,.ts,.tsx,.js,.jsx,.css,.html,.pdf" hidden onChange={(event) => onFiles(event.target.files)} />
        </div>
      </footer>

      {modeMenuOpen && <div className="sheet-backdrop action-backdrop" onPointerDown={(event) => { if (event.currentTarget === event.target) setModeMenuOpen(false) }}>
        <section className="mode-sheet liquid-panel" aria-label="Nebula modes">
          <div className="sheet-grabber" />
          <div className="mode-sheet-title"><div><span>TOOLS & CONTEXT</span><strong>How should Nebula help?</strong></div><button onClick={() => setModeMenuOpen(false)} aria-label="Close modes"><X size={18} /></button></div>
          <div className="mode-grid">
            <ModeButton icon={<Globe2 size={19} />} label="Web Search" detail="Current answers with sources" active={intentMode === 'web_search'} enabled={capabilities.webSearch} onClick={() => chooseIntent('web_search', capabilities.webSearch)} />
            <ModeButton icon={<Search size={19} />} label="Deep Research" detail="Compare multiple public sources" active={intentMode === 'deep_research'} enabled={capabilities.deepResearch} onClick={() => chooseIntent('deep_research', capabilities.deepResearch)} />
            <ModeButton icon={<Brain size={19} />} label="Deep Thinking" detail="Stronger reasoning and review" active={intentMode === 'deep_thinking'} enabled={capabilities.deepThinking} onClick={() => chooseIntent('deep_thinking', capabilities.deepThinking)} />
            <ModeButton icon={<FolderSearch size={19} />} label="Project Search" detail={runtime.activeProject?.name || 'Open a project on your PC'} active={intentMode === 'project_search'} enabled={capabilities.projectSearch} onClick={() => chooseIntent('project_search', capabilities.projectSearch)} />
            <ModeButton icon={<GraduationCap size={19} />} label="Guided Learning" detail="Step-by-step explanations" active={intentMode === 'guided_learning'} enabled={capabilities.guidedLearning} onClick={() => chooseIntent('guided_learning', capabilities.guidedLearning)} />
            <ModeButton icon={<Waypoints size={19} />} label="Personal Intelligence" detail="Use relevant memory and preferences" active={intentMode === 'personal_intelligence'} enabled={capabilities.personalIntelligence} onClick={() => chooseIntent('personal_intelligence', capabilities.personalIntelligence)} />
          </div>
          <div className="mode-sheet-actions">
            <button disabled={!capabilities.projectContext} className={includeProjectContext ? 'active' : ''} onClick={() => { setIncludeProjectContext((current) => !current); setModeMenuOpen(false); void impact(preferences.haptics) }}><FolderSearch size={18} /><span><strong>Project Context</strong><small>{runtime.activeProject?.name || 'No project selected on PC'}</small></span>{includeProjectContext && <Check size={16} />}</button>
            <button onClick={() => fileInput.current?.click()}><Paperclip size={18} /><span><strong>Attach Photo or File</strong><small>Up to 6 files, 8 MB total</small></span></button>
          </div>
        </section>
      </div>}

      {drawerOpen && <div className="sheet-backdrop" onPointerDown={(event) => { if (event.currentTarget === event.target) setDrawerOpen(false) }}>
        <aside className="conversation-sheet liquid-panel" onTouchStart={beginDrawerGesture} onTouchMove={moveDrawerGesture} onTouchEnd={finishDrawerGesture}>
          <div className="sheet-grabber" />
          <div className="sheet-title"><div><p className="eyebrow">NEBULA</p><h2>Chats</h2></div><button className="icon-button" onClick={() => setDrawerOpen(false)} aria-label="Close conversations"><X size={19} /></button></div>
          <button className="new-chat-button" onClick={() => void beginNewConversation()}><SquarePen size={17} /> New chat</button>
          <button className="search-row" onClick={() => { setDrawerOpen(false); setSearchOpen(true) }}><Search size={16} /> Search conversations</button>
          <div className="conversation-list">{store.sessions.map((conversation) => (
            <div key={conversation.id} className={`conversation-row ${conversation.id === activeConversation?.id ? 'selected' : ''}`}>
              <button className="conversation-select" onClick={() => { setActiveId(conversation.id); setDrawerOpen(false) }}>
                <span><strong>{conversation.pinned && <Pin size={11} fill="currentColor" />} {conversation.title}</strong><small>{conversation.messages.find((item) => item.role === 'user')?.content || 'New conversation'}</small></span>
                <time>{relativeTime(conversation.updatedAt)}</time>
              </button>
              <button className="conversation-more" onClick={() => { setConversationMenu(conversation); setRenameTitle(conversation.title); setRenameMode(false); setDeleteConfirm(false) }} aria-label={`Options for ${conversation.title}`}><MoreHorizontal size={17} /></button>
            </div>
          ))}</div>
          <div className="sheet-footer">
            <button onClick={() => { setDrawerOpen(false); setSettingsOpen(true) }}><Settings size={17} /> Settings</button>
          </div>
        </aside>
      </div>}

      {settingsOpen && <MobileSettingsScreen
        preferences={preferences} online={online} runtime={runtime}
        onChange={patchPreferences} onClose={() => setSettingsOpen(false)}
        onUnpair={() => void unpairDevice().then(() => { setSettingsOpen(false); setPhase('pair') })}
      />}

      {searchOpen && <div className="full-overlay">
        <div className="search-header liquid-bar"><button className="icon-button" onClick={() => { setSearchOpen(false); setSearchText('') }}><X size={20} /></button><div><Search size={17} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search your chats" autoFocus /></div></div>
        <div className="search-results">{searchResults.map((result) => <button key={result.conversationId} onClick={() => { setActiveId(result.conversationId); setSearchOpen(false); setSearchText('') }}><strong>{result.title}</strong><span>{result.excerpt}</span><time>{relativeTime(result.updatedAt)}</time></button>)}{searchText && searchResults.length === 0 && <p>No matching conversations.</p>}</div>
      </div>}

      {approval && <div className="sheet-backdrop approval-backdrop">
        <section className="approval-sheet liquid-panel">
          <div className="approval-symbol"><Check size={20} /></div>
          <p className="eyebrow">APPROVAL REQUIRED</p>
          <h2>{approval.toolRequest.tool.replaceAll('_', ' ')}</h2>
          <p>{approval.reason}</p>
          <pre>{JSON.stringify(approval.toolRequest.args, null, 2)}</pre>
          <span className={`risk-badge risk-${approval.riskLevel}`}>{approval.riskLevel.replaceAll('_', ' ')}</span>
          {approval.requiresTypedConfirm && <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Type CONFIRM" autoCapitalize="characters" />}
          <div className="approval-actions"><button onClick={() => void answerApproval(false)}>Reject</button><button className="approve" disabled={approval.requiresTypedConfirm && confirmation !== 'CONFIRM'} onClick={() => void answerApproval(true)}>Approve</button></div>
        </section>
      </div>}

      {messageMenu && <div className="sheet-backdrop action-backdrop" onPointerDown={(event) => { if (event.currentTarget === event.target) setMessageMenu(null) }}>
        <section className="action-sheet">
          <div className="sheet-grabber" />
          <p className="action-preview">{messageMenu.content}</p>
          <button onClick={() => void performMessageAction('copy')}><Copy size={18} /> Copy</button>
          <button onClick={() => void performMessageAction('share')}><Share2 size={18} /> Share</button>
          <button onClick={() => void performMessageAction('rerun')} disabled={!online || Boolean(runId)}><RotateCcw size={18} /> {messageMenu.role === 'assistant' ? 'Regenerate' : 'Retry'}</button>
          <button className="action-cancel" onClick={() => setMessageMenu(null)}>Cancel</button>
        </section>
      </div>}

      {conversationMenu && <div className="sheet-backdrop action-backdrop" onPointerDown={(event) => { if (event.currentTarget === event.target) setConversationMenu(null) }}>
        <section className="action-sheet conversation-actions-sheet">
          <div className="sheet-grabber" />
          {renameMode ? <>
            <label htmlFor="rename-chat">Rename chat</label>
            <input id="rename-chat" value={renameTitle} onChange={(event) => setRenameTitle(event.target.value.slice(0, 96))} autoFocus />
            <button className="action-primary" disabled={!renameTitle.trim()} onClick={() => void applyConversationChange({ title: renameTitle.trim() })}><Check size={18} /> Save name</button>
          </> : deleteConfirm ? <>
            <strong>Delete “{conversationMenu.title}”?</strong>
            <p>This removes the conversation from your PC and phone.</p>
            <button className="action-danger" onClick={() => void removeConversation()}><Trash2 size={18} /> Delete chat</button>
          </> : <>
            <strong>{conversationMenu.title}</strong>
            <button onClick={() => setRenameMode(true)}><Pencil size={18} /> Rename</button>
            <button onClick={() => void applyConversationChange({ pinned: !conversationMenu.pinned })}><Pin size={18} /> {conversationMenu.pinned ? 'Unpin' : 'Pin'} chat</button>
            <button className="action-danger-text" onClick={() => setDeleteConfirm(true)}><Trash2 size={18} /> Delete</button>
          </>}
          <button className="action-cancel" onClick={() => setConversationMenu(null)}>Cancel</button>
        </section>
      </div>}
    </main>
  )
}

function ModeButton({ icon, label, detail, active, enabled, onClick }: {
  icon: React.ReactNode
  label: string
  detail: string
  active: boolean
  enabled: boolean
  onClick: () => void
}) {
  return <button className={`mode-option ${active ? 'active' : ''}`} disabled={!enabled} onClick={onClick}>
    <i>{icon}</i>
    <span><strong>{label}</strong><small>{enabled ? detail : `${detail} - unavailable`}</small></span>
    {active && <Check size={16} />}
  </button>
}

function SourceCards({ sources, onError }: { sources: MobileSourceCard[]; onError: (message: string) => void }) {
  return <section className="mobile-source-section" aria-label="Sources">
    <div className="source-heading"><Link2 size={14} /><span>Sources</span><small>{sources.length}</small></div>
    <div className="source-card-row">{sources.map((source) => {
      let domain = 'Source'
      try { domain = new URL(source.url).hostname.replace(/^www\./, '') } catch { /* The bridge already validates source URLs. */ }
      return <button key={source.id} className="mobile-source-card" onClick={() => void openPublicSource(source.url).catch((error) => onError(error instanceof Error ? error.message : 'Could not open that source.'))}>
        <span className="source-domain"><Globe2 size={12} />{domain}</span>
        <strong>{source.title}</strong>
        <p>{source.snippet || 'Open the public source.'}</p>
        {source.dateChecked && <time>{new Date(source.dateChecked).toLocaleDateString()}</time>}
      </button>
    })}</div>
  </section>
}

function Message({ message: item, showTimestamp, onMenu }: { message: MobileMessage; showTimestamp: boolean; onMenu: (message: MobileMessage) => void }) {
  const holdTimer = useRef(0)
  const holdStart = useRef<{ x: number; y: number } | null>(null)
  if (item.role === 'tool') return null
  const timestamp = item.createdAt ? new Date(item.createdAt) : null
  const timeLabel = timestamp && Number.isFinite(timestamp.getTime())
    ? timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : ''
  return (
    <article
      className={`mobile-message message-${item.role}`} tabIndex={0}
      onPointerDown={(event) => {
        holdStart.current = { x: event.clientX, y: event.clientY }
        holdTimer.current = window.setTimeout(() => onMenu(item), 460)
      }}
      onPointerMove={(event) => {
        const start = holdStart.current
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) window.clearTimeout(holdTimer.current)
      }}
      onPointerUp={() => window.clearTimeout(holdTimer.current)}
      onPointerCancel={() => window.clearTimeout(holdTimer.current)}
      onContextMenu={(event) => { event.preventDefault(); onMenu(item) }}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onMenu(item) }}
    >
      {item.role === 'assistant' && <img src="/nebula-icon.png" alt="" />}
      <div>
        <p>{item.content}</p>
        {item.attachments && item.attachments.length > 0 && <div className="message-attachments">{item.attachments.map((attachment) => <StoredAttachment key={attachment.id} attachment={attachment} />)}</div>}
        {showTimestamp && timeLabel && <time>{timeLabel}</time>}
      </div>
    </article>
  )
}

function playCompletionSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const context = new AudioContextClass()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.value = 660
    gain.gain.setValueAtTime(0.035, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.12)
  } catch { /* Sound feedback is optional. */ }
}

function PendingAttachment({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [preview, setPreview] = useState('')
  useEffect(() => {
    if (!file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  return <span className="pending-attachment">
    {preview ? <img src={preview} alt="" /> : <FileText size={15} />}
    <b>{file.name}</b>
    <button onClick={onRemove} aria-label={`Remove ${file.name}`}><X size={12} /></button>
  </span>
}

function StoredAttachment({ attachment }: { attachment: MobileAttachment }) {
  const [preview, setPreview] = useState('')
  const image = attachment.mimeType?.startsWith('image/') && !attachment.id.startsWith('pending-')
  useEffect(() => {
    let active = true
    let url = ''
    if (!image) return
    void getAttachmentBlob(attachment.id).then((blob) => {
      if (!active) return
      url = URL.createObjectURL(blob)
      setPreview(url)
    }).catch(() => undefined)
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [attachment.id, image])
  return <div className={`stored-attachment ${preview ? 'stored-image' : ''}`}>
    {preview ? <img src={preview} alt={attachment.label} /> : <FileText size={15} />}
    <span>{attachment.label}</span>
  </div>
}
