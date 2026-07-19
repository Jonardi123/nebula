import { CheckCircle2, Code2, Files, FolderOpen, Globe2, Mic, Plus, Search, Send, Sparkles, Waypoints, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage } from '../types/agent'
import type { AgentStatus } from '../types/agent'
import type { ComposerAttachment, DailyBrief, ModelInfo, WorkspaceAwarenessSnapshot } from '../types/nebula'
import { MessageBubble } from './MessageBubble'
import { listProviderModelInfos } from '../lib/lmstudio'
import { open } from '@tauri-apps/plugin-dialog'
import type { AppSettings } from '../types/settings'
import { getDailyBrief } from '../lib/dailyBrief'
import { NebulaGlyph } from './NebulaGlyph'
import { getEnabledToolNames } from '../skills'
import { publicRunStageForStatus, publicRunStageLabel } from '../lib/publicRunStage'
import type { UserFacingError } from '../lib/nebulaError'
import { VoiceRecognitionService } from '../lib/voiceRecognition'
import { recordVoiceDiagnostic } from '../lib/voiceDiagnostics'
import type { VoiceFailure } from '../types/voice'

interface Props {
  messages: ChatMessage[]
  disabled: boolean
  onSend: (content: string, attachments?: ComposerAttachment[]) => void
  onDraftChange?: (content: string) => void
  projectName?: string
  agentStatus?: AgentStatus
  contextUsage?: number
  workspaceAwareness?: WorkspaceAwarenessSnapshot | null
  onQuickAction?: (actionId: string, target?: string, source?: string) => void
  settings: AppSettings
  onSettingsChange: (settings: AppSettings) => void
  recovery?: UserFacingError | null
  recoveryBusy?: boolean
  onRecovery?: () => void
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function ChatPanel({
  messages,
  disabled,
  onSend,
  onDraftChange,
  projectName,
  agentStatus = 'idle',
  contextUsage = 0,
  workspaceAwareness,
  onQuickAction,
  settings,
  onSettingsChange,
  recovery,
  recoveryBusy = false,
  onRecovery,
}: Props) {
  const [text, setText] = useState('')
  const [lmModels, setLmModels] = useState<ModelInfo[]>([])
  const [routerModels, setRouterModels] = useState<ModelInfo[]>([])
  const [openRouterModels, setOpenRouterModels] = useState<ModelInfo[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [openMenu, setOpenMenu] = useState<'add' | 'search' | null>(null)
  const [activeMode, setActiveMode] = useState<'web' | 'deep' | 'local' | ''>('')
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const [listening, setListening] = useState(false)
  const [voiceFailure, setVoiceFailure] = useState<VoiceFailure | null>(null)
  const [dailyBrief, setDailyBrief] = useState<DailyBrief | null>(() => getDailyBrief())
  const recognitionRef = useRef<VoiceRecognitionService | null>(null)
  const voiceBaseTextRef = useRef('')
  const voiceSubmitTimerRef = useRef<number | null>(null)
  const composerRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const visibleMessages = useMemo(() => messages.filter((message) => message.role !== 'system'), [messages])
  const hasOnlyBootGreeting =
    visibleMessages.length === 1 &&
    visibleMessages[0]?.role === 'assistant' &&
    /^Nebula online\./i.test(visibleMessages[0].content.trim())
  const displayMessages = (hasOnlyBootGreeting ? [] : visibleMessages).filter((message, index, list) => {
    const isLast = index === list.length - 1
    return !(disabled && isLast && message.role === 'assistant' && !message.content.trim())
  })
  const isEmptyThread = displayMessages.length === 0
  const projectLabel = projectName || workspaceAwareness?.projectName || 'Choose project'
  const currentFilePath = workspaceAwareness?.openedFile?.trim() || ''
  const webSearchAvailable = getEnabledToolNames().has('web_search')
  const advancedMode = settings.experienceMode === 'advanced'
  const publicStage = publicRunStageForStatus(agentStatus)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = '30px'
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 30), 120)}px`
  }, [text])

  const configuredLmModels = useMemo(() => {
    const ids = [
      settings.modelAssignments?.daily,
      settings.fastModel,
      settings.model,
      settings.modelAssignments?.code,
      settings.codeModel,
      settings.modelAssignments?.review,
      settings.reviewModel,
    ]
      .map((model) => model?.trim())
      .filter((model): model is string => Boolean(model))

    return Array.from(new Set(ids)).map((id) => {
      const listed = lmModels.find((model) => model.id === id)
      return listed ?? {
        id,
        displayName: id,
        loaded: false,
        capabilities: [],
      }
    })
  }, [
    lmModels,
    settings.model,
    settings.fastModel,
    settings.codeModel,
    settings.reviewModel,
    settings.modelAssignments?.daily,
    settings.modelAssignments?.code,
    settings.modelAssignments?.review,
  ])

  const lmChoices = useMemo(() => {
    const byId = new Map<string, ModelInfo>()
    for (const model of [...configuredLmModels, ...lmModels]) byId.set(model.id, model)
    return Array.from(byId.values()).slice(0, 12)
  }, [configuredLmModels, lmModels])
  const routerChoices = routerModels
  const openRouterChoices = openRouterModels
  const activeModelValue = `${settings.modelProvider ?? 'lmstudio'}::${
    settings.modelProvider === '9router'
      ? (settings.nineRouterModel || settings.model)
      : settings.modelProvider === 'openrouter'
        ? (settings.openRouterModel || settings.model)
        : settings.singleModelEnabled
          ? (settings.singleModel || settings.model)
          : settings.model
  }`
  const visibleModelValue = settings.showModelDebugInfo || settings.modelMode !== 'auto' || settings.singleModelEnabled
    ? activeModelValue
    : 'nebula::auto'

  const refreshModelChoices = useCallback(async () => {
    setModelsLoading(true)
    try {
      const [lmNext, routerNext, openRouterNext] = await Promise.all([
        listProviderModelInfos(settings, 'lmstudio').catch(() => []),
        listProviderModelInfos(settings, '9router').catch(() => []),
        listProviderModelInfos(settings, 'openrouter').catch(() => []),
      ])
      setLmModels(lmNext)
      setRouterModels(routerNext)
      setOpenRouterModels(openRouterNext)
    } finally {
      setModelsLoading(false)
    }
  }, [settings])

  function selectModel(value: string) {
    if (value === 'nebula::auto') {
      onSettingsChange({ ...settings, modelMode: 'auto', singleModelEnabled: false })
      return
    }

    const [provider, ...modelParts] = value.split('::')
    const model = modelParts.join('::')
    if (!model || (provider !== 'lmstudio' && provider !== '9router' && provider !== 'openrouter')) return

    if (provider === 'lmstudio') {
      onSettingsChange({
        ...settings,
        modelProvider: 'lmstudio',
        modelMode: 'auto',
        model,
        singleModel: model,
        singleModelEnabled: true,
      })
      return
    }

    onSettingsChange({
      ...settings,
      modelProvider: provider,
      model,
      nineRouterModel: provider === '9router' ? model : settings.nineRouterModel,
      openRouterModel: provider === 'openrouter' ? model : settings.openRouterModel,
      modelMode: 'auto',
    })
  }

  function fillComposer(prefix: string) {
    setText((current) => current.trim() ? `${prefix}${current}` : prefix)
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }

  async function chooseFilesOrFolders(kind: 'files' | 'folder' = 'files') {
    setOpenMenu(null)
    try {
      const selected = await open({
        multiple: kind === 'files',
        directory: kind === 'folder',
        title: kind === 'folder' ? 'Select folder' : 'Select files',
      })
      const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
      if (paths.length === 0) return
      paths.forEach((path) => addAttachment({
        kind: kind === 'folder' ? 'folder' : 'file',
        label: path.split(/[\\/]/).filter(Boolean).at(-1) || path,
        path,
        detail: kind === 'folder' ? 'Folder context' : 'File context',
      }))
    } catch (error) {
      fillComposer(`File picker failed: ${error instanceof Error ? error.message : String(error)} `)
    }
  }

  async function startSpeechToText(forceOnline = false) {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
      setListening(false)
      return
    }
    if (voiceSubmitTimerRef.current !== null) window.clearTimeout(voiceSubmitTimerRef.current)
    voiceBaseTextRef.current = text.trim()
    setVoiceFailure(null)
    const service = new VoiceRecognitionService({
      language: settings.voiceLanguage || 'en-US',
      mode: forceOnline ? 'online' : (settings.voiceRecognitionMode || 'local_first'),
      allowOnline: forceOnline || settings.voiceOnlineConsent || settings.voiceRecognitionMode === 'online',
      callbacks: {
        onEngine: (engine, localAvailability) => recordVoiceDiagnostic({ supported: true, permission: 'granted', language: settings.voiceLanguage || 'en-US', engine, localAvailability }),
        onStart: () => setListening(true),
        onInterim: (interim) => {
          const prefix = voiceBaseTextRef.current
          setText(`${prefix}${prefix && interim ? ' ' : ''}${interim}`)
        },
        onFinal: (finalText) => {
          const prefix = voiceBaseTextRef.current
          const complete = `${prefix}${prefix && finalText ? ' ' : ''}${finalText}`.trim()
          setText(complete)
          voiceBaseTextRef.current = complete
          recordVoiceDiagnostic({ supported: true, permission: 'granted', language: settings.voiceLanguage || 'en-US', lastTranscriptAt: new Date().toISOString(), lastTranscriptPreview: finalText.slice(0, 120), lastError: undefined })
        },
        onError: (failure) => {
          setListening(false)
          setVoiceFailure(failure)
          recognitionRef.current = null
          recordVoiceDiagnostic({ supported: true, permission: failure.code.includes('denied') ? 'denied' : 'unknown', language: settings.voiceLanguage || 'en-US', lastErrorCode: failure.code, lastError: failure.message })
        },
        onEnd: () => {
          setListening(false)
          recognitionRef.current = null
          textareaRef.current?.focus()
          const complete = voiceBaseTextRef.current.trim()
          if (settings.voiceAutoSubmit && complete && !disabled) {
            voiceSubmitTimerRef.current = window.setTimeout(() => submitContent(complete), settings.voiceSilenceMs || 1200)
          }
        },
      },
    })
    recognitionRef.current = service
    try {
      await service.prepare()
      service.start()
    } catch (error) {
      const failure = error as VoiceFailure
      recognitionRef.current = null
      setListening(false)
      setVoiceFailure(failure)
    }
  }

  function chooseMode(mode: 'web' | 'deep' | 'local') {
    setOpenMenu(null)
    setActiveMode(mode)
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }

  function menuPrompt(prompt: string) {
    setOpenMenu(null)
    fillComposer(prompt)
  }

  function addAttachment(attachment: Omit<ComposerAttachment, 'id'>) {
    setAttachments((current) => {
      const duplicate = current.some((item) => item.kind === attachment.kind && item.path === attachment.path && item.label === attachment.label)
      return duplicate ? current : [...current, { ...attachment, id: crypto.randomUUID() }].slice(0, 12)
    })
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }

  function focusComposerSurface(event: { target: EventTarget | null; preventDefault: () => void }) {
    const element = event.target instanceof HTMLElement ? event.target : null
    if (element?.closest('button, select, textarea, input')) return
    event.preventDefault()
    textareaRef.current?.focus()
  }

  useEffect(() => {
    const refreshBrief = () => setDailyBrief(getDailyBrief())
    window.addEventListener('nebula-daily-brief-changed', refreshBrief)
    return () => window.removeEventListener('nebula-daily-brief-changed', refreshBrief)
  }, [])
  useEffect(() => {
    void refreshModelChoices()
  }, [refreshModelChoices])
  useEffect(() => () => {
    recognitionRef.current?.dispose()
    if (voiceSubmitTimerRef.current !== null) window.clearTimeout(voiceSubmitTimerRef.current)
  }, [])
  useEffect(() => {
    if (!openMenu) return
    function closeOnOutsideClick(event: MouseEvent) {
      if (composerRef.current?.contains(event.target as Node)) return
      setOpenMenu(null)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openMenu])

  function submitContent(rawContent: string) {
    if (disabled) return
    const content = rawContent.trim()
    if (!content) return
    const prefix = activeMode === 'web'
      ? '[WEB SEARCH]\nSearch the web for current sources, cite useful links, then answer. Query: '
      : activeMode === 'deep'
        ? '[DEEP RESEARCH]\nDo deeper multi-source research. Search broadly, compare sources, summarize findings, and cite links. Research goal: '
        : activeMode === 'local'
          ? '[LOCAL PROJECT SEARCH]\nSearch and inspect the active project before answering. Goal: '
          : ''
    setText('')
    setActiveMode('')
    const submittedAttachments = attachments
    setAttachments([])
    onSend(`${prefix}${content}`, submittedAttachments)
  }

  function submit() {
    submitContent(text)
  }

  return (
    <section className={`chat-shell codex-chat-shell flex min-h-0 flex-1 flex-col ${isEmptyThread ? 'codex-chat-empty' : 'codex-chat-active'}`}>
      <div className="nebula-thread codex-thread min-h-0 flex-1 overflow-auto px-5 py-5">
        {isEmptyThread ? (
          <div className="codex-empty-center">
            <div className="nebula-workspace-heading">
              <div className="nebula-orbit-mark" aria-hidden="true">
                <span className="nebula-orbit-core" />
                <span className="nebula-orbit-ring nebula-orbit-ring-one" />
                <span className="nebula-orbit-ring nebula-orbit-ring-two" />
              </div>
              <span className="nebula-workspace-kicker">Nebula</span>
            </div>
            <h1>{advancedMode ? 'What should we work on?' : 'How can I help?'}</h1>
            <p>{advancedMode ? `${greeting()}, Jonard. Nebula is ready.` : `${greeting()}, Jonard. Ask, research, create, or continue from your phone.`}</p>
            <div className="codex-empty-actions">
              {advancedMode ? <>
                <button type="button" onClick={() => onQuickAction?.('review-project', undefined, 'empty-state')}>
                  <Search size={14} />
                  <span><strong>Review project</strong><small>Inspect structure and risks</small></span>
                </button>
                <button type="button" onClick={() => onQuickAction?.('summarize-readme', undefined, 'empty-state')}>
                  <Files size={14} />
                  <span><strong>Summarize README</strong><small>Understand the active workspace</small></span>
                </button>
                <button type="button" onClick={() => onQuickAction?.('find-bugs', undefined, 'empty-state')}>
                  <Code2 size={14} />
                  <span><strong>Find bugs</strong><small>Scan code and verify findings</small></span>
                </button>
              </> : <>
                <button type="button" onClick={() => { setActiveMode('web'); setText('Look up the latest information about ') }}>
                  <Globe2 size={14} />
                  <span><strong>Look something up</strong><small>Get a current answer with sources</small></span>
                </button>
                <button type="button" onClick={() => setText('Remember that I prefer ')}>
                  <Waypoints size={14} />
                  <span><strong>Remember a preference</strong><small>Personalize future conversations</small></span>
                </button>
                <button type="button" onClick={() => setText(settings.projectFolder ? 'Help me with this project: ' : 'Help me choose and understand a project folder')}>
                  <Files size={14} />
                  <span><strong>Work with a project</strong><small>Use local files when you choose them</small></span>
                </button>
              </>}
            </div>
            {workspaceAwareness?.welcomeLines?.[0] && (
              <div className="codex-welcome-note">
                <CheckCircle2 size={14} />
                <span>{workspaceAwareness.welcomeLines[0]}</span>
              </div>
            )}
            {advancedMode && settings.dailyBriefEnabled && dailyBrief && (
              <section className="daily-brief-card">
                <div><strong>{dailyBrief.title}</strong><span>{new Date(dailyBrief.createdAt).toLocaleTimeString()}</span></div>
                <p>{dailyBrief.summary}</p>
                <ul>{dailyBrief.items.slice(0, 4).map((item) => <li key={`${item.label}:${item.detail}`} className={`daily-brief-${item.tone}`}><span>{item.label}</span><small>{item.detail}</small></li>)}</ul>
              </section>
            )}
          </div>
        ) : (
          <div className="codex-message-stack space-y-4">
            {displayMessages.map((message) => <MessageBubble key={message.id} message={message} />)}
            {disabled && (
              <div className="nebula-stream-activity" role="status" aria-live="polite">
                <NebulaGlyph state={agentStatus === 'reviewing' ? 'reviewing' : agentStatus === 'running_tool' ? 'tool' : 'thinking'} />
                <span>{advancedMode ? (agentStatus === 'loading_model' ? 'Preparing a local model' : agentStatus === 'switching_model' ? 'Switching route' : agentStatus === 'reviewing' ? 'Reviewing the result' : agentStatus === 'running_tool' ? 'Using a tool' : 'Nebula is working') : publicRunStageLabel(publicStage)}</span>
              </div>
            )}
          </div>
        )}
      </div>
      {recovery && (
        <div className="nebula-inline-recovery" role="alert">
          <div><strong>{recovery.title}</strong><span>{recovery.message}</span></div>
          {recovery.actionLabel && onRecovery && <button type="button" onClick={onRecovery} disabled={recoveryBusy}>{recoveryBusy ? 'Fixing...' : recovery.actionLabel}</button>}
        </div>
      )}
      <div className="composer-dock codex-composer-dock p-4">
        {advancedMode && <div className="codex-composer-meta mb-2 flex flex-wrap items-center gap-3 px-2 text-[11px] text-slate-500">
          <label className="flex min-w-0 items-center gap-2 text-slate-400">
            <span>{projectLabel}</span>
            <select
              className="max-w-[360px] rounded-full border border-white/10 bg-slate-950/80 px-3 py-1 text-[11px] text-slate-100 outline-none"
              value={visibleModelValue}
              onChange={(event) => {
                selectModel(event.target.value)
              }}
              onFocus={() => void refreshModelChoices()}
              disabled={modelsLoading}
            >
              <option value="nebula::auto">Auto routing</option>
              {lmChoices.length > 0 && <optgroup label={lmModels.length > 0 ? 'LM Studio' : 'Configured LM Studio models'}>
                {lmChoices.map((model) => (
                  <option key={`lmstudio::${model.id}`} value={`lmstudio::${model.id}`}>
                    {model.displayName || model.id}{model.loaded ? ' - loaded' : lmModels.some((listed) => listed.id === model.id) ? ' - unloaded' : ' - configured'}
                  </option>
                ))}
              </optgroup>}
              {routerChoices.length > 0 && <optgroup label="9Router">
                {routerChoices.map((model) => <option key={`9router::${model.id}`} value={`9router::${model.id}`}>{model.id}</option>)}
              </optgroup>}
              {openRouterChoices.length > 0 && <optgroup label="OpenRouter">
                {openRouterChoices.map((model) => <option key={`openrouter::${model.id}`} value={`openrouter::${model.id}`}>{model.id}</option>)}
              </optgroup>}
              {lmChoices.length === 0 && routerChoices.length === 0 && openRouterChoices.length === 0 && <option value={activeModelValue}>{modelsLoading ? 'Loading models...' : 'No configured models'}</option>}
            </select>
          </label>
          {agentStatus !== 'idle' && <span className="composer-live-state">{agentStatus.replaceAll('_', ' ')}</span>}
          <span className="ml-auto">Context</span>
          <div className="context-meter min-w-24 flex-1"><span style={{ width: `${Math.max(0, Math.min(100, contextUsage))}%` }} /></div>
          <span>{Math.round(contextUsage)}%</span>
        </div>}
        {voiceFailure && <div className="chat-voice-recovery" role="alert">
          <span>{voiceFailure.message}</span>
          <button type="button" onClick={() => void startSpeechToText()}>Retry</button>
          {voiceFailure.requiresOnlineConsent && <button type="button" onClick={() => {
            onSettingsChange({ ...settings, voiceOnlineConsent: true })
            void startSpeechToText(true)
          }}>Allow online</button>}
          <button type="button" onClick={() => { setVoiceFailure(null); textareaRef.current?.focus() }}>Use text</button>
        </div>}
        <div
          ref={composerRef}
          className="chat-composer"
          onPointerDown={focusComposerSurface}
        >
          {(activeMode || attachments.length > 0) && (
            <div className="chat-composer-context-row" aria-label="Active tools and attached context">
              {activeMode && (
                <button
                  type="button"
                  className="chat-composer-mode-chip"
                  onClick={() => setActiveMode('')}
                  aria-label={`Disable ${activeMode === 'web' ? 'Web search' : activeMode === 'deep' ? 'Deep research' : 'Project search'}`}
                >
                  {activeMode === 'web' ? <Globe2 size={12} /> : activeMode === 'deep' ? <Search size={12} /> : <Files size={12} />}
                  <span>{activeMode === 'web' ? 'Web search' : activeMode === 'deep' ? 'Deep research' : 'Project search'}</span>
                  <X size={11} />
                </button>
              )}
              {attachments.map((attachment) => (
                <span key={attachment.id} className="chat-composer-attachment" title={attachment.path || attachment.detail}>
                  {attachment.kind === 'folder' ? <FolderOpen size={12} /> : <Files size={12} />}
                  <span>{attachment.label}</span>
                  <button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))} aria-label={`Remove ${attachment.label}`}>
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="chat-composer-tools">
            <div className="chat-composer-menu-anchor">
              <button type="button" title="Add tools and context" onClick={() => setOpenMenu('add')}><Plus size={15} /></button>
              {openMenu === 'add' && (
                <div className="chat-composer-popover chat-composer-popover-add">
                  <button type="button" disabled={!settings.projectFolder} title={!settings.projectFolder ? 'Choose a project first' : undefined} onClick={() => { setOpenMenu(null); addAttachment({ kind: 'context', label: projectLabel, path: settings.projectFolder, detail: 'Project context and recent workspace awareness' }) }}><Files size={15} /><span>Project context</span></button>
                  <button type="button" disabled={!currentFilePath} title={!currentFilePath ? 'Open a project file first' : undefined} onClick={() => { setOpenMenu(null); addAttachment({ kind: 'file', label: currentFilePath.split(/[\\/]/).at(-1) || 'Current file', path: currentFilePath, detail: 'Currently opened file' }) }}><Code2 size={15} /><span>Current file</span></button>
                  <button type="button" onClick={() => void chooseFilesOrFolders('files')}><Files size={15} /><span>Files and folders</span></button>
                  <button type="button" onClick={() => void chooseFilesOrFolders('folder')}><FolderOpen size={15} /><span>Select folder</span></button>
                  <button type="button" onClick={() => menuPrompt('Create an image prompt/spec for: ')}><Sparkles size={15} /><span>Create image prompt</span><em>New</em></button>
                  <button type="button" disabled={!webSearchAvailable} title={!webSearchAvailable ? 'Enable the Web Search skill first' : undefined} onClick={() => chooseMode('deep')}><Search size={15} /><span>Deep research</span></button>
                  <button type="button" onClick={() => menuPrompt('Teach me step-by-step with guided learning about: ')}><CheckCircle2 size={15} /><span>Guided learning</span></button>
                  <button type="button" disabled={settings.contextInjectionEnabled === false} title={settings.contextInjectionEnabled === false ? 'Enable unified context injection in Settings first' : undefined} onClick={() => menuPrompt('Use memory and preferences to personalize this: ')}><Waypoints size={15} /><span>Personal Intelligence</span><strong>{settings.contextInjectionEnabled === false ? 'Off' : 'On'}</strong></button>
                </div>
              )}
            </div>
            <div className="chat-composer-menu-anchor">
              <button type="button" title="Search modes" onClick={() => setOpenMenu('search')}><Globe2 size={15} /></button>
              {openMenu === 'search' && (
                <div className="chat-composer-popover chat-composer-popover-search">
                  <button type="button" disabled={!webSearchAvailable} title={!webSearchAvailable ? 'Enable the Web Search skill first' : undefined} onClick={() => chooseMode('web')}><Globe2 size={15} /><span>Web search</span></button>
                  <button type="button" disabled={!webSearchAvailable} title={!webSearchAvailable ? 'Enable the Web Search skill first' : undefined} onClick={() => chooseMode('deep')}><Search size={15} /><span>Deep research</span></button>
                  <button type="button" disabled={!settings.projectFolder} title={!settings.projectFolder ? 'Choose a project first' : undefined} onClick={() => chooseMode('local')}><Files size={15} /><span>Project search</span></button>
                </div>
              )}
            </div>
            <button type="button" title="Speech to text" className={listening ? 'chat-composer-tool-active' : ''} onClick={() => void startSpeechToText()}><Mic size={15} /></button>
          </div>
          <div
            className="chat-composer-input"
            onPointerDown={focusComposerSurface}
          >
          <textarea
            ref={textareaRef}
            className="chat-composer-textarea"
            rows={1}
            placeholder="Ask Nebula anything..."
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              onDraftChange?.(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setOpenMenu(null)
                setActiveMode('')
                return
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
          />
          </div>
          <button
            aria-label="Send message"
            className="chat-composer-send"
            onClick={submit}
            disabled={disabled}
          >
            <Send size={17} />
          </button>
        </div>
      </div>
    </section>
  )
}
