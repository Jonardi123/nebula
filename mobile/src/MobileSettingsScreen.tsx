import {
  Bot, ChevronLeft, Database, Gauge, Info, MonitorCog,
  Palette, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Unplug, Volume2, Wifi,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getMobileControlSettings, getMobileDiagnostics, getMobileModels, updateMobileControlSettings } from './api'
import { deletePrivateValue } from './idb'
import type { MobileControlSettings, MobileDiagnostics, MobileModelSummary, MobilePreferences, RuntimeStatus } from './types'

type SettingsSection = 'appearance' | 'chat' | 'voice' | 'models' | 'assistant' | 'connection' | 'data' | 'diagnostics'

interface Props {
  preferences: MobilePreferences
  online: boolean
  runtime: RuntimeStatus
  onChange: (change: Partial<MobilePreferences>) => void
  onClose: () => void
  onUnpair: () => void
}

const sections: Array<{ id: SettingsSection; label: string; icon: typeof Palette; detail: string }> = [
  { id: 'appearance', label: 'Appearance', icon: Palette, detail: 'Theme, type, motion, and contrast' },
  { id: 'chat', label: 'Chat', icon: SlidersHorizontal, detail: 'Messages, drafts, streaming, and sounds' },
  { id: 'voice', label: 'Voice', icon: Volume2, detail: 'Dictation and spoken replies' },
  { id: 'models', label: 'Models', icon: Bot, detail: 'Routing and model assignments' },
  { id: 'assistant', label: 'Assistant', icon: ShieldCheck, detail: 'Context, web, memory, and approvals' },
  { id: 'connection', label: 'Connection', icon: Wifi, detail: 'Private PC bridge and pairing' },
  { id: 'data', label: 'Data controls', icon: Database, detail: 'Cache, drafts, and local reset' },
  { id: 'diagnostics', label: 'Diagnostics', icon: Gauge, detail: 'Runtime and connection details' },
]

export function MobileSettingsScreen({ preferences, online, runtime, onChange, onClose, onUnpair }: Props) {
  const [active, setActive] = useState<SettingsSection | null>(null)
  const [query, setQuery] = useState('')
  const [control, setControl] = useState<MobileControlSettings | null>(null)
  const [models, setModels] = useState<MobileModelSummary[]>([])
  const [diagnostics, setDiagnostics] = useState<MobileDiagnostics | null>(null)
  const [loadingRemote, setLoadingRemote] = useState(false)
  const [notice, setNotice] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return sections
    return sections.filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(needle))
  }, [query])

  const refreshRemote = useCallback(async () => {
    if (!online) return
    setLoadingRemote(true)
    try {
      const [nextControl, nextModels, nextDiagnostics] = await Promise.all([
        getMobileControlSettings(), getMobileModels(), getMobileDiagnostics(),
      ])
      setControl(nextControl)
      setModels(nextModels)
      setDiagnostics(nextDiagnostics)
      setNotice('')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load PC controls.')
    } finally { setLoadingRemote(false) }
  }, [online])

  useEffect(() => { void refreshRemote() }, [refreshRemote])

  async function patchControl(change: Partial<Omit<MobileControlSettings, 'revision'>>) {
    if (!control) return
    const previous = control
    setControl({ ...control, ...change })
    try {
      setControl(await updateMobileControlSettings(control.revision, change))
      setNotice('Saved on your PC')
      window.setTimeout(() => setNotice(''), 1600)
    } catch (error) {
      setControl(previous)
      setNotice(error instanceof Error ? error.message : 'That setting could not be saved.')
      if ((error as { status?: number }).status === 409) void refreshRemote()
    }
  }

  return <div className="settings-screen">
    <header className="settings-header">
      <button onClick={() => active ? setActive(null) : onClose()} aria-label={active ? 'Back to settings' : 'Close settings'}><ChevronLeft size={22} /></button>
      <strong>{active ? sections.find((item) => item.id === active)?.label : 'Settings'}</strong>
      <span />
    </header>

    {!active ? <div className="settings-home">
      <div className="settings-profile">
        <img src="/nebula-icon.png" alt="" />
        <div><strong>Nebula</strong><span>{online ? 'Connected privately' : 'PC offline'}</span></div>
      </div>
      <label className="settings-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search settings" /></label>
      <div className="settings-section-list">{filtered.map((item) => <button key={item.id} onClick={() => setActive(item.id)}>
        <i><item.icon size={18} /></i><span><strong>{item.label}</strong><small>{item.detail}</small></span><ChevronLeft className="settings-chevron" size={16} />
      </button>)}</div>
      <p className="settings-version">Nebula Mobile 1.0</p>
    </div> : <div className="settings-detail">
      {active === 'appearance' && <>
        <Group title="Theme">
          <Choice label="Appearance" value={preferences.theme} options={[['system','System'],['dark','Dark'],['light','Light']]} onChange={(theme) => onChange({ theme: theme as MobilePreferences['theme'] })} />
          <Range label="Text size" value={preferences.textScale} min={0.85} max={1.3} step={0.05} display={`${Math.round(preferences.textScale * 100)}%`} onChange={(textScale) => onChange({ textScale })} />
          <Range label="Nebula accent" value={preferences.accentIntensity} min={0} max={1} step={0.1} display={`${Math.round(preferences.accentIntensity * 100)}%`} onChange={(accentIntensity) => onChange({ accentIntensity })} />
        </Group>
        <Group title="Layout">
          <Toggle label="Compact messages" detail="Reduce spacing between messages" checked={preferences.compactMessages} onChange={(compactMessages) => onChange({ compactMessages })} />
          <Toggle label="Show timestamps" checked={preferences.showTimestamps} onChange={(showTimestamps) => onChange({ showTimestamps })} />
          <Toggle label="Wrap code" checked={preferences.wrapCode} onChange={(wrapCode) => onChange({ wrapCode })} />
        </Group>
        <Group title="Accessibility">
          <Toggle label="Reduce motion" checked={preferences.reducedMotion} onChange={(reducedMotion) => onChange({ reducedMotion })} />
          <Toggle label="Reduce transparency" checked={preferences.reducedTransparency} onChange={(reducedTransparency) => onChange({ reducedTransparency })} />
          <Toggle label="High contrast" checked={preferences.highContrast} onChange={(highContrast) => onChange({ highContrast })} />
          <Toggle label="Haptic feedback" checked={preferences.haptics} onChange={(haptics) => onChange({ haptics })} />
        </Group>
      </>}

      {active === 'chat' && <>
        <Group title="Responses">
          <Toggle label="Stream responses" detail="Show words as Nebula generates them" checked={preferences.streamResponses} onChange={(streamResponses) => onChange({ streamResponses })} />
          <Toggle label="Keep latest message visible" checked={preferences.autoScroll} onChange={(autoScroll) => onChange({ autoScroll })} />
          <Toggle label="Show tool activity" checked={preferences.showToolActivity} onChange={(showToolActivity) => onChange({ showToolActivity })} />
          <Toggle label="Completion sound" checked={preferences.completionSound} onChange={(completionSound) => onChange({ completionSound })} />
        </Group>
        <Group title="Composer">
          <Toggle label="Save drafts" checked={preferences.persistDrafts} onChange={(persistDrafts) => onChange({ persistDrafts })} />
          <Toggle label="Return sends message" detail="Otherwise Return creates a new line" checked={preferences.submitOnEnter} onChange={(submitOnEnter) => onChange({ submitOnEnter })} />
        </Group>
      </>}

      {active === 'voice' && <>
        <Group title="Voice input">
          <Choice label="Language" value={preferences.voiceLanguage} options={[["en-US","English (US)"],["en-GB","English (UK)"],["sq-AL","Albanian"],["de-DE","German"],["fr-FR","French"],["it-IT","Italian"],["es-ES","Spanish"]]} onChange={(voiceLanguage) => onChange({ voiceLanguage })} />
          <Toggle label="Read replies aloud" checked={preferences.readAloud} onChange={(readAloud) => onChange({ readAloud })} />
          <Range label="Speaking rate" value={preferences.speechRate} min={0.6} max={1.6} step={0.1} display={`${preferences.speechRate.toFixed(1)}x`} onChange={(speechRate) => onChange({ speechRate })} />
          <Range label="Voice pitch" value={preferences.speechPitch} min={0.6} max={1.4} step={0.1} display={preferences.speechPitch.toFixed(1)} onChange={(speechPitch) => onChange({ speechPitch })} />
        </Group>
      </>}

      {active === 'models' && <RemoteState online={online} loading={loadingRemote} control={control} retry={refreshRemote}>{control && <>
        <Group title="Routing">
          <Choice label="Mode" value={control.modelMode} options={[["auto","Automatic"],["fast","Fast"],["code","Code"],["review","Review"]]} onChange={(modelMode) => void patchControl({ modelMode: modelMode as MobileControlSettings['modelMode'] })} />
          <Toggle label="Use one model" checked={control.singleModelEnabled} onChange={(singleModelEnabled) => void patchControl({ singleModelEnabled })} />
          {control.singleModelEnabled ? <ModelChoice label="Model" value={control.singleModel} models={models} onChange={(singleModel) => void patchControl({ singleModel })} /> : <>
            <ModelChoice label="Daily" value={control.dailyModel} models={models} onChange={(dailyModel) => void patchControl({ dailyModel })} />
            <ModelChoice label="Code" value={control.codeModel} models={models} onChange={(codeModel) => void patchControl({ codeModel })} />
            <ModelChoice label="Review" value={control.reviewModel} models={models} onChange={(reviewModel) => void patchControl({ reviewModel })} />
          </>}
        </Group>
        <Group title="Loading">
          <Toggle label="Auto-load routed model" checked={control.autoLoadModels} onChange={(autoLoadModels) => void patchControl({ autoLoadModels })} />
          <Toggle label="Keep daily model warm" checked={control.keepDailyModelWarm} onChange={(keepDailyModelWarm) => void patchControl({ keepDailyModelWarm })} />
          <Toggle label="Warm while typing" checked={control.warmModelWhileTyping} onChange={(warmModelWhileTyping) => void patchControl({ warmModelWhileTyping })} />
          <Toggle label="Preload coder in projects" checked={control.backgroundPreloadCodeModel} onChange={(backgroundPreloadCodeModel) => void patchControl({ backgroundPreloadCodeModel })} />
          <Toggle label="Automatic review pass" checked={control.enableAutomaticReviewPass} onChange={(enableAutomaticReviewPass) => void patchControl({ enableAutomaticReviewPass })} />
        </Group>
        <Group title="Generation">
          <Range label="Temperature" value={control.temperature} min={0} max={1.5} step={0.05} display={control.temperature.toFixed(2)} onChange={(temperature) => void patchControl({ temperature })} />
          <Range label="Maximum tokens" value={control.maxTokens} min={256} max={16384} step={256} display={control.maxTokens.toLocaleString()} onChange={(maxTokens) => void patchControl({ maxTokens })} />
        </Group>
      </>}</RemoteState>}

      {active === 'assistant' && <RemoteState online={online} loading={loadingRemote} control={control} retry={refreshRemote}>{control && <>
        <Group title="Context and memory">
          <Toggle label="Project context" checked={control.contextInjectionEnabled} onChange={(contextInjectionEnabled) => void patchControl({ contextInjectionEnabled })} />
          <Range label="Context budget" value={control.contextBudgetChars} min={4000} max={64000} step={2000} display={`${Math.round(control.contextBudgetChars / 1000)}K`} onChange={(contextBudgetChars) => void patchControl({ contextBudgetChars })} />
          <Choice label="Memory saves" value={control.memoryReviewMode} options={[["suggest","Suggest"],["auto","Automatic"],["manual","Manual"]]} onChange={(memoryReviewMode) => void patchControl({ memoryReviewMode: memoryReviewMode as MobileControlSettings['memoryReviewMode'] })} />
        </Group>
        <Group title="Research and safety">
          <Toggle label="Search web when needed" checked={control.autoWebSearch} onChange={(autoWebSearch) => void patchControl({ autoWebSearch })} />
          <Range label="Maximum pages" value={control.maxAutoFetchPages} min={1} max={8} step={1} display={String(control.maxAutoFetchPages)} onChange={(maxAutoFetchPages) => void patchControl({ maxAutoFetchPages })} />
          <Choice label="Action mode" value={control.actionMode} options={[["fast","Fast"],["guarded","Guarded"],["strict","Strict"]]} onChange={(actionMode) => void patchControl({ actionMode: actionMode as MobileControlSettings['actionMode'] })} />
        </Group>
      </>}</RemoteState>}

      {active === 'connection' && <>
        <Group title="Private bridge">
          <label className="setting-field"><span><strong>PC address</strong><small>Tailscale HTTPS only</small></span><input value={preferences.bridgeUrl} onChange={(event) => onChange({ bridgeUrl: event.target.value })} inputMode="url" autoCapitalize="none" /></label>
          <Toggle label="Reconnect automatically" checked={preferences.autoReconnect} onChange={(autoReconnect) => onChange({ autoReconnect })} />
          <InfoRow label="Status" value={online ? 'Connected' : 'Offline'} />
          <InfoRow label="Model" value={runtime.model || 'Not reported'} />
          <button className="settings-action" onClick={() => void refreshRemote()}><RefreshCw size={17} /> Test connection</button>
        </Group>
        <button className="settings-danger" onClick={onUnpair}><Unplug size={17} /> Disconnect this iPhone</button>
      </>}

      {active === 'data' && <>
        <Group title="On this iPhone">
          <Toggle label="Cache conversation summaries" checked={preferences.cacheHistory} onChange={(cacheHistory) => onChange({ cacheHistory })} />
          <Toggle label="Save conversation drafts" checked={preferences.persistDrafts} onChange={(persistDrafts) => onChange({ persistDrafts })} />
          <button className="settings-action" onClick={() => void deletePrivateValue('conversation-cache').then(() => setNotice('Phone cache cleared'))}><Database size={17} /> Clear conversation cache</button>
          <button className="settings-action" onClick={() => { onChange({ ...preferences, theme: 'dark', textScale: 1, compactMessages: false, reducedMotion: false, reducedTransparency: false, highContrast: false }); setNotice('Appearance reset') }}><RefreshCw size={17} /> Reset appearance</button>
        </Group>
        <p className="settings-note">Clearing the phone cache does not delete conversations stored on your PC.</p>
      </>}

      {active === 'diagnostics' && <>
        <Group title="Developer display">
          <Toggle label="Show model name in chat" checked={preferences.showModelName} onChange={(showModelName) => onChange({ showModelName })} />
          <Toggle label="Show connection diagnostics" checked={preferences.showDiagnostics} onChange={(showDiagnostics) => onChange({ showDiagnostics })} />
        </Group>
        <Group title="Runtime">
          <InfoRow label="Service" value={diagnostics?.service || runtime.service || 'Unknown'} />
          <InfoRow label="Agent" value={diagnostics?.agentStatus || runtime.agentStatus || 'Unknown'} />
          <InfoRow label="Active model" value={diagnostics?.activeModel || runtime.model || 'None'} />
          <InfoRow label="Memory" value={(diagnostics?.memoryReady ?? runtime.memoryReady) ? 'Ready' : 'Not ready'} />
          <InfoRow label="Bridge latency" value={diagnostics ? `${diagnostics.bridgeLatencyMs} ms` : 'Not measured'} />
          <button className="settings-action" onClick={() => void refreshRemote()}><RefreshCw size={17} /> Refresh diagnostics</button>
        </Group>
        <div className="settings-about"><Info size={18} /><div><strong>Nebula Mobile</strong><span>Private companion for Nebula Desktop</span></div></div>
      </>}
    </div>}
    {notice && <div className="settings-notice">{notice}</div>}
  </div>
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="setting-group"><h3>{title}</h3><div>{children}</div></section>
}

function Toggle({ label, detail, checked, onChange }: { label: string; detail?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="setting-row"><span><strong>{label}</strong>{detail && <small>{detail}</small>}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i className="switch" /></label>
}

function Choice({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (value: string) => void }) {
  return <label className="setting-field"><span><strong>{label}</strong></span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
}

function ModelChoice({ label, value, models, onChange }: { label: string; value: string; models: MobileModelSummary[]; onChange: (value: string) => void }) {
  const options = models.some((model) => model.key === value) || !value ? models : [{ key: value, displayName: value, loaded: false }, ...models]
  return <label className="setting-field"><span><strong>{label}</strong></span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Choose model</option>{options.map((model) => <option key={model.key} value={model.key}>{model.displayName}{model.loaded ? ' - loaded' : ''}</option>)}</select></label>
}

function Range({ label, value, min, max, step, display, onChange }: { label: string; value: number; min: number; max: number; step: number; display: string; onChange: (value: number) => void }) {
  return <label className="setting-range"><span><strong>{label}</strong><small>{display}</small></span><input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} /></label>
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="setting-info"><span>{label}</span><strong>{value}</strong></div>
}

function RemoteState({ online, loading, control, retry, children }: { online: boolean; loading: boolean; control: MobileControlSettings | null; retry: () => Promise<void>; children: React.ReactNode }) {
  if (!online) return <div className="settings-empty"><Wifi size={24} /><strong>PC offline</strong><p>Wake the PC and open Nebula to change assistant settings.</p></div>
  if (loading && !control) return <div className="settings-empty"><RefreshCw className="spin" size={24} /><strong>Loading PC settings</strong></div>
  if (!control) return <div className="settings-empty"><MonitorCog size={24} /><strong>Settings unavailable</strong><button onClick={() => void retry()}>Try again</button></div>
  return <>{children}</>
}
