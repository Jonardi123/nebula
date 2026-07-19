import { AppWindow, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { formatTime } from '../lib/logger'
import { listLmStudioModelInfos } from '../lib/lmstudio'
import { cancelNeuralSpeech, getNeuralSpeechStatus, NEURAL_VOICES, speakNeural, subscribeNeuralSpeech } from '../lib/neuralSpeech'
import { cancelSupertonicSpeech, getSupertonicStatus, speakSupertonic, subscribeSupertonic, SUPERTONIC_VOICES } from '../lib/supertonicSpeech'
import { selectSpeechVoice } from '../lib/speechVoices'
import type { LogEvent } from '../types/agent'
import type { ModelInfo } from '../types/nebula'
import type { AppSettings } from '../types/settings'
import { NEBULA_RELEASE } from '../../release'
import { ExecutionModeControl } from './ExecutionModeControl'
import { getRecentApps, listInstalledApps, openApp } from '../lib/commandRunner'
import type { InstalledApp } from '../types/execution'

interface Props {
  settings: AppSettings
  logs: LogEvent[]
  onChange: (settings: AppSettings) => void
}

export function SettingsPanel({ settings, logs, onChange }: Props) {
  const [view, setView] = useState<'general' | 'themes' | 'models' | 'assistant' | 'advanced' | 'logs'>('general')
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0)
  const settingsRef = useRef(settings)
  const advancedMode = settings.experienceMode === 'advanced'
  const visibleViews = advancedMode
    ? (['general', 'themes', 'models', 'assistant', 'advanced', 'logs'] as const)
    : (['general', 'themes', 'models', 'assistant'] as const)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    if (!advancedMode && view !== 'general' && view !== 'themes' && view !== 'models' && view !== 'assistant') setView('general')
  }, [advancedMode, view])

  useEffect(() => {
    if (view !== 'models' || settings.modelProvider !== 'lmstudio') return

    let cancelled = false
    setModelsLoading(true)
    setModelsError('')
    listLmStudioModelInfos(settingsRef.current)
      .then((models) => {
        if (cancelled) return
        setAvailableModels([...models].sort((left, right) => Number(right.loaded) - Number(left.loaded) || left.displayName.localeCompare(right.displayName)))
        if (models.length === 0) setModelsError('No LM Studio models found. Start the local server, then refresh.')
      })
      .catch((error) => {
        if (cancelled) return
        setAvailableModels([])
        setModelsError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [view, settings.modelProvider, settings.endpoint, modelsRefreshKey])

  function patch(update: Partial<AppSettings>) {
    onChange({ ...settings, ...update })
  }

  function activeProviderModel() {
    if (settings.modelProvider === '9router') return settings.nineRouterModel || settings.model
    if (settings.modelProvider === 'openrouter') return settings.openRouterModel || 'role-routed assignment'
    return settings.model
  }

  function applyQwenCoderPreset() {
    patch({
      modelProvider: 'lmstudio',
      nineRouterBaseUrl: 'http://localhost:20128/v1',
      nineRouterApiKey: '',
      nineRouterModel: '',
      openRouterBaseUrl: 'https://openrouter.ai/api/v1',
      openRouterApiKey: '',
      openRouterModel: '',
      fallbackToLmStudio: true,
      model: 'google_-_gemma-7b-it',
      modelMode: 'auto',
      fastModel: 'google_-_gemma-7b-it',
      codeModel: 'qwen/qwen2.5-coder-14b',
      reviewModel: 'openai-gpt-oss-20b-heretic-uncensored-neo-imatrix',
      autoLoadModels: true,
      warmFastModelOnStartup: true,
      keepDailyModelWarm: true,
      backgroundPreloadCodeModel: false,
      heavyModelIdleUnloadMs: 8 * 60 * 1000,
      modelLoadTimeoutMs: 180000,
      enableAutomaticReviewPass: false,
      warmModelWhileTyping: true,
      contextInjectionEnabled: true,
      contextBudgetChars: 18000,
      showModelDebugInfo: false,
      developerDiagnosticsEnabled: true,
      nebulaCoreEnabled: true,
      desktopControlBetaEnabled: true,
      automationSchedulerEnabled: true,
      automationConfirmationMode: 'confirm_risky',
      autoWebSearch: true,
      modelAssignments: {
        daily: 'google_-_gemma-7b-it',
        code: 'qwen/qwen2.5-coder-14b',
        review: 'openai-gpt-oss-20b-heretic-uncensored-neo-imatrix',
      },
      launcherIndexedFolders: [],
      trustedAppAliases: {},
      maxAutoFetchPages: 2,
      memoryReviewMode: 'suggest',
      activeProjectProfileId: '',
      projectProfileMode: 'auto_editable',
      modelRoutingSuggestions: true,
      notificationMode: 'in_app_tray',
      screenshotAskEnabled: true,
      temperature: 0.25,
      maxTokens: 4096,
      requireApproval: false,
      riskyToolsEnabled: true,
      actionMode: 'safe',
      assistantHoldMs: 360,
      globalShortcutEnabled: true,
      launchAtStartup: true,
      keepRunningInBackground: true,
      screenAwarenessEnabled: true,
      voiceEnabled: true,
      voiceAutoStart: true,
      voiceLanguage: 'en-US',
      voiceRecognitionMode: 'local_first',
      voiceOnlineConsent: false,
      voiceAutoSubmit: true,
      voiceSilenceMs: 1200,
      voiceSpeakReplies: true,
      voiceSynthesisMode: 'neural_local',
      voiceNeuralVoice: 'af_heart',
      voiceSupertonicVoice: 'F1',
      voiceSystemVoice: '',
      voiceRate: 0.94,
      voicePitch: 1.02,
      wakePhraseEnabled: false,
      wakePhrase: 'Nebula',
      startupAnimation: 'event_horizon',
      setupWizardCompleted: true,
      setupWizardLastRunAt: new Date().toISOString(),
      overlayQuickActionsEnabled: true,
      modelProfilerEnabled: true,
      dailyBriefEnabled: true,
      permissionCenterOverrides: {},
    })
  }

  return (
    <div className="settings-page text-xs">
      <div className="settings-page-nav" role="tablist" aria-label="Settings sections">
        {visibleViews.map((item) => (
          <button key={item} className={view === item ? 'settings-page-nav-active' : ''} type="button" onClick={() => setView(item)}>
            {item === 'assistant' ? 'Assistant' : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      {view === 'logs' ? (
        <LogList logs={logs} />
      ) : view === 'themes' ? (
        <div className="settings-page-content">
          <SettingsSection title="Themes" description="Switch instantly without changing chats, tools, or models.">
            <div className="theme-choice-grid" role="radiogroup" aria-label="Visual theme">
              <button type="button" role="radio" aria-checked={settings.theme === 'black_matter'} className={settings.theme === 'black_matter' ? 'theme-choice-active' : ''} onClick={() => patch({ theme: 'black_matter' })}>
                <span className="theme-preview theme-preview-black-matter"><i /><i /><i /></span>
                <strong>Black Matter</strong><small>Graphite, cyan signals, ultraviolet depth.</small>
              </button>
              <button type="button" role="radio" aria-checked={settings.theme === 'original'} className={settings.theme === 'original' ? 'theme-choice-active' : ''} onClick={() => patch({ theme: 'original' })}>
                <span className="theme-preview theme-preview-original"><i /><i /><i /></span>
                <strong>Nebula Original</strong><small>The earlier deep-space glass interface.</small>
              </button>
            </div>
            <StartupAnimationSelector value={settings.startupAnimation ?? 'event_horizon'} onChange={(startupAnimation) => patch({ startupAnimation })} />
          </SettingsSection>
        </div>
      ) : view === 'general' ? (
        <div className="settings-page-content">
          <SettingsSection title="Experience" description="Keep Nebula simple for daily use or reveal every developer surface.">
            <label className="settings-field"><span>Interface mode</span><select value={settings.experienceMode ?? 'simple'} onChange={(event) => patch({ experienceMode: event.target.value as AppSettings['experienceMode'] })}><option value="simple">Simple</option><option value="advanced">Advanced</option></select></label>
            <p className="settings-help-text">Advanced Mode reveals models, agents, diagnostics, skills, logs, training, and runtime controls. Your data is unchanged when switching modes.</p>
          </SettingsSection>
          <SettingsSection title="Daily behavior">
            <Toggle label="Daily brief on new chats" checked={settings.dailyBriefEnabled ?? true} onChange={(dailyBriefEnabled) => patch({ dailyBriefEnabled })} />
          </SettingsSection>
          <SettingsSection title="Execution" description="Control when Nebula may run commands, edit files, or open apps.">
            <ExecutionModeControl storedMode={settings.actionMode ?? 'safe'} onStoredModeChange={(actionMode) => patch({ actionMode, requireApproval: actionMode === 'approval' })} />
          </SettingsSection>
          <SettingsSection title="Workspace" description="Local project and memory locations.">
            <Field label="Project folder" value={settings.projectFolder} onChange={(projectFolder) => patch({ projectFolder })} />
            <Field label="Memory folder" value={settings.memoryFolder} onChange={(memoryFolder) => patch({ memoryFolder })} />
            <MemoryReviewSelector value={settings.memoryReviewMode ?? 'suggest'} onChange={(memoryReviewMode) => patch({ memoryReviewMode })} />
          </SettingsSection>
          <SettingsSection title="Setup">
            <button className="settings-primary-action" type="button" onClick={() => window.dispatchEvent(new CustomEvent('nebula-open-setup-wizard'))}>Run Setup Wizard</button>
            <p className="settings-help-text">{NEBULA_RELEASE.displayName} · Version {NEBULA_RELEASE.version} · Build {NEBULA_RELEASE.build}</p>
          </SettingsSection>
        </div>
      ) : view === 'models' ? (
        <div className="settings-page-content">
          <SettingsSection title="Provider" description={`Active: ${activeProviderModel() || 'not selected'}`}>
            <ProviderSelector value={settings.modelProvider ?? 'lmstudio'} onChange={(modelProvider) => patch({ modelProvider })} />
            {settings.modelProvider === 'lmstudio' && <Field label="LM Studio endpoint" value={settings.endpoint} onChange={(endpoint) => patch({ endpoint })} />}
            {settings.modelProvider === '9router' && <><Field label="Base URL" value={settings.nineRouterBaseUrl ?? 'http://localhost:20128/v1'} onChange={(nineRouterBaseUrl) => patch({ nineRouterBaseUrl })} /><Field label="API key" value={settings.nineRouterApiKey ?? ''} type="password" onChange={(nineRouterApiKey) => patch({ nineRouterApiKey })} /><Field label="Model" value={settings.nineRouterModel ?? ''} onChange={(nineRouterModel) => patch({ nineRouterModel })} /></>}
            {settings.modelProvider === 'openrouter' && <><div className="settings-privacy-warning">Remote prompts may leave this PC.</div><Field label="Base URL" value={settings.openRouterBaseUrl ?? 'https://openrouter.ai/api/v1'} onChange={(openRouterBaseUrl) => patch({ openRouterBaseUrl })} /><Field label="API key" value={settings.openRouterApiKey ?? ''} type="password" onChange={(openRouterApiKey) => patch({ openRouterApiKey })} /><Field label="Model override" value={settings.openRouterModel ?? ''} onChange={(openRouterModel) => patch({ openRouterModel })} /></>}
            {settings.modelProvider !== 'lmstudio' && <Toggle label="Fallback to LM Studio" checked={settings.fallbackToLmStudio ?? true} onChange={(fallbackToLmStudio) => patch({ fallbackToLmStudio })} />}
          </SettingsSection>
          <SettingsSection title="Routing" description="Nebula chooses a role without exposing the underlying model.">
            {settings.modelProvider === 'lmstudio' && (
              <div className="settings-model-source">
                <span>{modelsLoading ? 'Scanning LM Studio...' : `${availableModels.length} local model${availableModels.length === 1 ? '' : 's'} available`}</span>
                <button type="button" onClick={() => setModelsRefreshKey((current) => current + 1)} disabled={modelsLoading} title="Refresh LM Studio models">
                  <RefreshCw size={13} className={modelsLoading ? 'settings-model-refreshing' : ''} />
                  Refresh
                </button>
                {modelsError && <small>{modelsError}</small>}
              </div>
            )}
            <Toggle label="Use one model for everything" checked={settings.singleModelEnabled ?? false} onChange={(singleModelEnabled) => patch({ singleModelEnabled })} />
            {settings.singleModelEnabled ? (
              settings.modelProvider === 'lmstudio' ? (
                <ModelSelect label="Single model" value={settings.singleModel || settings.model || ''} models={availableModels} loading={modelsLoading} onChange={(singleModel) => patch({ singleModel, model: singleModel })} />
              ) : (
                <Field label="Single model" value={settings.singleModel || settings.model || ''} onChange={(singleModel) => patch({ singleModel, model: singleModel })} />
              )
            ) : (
              <>
                <ModelModeSelector value={settings.modelMode ?? 'auto'} onChange={(modelMode) => patch({ modelMode })} />
                {settings.modelProvider === 'lmstudio' ? (
                  <>
                    <ModelSelect label="Daily" value={settings.modelAssignments?.daily ?? settings.fastModel ?? ''} models={availableModels} loading={modelsLoading} onChange={(daily) => patch({ modelAssignments: { ...settings.modelAssignments, daily }, fastModel: daily })} />
                    <ModelSelect label="Code" value={settings.modelAssignments?.code ?? settings.codeModel ?? ''} models={availableModels} loading={modelsLoading} onChange={(code) => patch({ modelAssignments: { ...settings.modelAssignments, code }, codeModel: code, model: code })} />
                    <ModelSelect label="Review" value={settings.modelAssignments?.review ?? settings.reviewModel ?? ''} models={availableModels} loading={modelsLoading} onChange={(review) => patch({ modelAssignments: { ...settings.modelAssignments, review }, reviewModel: review })} />
                  </>
                ) : (
                  <>
                    <Field label="Daily" value={settings.modelAssignments?.daily ?? settings.fastModel ?? ''} onChange={(daily) => patch({ modelAssignments: { ...settings.modelAssignments, daily }, fastModel: daily })} />
                    <Field label="Code" value={settings.modelAssignments?.code ?? settings.codeModel ?? ''} onChange={(code) => patch({ modelAssignments: { ...settings.modelAssignments, code }, codeModel: code, model: code })} />
                    <Field label="Review" value={settings.modelAssignments?.review ?? settings.reviewModel ?? ''} onChange={(review) => patch({ modelAssignments: { ...settings.modelAssignments, review }, reviewModel: review })} />
                  </>
                )}
              </>
            )}
            {settings.modelProvider === 'lmstudio' && (
              <details className="settings-disclosure settings-model-manual">
                <summary>Model not listed?</summary>
                <div>
                  {settings.singleModelEnabled ? (
                    <Field label="Manual model ID" value={settings.singleModel || settings.model || ''} onChange={(singleModel) => patch({ singleModel, model: singleModel })} />
                  ) : (
                    <>
                      <Field label="Manual daily model ID" value={settings.modelAssignments?.daily ?? settings.fastModel ?? ''} onChange={(daily) => patch({ modelAssignments: { ...settings.modelAssignments, daily }, fastModel: daily })} />
                      <Field label="Manual code model ID" value={settings.modelAssignments?.code ?? settings.codeModel ?? ''} onChange={(code) => patch({ modelAssignments: { ...settings.modelAssignments, code }, codeModel: code, model: code })} />
                      <Field label="Manual review model ID" value={settings.modelAssignments?.review ?? settings.reviewModel ?? ''} onChange={(review) => patch({ modelAssignments: { ...settings.modelAssignments, review }, reviewModel: review })} />
                    </>
                  )}
                </div>
              </details>
            )}
            <Toggle label="Auto-load routed model" checked={settings.autoLoadModels ?? true} onChange={(autoLoadModels) => patch({ autoLoadModels })} />
            <Toggle label="Keep daily model warm" checked={settings.keepDailyModelWarm ?? true} onChange={(keepDailyModelWarm) => patch({ keepDailyModelWarm })} />
          </SettingsSection>
          <details className="settings-disclosure"><summary>Model performance</summary><div><Toggle label="Warm model while typing" checked={settings.warmModelWhileTyping ?? true} onChange={(warmModelWhileTyping) => patch({ warmModelWhileTyping })} /><Toggle label="Preload code model for projects" checked={settings.backgroundPreloadCodeModel ?? true} onChange={(backgroundPreloadCodeModel) => patch({ backgroundPreloadCodeModel })} /><Toggle label="Automatic review pass" checked={settings.enableAutomaticReviewPass ?? false} onChange={(enableAutomaticReviewPass) => patch({ enableAutomaticReviewPass })} /><NumberField label="Heavy model idle unload ms" value={settings.heavyModelIdleUnloadMs ?? 480000} step={60000} onChange={(heavyModelIdleUnloadMs) => patch({ heavyModelIdleUnloadMs })} /><NumberField label="Load timeout ms" value={settings.modelLoadTimeoutMs ?? 180000} step={15000} onChange={(modelLoadTimeoutMs) => patch({ modelLoadTimeoutMs })} /></div></details>
          <button className="settings-secondary-action" type="button" onClick={applyQwenCoderPreset}>Apply recommended local preset</button>
        </div>
      ) : view === 'assistant' ? (
        <div className="settings-page-content">
          <SettingsSection title="Desktop assistant" description="Summon and background behavior.">
            <Toggle label="Ctrl + Space shortcut" checked={settings.globalShortcutEnabled ?? true} onChange={(globalShortcutEnabled) => patch({ globalShortcutEnabled })} />
            <Toggle label="Launch at Windows sign-in" checked={settings.launchAtStartup ?? true} onChange={(launchAtStartup) => patch({ launchAtStartup })} />
            <Toggle label="Keep running when closed" checked={settings.keepRunningInBackground ?? true} onChange={(keepRunningInBackground) => patch({ keepRunningInBackground })} />
            <Toggle label="Screen awareness" checked={settings.screenAwarenessEnabled ?? true} onChange={(screenAwarenessEnabled) => patch({ screenAwarenessEnabled })} />
            <Toggle label="Screenshot Ask" checked={settings.screenshotAskEnabled ?? true} onChange={(screenshotAskEnabled) => patch({ screenshotAskEnabled })} />
          </SettingsSection>
          <SettingsSection title="Voice">
            <Toggle label="Voice input" checked={settings.voiceEnabled ?? true} onChange={(voiceEnabled) => patch({ voiceEnabled })} />
            <Toggle label="Start listening automatically" checked={settings.voiceAutoStart ?? true} onChange={(voiceAutoStart) => patch({ voiceAutoStart })} />
            <LanguageSelector value={settings.voiceLanguage ?? 'en-US'} onChange={(voiceLanguage) => patch({ voiceLanguage })} />
            <VoiceRecognitionModeSelector value={settings.voiceRecognitionMode ?? 'local_first'} onChange={(voiceRecognitionMode) => patch({ voiceRecognitionMode })} />
            <Toggle label="Auto-submit after speech" checked={settings.voiceAutoSubmit ?? true} onChange={(voiceAutoSubmit) => patch({ voiceAutoSubmit })} />
            <Toggle label="Speak voice replies" checked={settings.voiceSpeakReplies ?? true} onChange={(voiceSpeakReplies) => patch({ voiceSpeakReplies })} />
            <VoiceOutputSettings settings={settings} onChange={patch} />
            <p className="settings-inline-note">Wake phrase is unavailable until Nebula has a real background wake-word engine.</p>
            <details className="settings-disclosure">
              <summary>Advanced voice</summary>
              <div>
                <NumberField label="Silence before submit (ms)" value={settings.voiceSilenceMs ?? 1200} step={100} onChange={(voiceSilenceMs) => patch({ voiceSilenceMs })} />
                <NumberField label="Speech rate" value={settings.voiceRate ?? 1} step={0.1} onChange={(voiceRate) => patch({ voiceRate })} />
                <NumberField label="Speech pitch" value={settings.voicePitch ?? 1} step={0.1} onChange={(voicePitch) => patch({ voicePitch })} />
              </div>
            </details>
          </SettingsSection>
          <SettingsSection title="Automation">
            <Toggle label="Automation scheduler" checked={settings.automationSchedulerEnabled ?? true} onChange={(automationSchedulerEnabled) => patch({ automationSchedulerEnabled })} />
            <AutomationConfirmationSelector value={settings.automationConfirmationMode ?? 'confirm_risky'} onChange={(automationConfirmationMode) => patch({ automationConfirmationMode })} />
            <Toggle label="Search the web when needed" checked={settings.autoWebSearch ?? true} onChange={(autoWebSearch) => patch({ autoWebSearch })} />
          </SettingsSection>
        </div>
      ) : (
        <div className="settings-page-content">
          <SettingsSection title="Agent runtime">
            <Toggle label="Unified context injection" checked={settings.contextInjectionEnabled ?? true} onChange={(contextInjectionEnabled) => patch({ contextInjectionEnabled })} />
            <NumberField label="Context budget characters" value={settings.contextBudgetChars ?? 18000} step={1000} onChange={(contextBudgetChars) => patch({ contextBudgetChars })} />
            <NumberField label="Temperature" value={settings.temperature} step={0.1} onChange={(temperature) => patch({ temperature })} />
            <NumberField label="Maximum tokens" value={settings.maxTokens} step={128} onChange={(maxTokens) => patch({ maxTokens })} />
          </SettingsSection>
          <SettingsSection title="Developer">
            <Toggle label="Show model debug information" checked={settings.showModelDebugInfo ?? false} onChange={(showModelDebugInfo) => patch({ showModelDebugInfo })} />
            <Toggle label="Diagnostics dashboard" checked={settings.developerDiagnosticsEnabled ?? true} onChange={(developerDiagnosticsEnabled) => patch({ developerDiagnosticsEnabled })} />
            <Toggle label="Model speed profiler" checked={settings.modelProfilerEnabled ?? true} onChange={(modelProfilerEnabled) => patch({ modelProfilerEnabled })} />
            <Toggle label="Desktop control beta" checked={settings.desktopControlBetaEnabled ?? true} onChange={(desktopControlBetaEnabled) => patch({ desktopControlBetaEnabled })} />
            <Toggle label="Enable risky tools" checked={settings.riskyToolsEnabled} onChange={(riskyToolsEnabled) => patch({ riskyToolsEnabled })} />
            <TextAreaField label="Launcher indexed folders" value={(settings.launcherIndexedFolders ?? []).join('\n')} onChange={(value) => patch({ launcherIndexedFolders: value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) })} />
          </SettingsSection>
          <SettingsSection title="App control" description="Discover installed apps and teach Nebula short, trusted aliases.">
            <AppControlSettings settings={settings} onChange={patch} />
          </SettingsSection>
        </div>
      )}
    </div>
  )
}

function AppControlSettings({ settings, onChange }: { settings: AppSettings; onChange: (update: Partial<AppSettings>) => void }) {
  const [apps, setApps] = useState<InstalledApp[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const aliases = Object.entries(settings.trustedAppAliases ?? {}).map(([alias, target]) => `${alias}=${target}`).join('\n')
  const visible = apps.filter((app) => !query.trim() || `${app.name} ${app.aliases.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 12)

  async function refreshApps() {
    setLoading(true)
    setNotice('')
    try {
      setApps(await listInstalledApps())
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refreshApps() }, [])

  function updateAliases(value: string) {
    const trustedAppAliases = Object.fromEntries(value.split(/\r?\n/).map((line) => {
      const separator = line.indexOf('=')
      return separator > 0 ? [line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()] : ['', '']
    }).filter(([alias, target]) => Boolean(alias && target)))
    onChange({ trustedAppAliases })
  }

  const recent = getRecentApps()
  return (
    <div className="settings-app-control">
      <div className="settings-app-toolbar">
        <input className="nebula-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search installed apps" />
        <button className="settings-secondary-action" type="button" onClick={() => void refreshApps()}><RefreshCw size={13} />{loading ? 'Scanning...' : 'Refresh'}</button>
      </div>
      {recent.length > 0 && <div className="settings-recent-apps" aria-label="Recent apps">{recent.map((app) => <button key={app} type="button" onClick={() => void openApp(app)}><AppWindow size={13} />{app}</button>)}</div>}
      <div className="settings-installed-apps">
        {visible.map((app) => <button key={app.id} type="button" title={app.path} onClick={() => void openApp(app.name)}><AppWindow size={14} /><span><strong>{app.name}</strong><small>{app.source.replace('_', ' ')}</small></span></button>)}
        {!loading && visible.length === 0 && <p className="settings-help-text">No matching applications found.</p>}
      </div>
      {notice && <p className="settings-inline-note">{notice}</p>}
      <TextAreaField label="Trusted aliases (one alias=app per line)" value={aliases} onChange={updateAliases} />
      <p className="settings-help-text">Example: <code>music=Spotify</code>. Unknown executable paths still follow the active execution mode.</p>
    </div>
  )
}

function SettingsSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="settings-section"><header><h3>{title}</h3>{description && <p>{description}</p>}</header><div>{children}</div></section>
}

function LogList({ logs }: { logs: LogEvent[] }) {
  return (
    <section className="settings-log-panel terminal-font">
      <div className="settings-log-header flex items-center justify-between px-3 py-2">
        <span>Action logs</span>
        <span>{logs.length} events</span>
      </div>
      <div className="max-h-[calc(100vh-190px)] overflow-auto px-3 py-2">
        {logs.map((log) => (
          <div key={log.id} className="settings-log-row grid grid-cols-[72px_88px_1fr] gap-2 py-2">
            <span className="text-slate-500">{formatTime(log.createdAt)}</span>
            <span className="text-cyan-200">{log.type}</span>
            <span className="whitespace-pre-wrap break-words text-slate-300">{log.message}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function StartupAnimationSelector({ value, onChange }: { value: AppSettings['startupAnimation']; onChange: (value: AppSettings['startupAnimation']) => void }) {
  return (
    <label className="block space-y-1">
      <span className="text-slate-400">Startup animation</span>
      <select className="nebula-input w-full px-2 py-2 outline-none" value={value} onChange={(event) => onChange(event.target.value as AppSettings['startupAnimation'])}>
        <option value="event_horizon">Event Horizon</option>
        <option value="cinematic">Nebula Original</option>
        <option value="simple">Simple</option>
        <option value="off">Off</option>
      </select>
    </label>
  )
}

function AutomationConfirmationSelector({ value, onChange }: { value: AppSettings['automationConfirmationMode']; onChange: (value: AppSettings['automationConfirmationMode']) => void }) {
  return (
    <label className="block space-y-1">
      <span className="text-slate-400">Automation confirmation mode</span>
      <select className="nebula-input w-full px-2 py-2 outline-none" value={value} onChange={(event) => onChange(event.target.value as AppSettings['automationConfirmationMode'])}>
        <option value="safe_only">Safe actions only</option>
        <option value="confirm_risky">Confirm risky actions</option>
        <option value="manual_only">Manual only</option>
      </select>
    </label>
  )
}

function LanguageSelector({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const languages = [
    ['en-US', 'English US'],
    ['en-GB', 'English UK'],
    ['sq-AL', 'Albanian'],
    ['es-ES', 'Spanish'],
    ['fr-FR', 'French'],
    ['de-DE', 'German'],
    ['it-IT', 'Italian'],
    ['tr-TR', 'Turkish'],
    ['ar-SA', 'Arabic'],
    ['hi-IN', 'Hindi'],
    ['ja-JP', 'Japanese'],
    ['ko-KR', 'Korean'],
    ['zh-CN', 'Chinese'],
  ]

  return (
    <label className="block space-y-1">
      <span className="text-slate-400">Voice language</span>
      <select className="nebula-input w-full px-2 py-2 outline-none" value={value} onChange={(event) => onChange(event.target.value)}>
        {languages.map(([code, label]) => (
          <option key={code} value={code}>
            {label} ({code})
          </option>
        ))}
      </select>
    </label>
  )
}

function VoiceRecognitionModeSelector({ value, onChange }: { value: AppSettings['voiceRecognitionMode']; onChange: (value: AppSettings['voiceRecognitionMode']) => void }) {
  return (
    <label className="block space-y-1">
      <span className="text-slate-400">Recognition</span>
      <select className="nebula-input w-full px-2 py-2 outline-none" value={value} onChange={(event) => onChange(event.target.value as AppSettings['voiceRecognitionMode'])}>
        <option value="local_first">Local first</option>
        <option value="online">Online speech service</option>
        <option value="text_only">Text only</option>
      </select>
    </label>
  )
}

function VoiceOutputSettings({ settings, onChange }: { settings: AppSettings; onChange: (update: Partial<AppSettings>) => void }) {
  const [status, setStatus] = useState(getNeuralSpeechStatus())
  const [supertonicStatus, setSupertonicStatus] = useState(getSupertonicStatus())
  const [previewing, setPreviewing] = useState(false)
  const mode = settings.voiceSynthesisMode ?? 'neural_local'

  useEffect(() => subscribeNeuralSpeech(setStatus), [])
  useEffect(() => subscribeSupertonic(setSupertonicStatus), [])

  function previewNeural() {
    cancelNeuralSpeech()
    cancelSupertonicSpeech()
    setPreviewing(true)
    void speakNeural('Hi Jonard. I am Nebula. This is my new neural voice.', {
      voice: settings.voiceNeuralVoice,
      speed: settings.voiceRate || 0.96,
      onEnd: () => setPreviewing(false),
      onError: () => setPreviewing(false),
    })
  }

  function previewSupertonic() {
    cancelNeuralSpeech()
    cancelSupertonicSpeech()
    setPreviewing(true)
    void speakSupertonic('Hi Jonard. I am Nebula. This is the optional Supertonic voice.', {
      voice: settings.voiceSupertonicVoice,
      speed: settings.voiceRate || 1.02,
      onEnd: () => setPreviewing(false),
      onError: () => setPreviewing(false),
    })
  }

  return (
    <div className="settings-voice-output">
      <label className="settings-field">
        <span>Voice output</span>
        <select value={mode} onChange={(event) => onChange({ voiceSynthesisMode: event.target.value as AppSettings['voiceSynthesisMode'] })}>
          <option value="neural_local">Nebula Neural (recommended)</option>
          <option value="supertonic">Supertonic (optional)</option>
          <option value="system">Windows system voice</option>
        </select>
      </label>
      {mode === 'neural_local' ? (
        <>
          <label className="settings-field">
            <span>Neural personality</span>
            <select value={settings.voiceNeuralVoice || 'af_heart'} onChange={(event) => onChange({ voiceNeuralVoice: event.target.value })}>
              {NEURAL_VOICES.map((voice) => <option key={voice.id} value={voice.id}>{voice.name} - {voice.description}</option>)}
            </select>
          </label>
          <div className="settings-model-source">
            <span>{status.message}</span>
            {status.phase === 'downloading' && <small>{Math.round(status.progress)}%</small>}
          </div>
          <button className="settings-secondary-action" type="button" disabled={previewing || status.phase === 'downloading'} onClick={previewNeural}>
            {previewing ? 'Playing preview...' : status.phase === 'downloading' ? 'Downloading voice...' : 'Preview neural voice'}
          </button>
          <p className="settings-help-text">The neural model downloads once and runs locally. Windows voice is used automatically if it cannot start.</p>
        </>
      ) : mode === 'supertonic' ? (
        <>
          <label className="settings-field">
            <span>Supertonic voice</span>
            <select value={settings.voiceSupertonicVoice || 'F1'} onChange={(event) => onChange({ voiceSupertonicVoice: event.target.value })}>
              {SUPERTONIC_VOICES.map((voice) => <option key={voice.id} value={voice.id}>{voice.name} - {voice.description}</option>)}
            </select>
          </label>
          <div className="settings-model-source"><span>{supertonicStatus.message}</span></div>
          <button className="settings-secondary-action" type="button" disabled={previewing || supertonicStatus.phase === 'generating'} onClick={previewSupertonic}>
            {previewing ? 'Playing preview...' : supertonicStatus.phase === 'generating' ? 'Generating preview...' : 'Preview Supertonic'}
          </button>
          <p className="settings-help-text">Optional local expressive voice. It loads only when selected and falls back to Windows voice if unavailable.</p>
        </>
      ) : (
        <SpeechVoiceSelector value={settings.voiceSystemVoice ?? ''} language={settings.voiceLanguage ?? 'en-US'} rate={settings.voiceRate ?? 1} pitch={settings.voicePitch ?? 1} onChange={(voiceSystemVoice) => onChange({ voiceSystemVoice })} />
      )}
    </div>
  )
}

function SpeechVoiceSelector({ value, language, rate, pitch, onChange }: { value: string; language: string; rate: number; pitch: number; onChange: (value: string) => void }) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])

  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const refresh = () => setVoices([...window.speechSynthesis.getVoices()].sort((left, right) => left.lang.localeCompare(right.lang) || left.name.localeCompare(right.name)))
    refresh()
    window.speechSynthesis.addEventListener('voiceschanged', refresh)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refresh)
  }, [])

  function preview() {
    if (!('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance('Hi Jonard. I am Nebula. This is how my voice sounds now.')
    utterance.lang = language
    utterance.voice = selectSpeechVoice(voices, value, language)
    utterance.rate = value ? rate : Math.min(rate, 0.94)
    utterance.pitch = value ? pitch : Math.max(pitch, 1.02)
    utterance.volume = value ? 1 : 0.92
    window.speechSynthesis.speak(utterance)
  }

  const missing = Boolean(value) && !voices.some((voice) => voice.name === value || voice.voiceURI === value)
  return (
    <div className="settings-voice-select">
      <label className="block space-y-1">
        <span className="text-slate-400">Reply voice</span>
        <select className="nebula-input w-full px-2 py-2 outline-none" value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Automatic (most natural)</option>
          {missing && <option value={value}>{value} (unavailable)</option>}
          {voices.map((voice) => <option key={voice.voiceURI} value={voice.name}>{voice.name} ({voice.lang})</option>)}
        </select>
      </label>
      <button className="settings-secondary-action" type="button" onClick={preview}>Preview voice</button>
    </div>
  )
}

function ProviderSelector({ value, onChange }: { value: AppSettings['modelProvider']; onChange: (value: AppSettings['modelProvider']) => void }) {
  return (
    <label className="block space-y-1">
      <span className="text-slate-400">Model provider</span>
      <select className="nebula-input w-full px-2 py-2 outline-none" value={value} onChange={(event) => onChange(event.target.value as AppSettings['modelProvider'])}>
        <option value="lmstudio">LM Studio</option>
        <option value="9router">9Router</option>
        <option value="openrouter">OpenRouter</option>
      </select>
    </label>
  )
}

function ModelModeSelector({ value, onChange }: { value: AppSettings['modelMode']; onChange: (value: AppSettings['modelMode']) => void }) {
  const modes: Array<{ id: AppSettings['modelMode']; label: string; hint: string }> = [
    { id: 'auto', label: 'Auto', hint: 'Route by task' },
    { id: 'fast', label: 'Fast', hint: 'Daily chat' },
    { id: 'code', label: 'Code', hint: 'Project work' },
    { id: 'review', label: 'Review', hint: 'Second opinion' },
  ]

  return (
    <div className="space-y-2">
      <span className="text-slate-400">Model mode</span>
      <div className="grid grid-cols-4 gap-1 rounded-[8px] border border-white/10 bg-black/20 p-1">
        {modes.map((mode) => (
          <button
            key={mode.id}
            className={`rounded-[6px] px-2 py-2 text-left transition ${value === mode.id ? 'bg-fuchsia-300/16 text-fuchsia-50 shadow-[0_0_18px_rgba(217,70,239,0.14)]' : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-200'}`}
            type="button"
            onClick={() => onChange(mode.id)}
          >
            <div className="text-xs font-semibold">{mode.label}</div>
            <div className="mt-1 text-[10px] leading-3 opacity-70">{mode.hint}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function ModelSelect({ label, value, models, loading, onChange }: { label: string; value: string; models: ModelInfo[]; loading: boolean; onChange: (value: string) => void }) {
  const configuredModelMissing = Boolean(value) && !models.some((model) => model.id === value)

  return (
    <label className="settings-model-select block space-y-1">
      <span className="text-slate-400">{label}</span>
      <select className="nebula-input w-full px-2 py-2 outline-none" value={value} onChange={(event) => onChange(event.target.value)} disabled={loading && models.length === 0}>
        {!value && <option value="">Select a model</option>}
        {configuredModelMissing && <option value={value}>{value} (configured)</option>}
        {models.map((model) => {
          const details = [model.loaded ? 'loaded' : '', model.quantization].filter(Boolean).join(', ')
          const name = model.displayName || model.id
          return <option key={model.id} value={model.id}>{name}{details ? ` (${details})` : ''}</option>
        })}
      </select>
      {models.length > 0 && <small>{models.find((model) => model.id === value)?.id ?? (configuredModelMissing ? 'This configured model is not currently installed in LM Studio.' : '')}</small>}
    </label>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder = '' }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-slate-400">{label}</span>
      <input className="nebula-input w-full px-2 py-2 outline-none" type={type} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function NumberField({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (value: number) => void }) {
  return (
    <label className="block space-y-1">
      <span className="text-slate-400">{label}</span>
      <input className="nebula-input w-full px-2 py-2 outline-none" type="number" step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}

function TextAreaField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block space-y-1">
      <span className="text-slate-400">{label}</span>
      <textarea className="nebula-input min-h-24 w-full resize-none px-2 py-2 outline-none" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function MemoryReviewSelector({ value, onChange }: { value: AppSettings['memoryReviewMode']; onChange: (value: AppSettings['memoryReviewMode']) => void }) {
  return (
    <label className="block space-y-1">
      <span className="text-slate-400">Memory review mode</span>
      <select className="nebula-input w-full px-2 py-2 outline-none" value={value} onChange={(event) => onChange(event.target.value as AppSettings['memoryReviewMode'])}>
        <option value="suggest">Suggest then approve</option>
        <option value="auto">Auto-save</option>
        <option value="manual">Manual only</option>
      </select>
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="nebula-toggle flex items-center justify-between px-3 py-2">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}
