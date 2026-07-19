import { CheckCircle2, ChevronDown, FolderOpen, LoaderCircle, PlugZap, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { checkLmStudio, listLmStudioModelInfos } from '../lib/lmstudio'
import type { ModelInfo } from '../types/nebula'
import type { AppSettings } from '../types/settings'

interface Props {
  open: boolean
  settings: AppSettings
  onChange: (settings: AppSettings) => void
  onClose: () => void
}

function modelScore(model: ModelInfo) {
  const id = `${model.id} ${model.displayName}`.toLowerCase()
  if (/nebula.*qwen|qwen.*nebula|qwen2\.5-coder-1\.5b-v1/.test(id)) return 100
  if (model.loaded) return 60
  if (/instruct|chat/.test(id)) return 30
  return 10
}

function recommendedModel(models: ModelInfo[], configured: string) {
  if (models.length === 0) return configured
  return [...models].sort((left, right) => modelScore(right) - modelScore(left))[0]?.id || configured
}

function codingModel(models: ModelInfo[], fallback: string) {
  return models.find((model) => /coder|code/i.test(`${model.id} ${model.displayName}`))?.id || fallback
}

function reviewModel(models: ModelInfo[], fallback: string) {
  return models.find((model) => /review|gpt-oss|20b|14b/i.test(`${model.id} ${model.displayName}`))?.id || fallback
}

export function SetupWizard({ open: isOpen, settings, onChange, onClose }: Props) {
  const [discovering, setDiscovering] = useState(false)
  const [online, setOnline] = useState(false)
  const [status, setStatus] = useState('Checking your local AI...')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [selectedModel, setSelectedModel] = useState(settings.modelAssignments?.daily || settings.fastModel || settings.model)
  const [projectFolder, setProjectFolder] = useState(settings.projectFolder)
  const [memoryFolder, setMemoryFolder] = useState(settings.memoryFolder || 'memory')
  const [detailsOpen, setDetailsOpen] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setDiscovering(true)
    setStatus('Checking your local AI...')
    void Promise.allSettled([checkLmStudio(settings), listLmStudioModelInfos(settings)]).then(([healthResult, modelsResult]) => {
      if (cancelled) return
      const discovered = modelsResult.status === 'fulfilled' ? modelsResult.value : []
      const reachable = healthResult.status === 'fulfilled' ? healthResult.value.online : modelsResult.status === 'fulfilled'
      setModels(discovered)
      setOnline(reachable)
      const recommendation = recommendedModel(discovered, selectedModel)
      setSelectedModel(recommendation)
      if (reachable && discovered.length) setStatus(`${discovered.length} local model${discovered.length === 1 ? '' : 's'} found. Nebula is ready.`)
      else if (reachable) setStatus('LM Studio is connected, but no local models were found.')
      else setStatus('LM Studio is offline. You can finish now and connect it later.')
    }).finally(() => {
      if (!cancelled) setDiscovering(false)
    })
    return () => { cancelled = true }
    // Setup discovery intentionally runs once each time the wizard opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const selectedInfo = useMemo(() => models.find((model) => model.id === selectedModel), [models, selectedModel])

  if (!isOpen) return null

  async function chooseProject() {
    const selected = await open({ directory: true, multiple: false, title: 'Choose an optional project folder' })
    const path = Array.isArray(selected) ? selected[0] : selected
    if (path) setProjectFolder(path)
  }

  function finish() {
    const daily = selectedModel || settings.modelAssignments?.daily || settings.fastModel || settings.model
    const code = codingModel(models, settings.modelAssignments?.code || settings.codeModel || daily)
    const review = reviewModel(models, settings.modelAssignments?.review || settings.reviewModel || code)
    onChange({
      ...settings,
      experienceMode: 'simple',
      modelProvider: 'lmstudio',
      model: daily,
      fastModel: daily,
      codeModel: code,
      reviewModel: review,
      modelAssignments: { daily, code, review },
      modelMode: 'auto',
      autoLoadModels: true,
      projectFolder,
      memoryFolder: memoryFolder || 'memory',
      setupWizardCompleted: true,
      setupWizardLastRunAt: new Date().toISOString(),
      showModelDebugInfo: false,
    })
    onClose()
  }

  return (
    <div className="setup-wizard-backdrop" role="presentation">
      <section className="setup-wizard setup-wizard-simple" role="dialog" aria-modal="true" aria-label="Set up Nebula">
        <header className="setup-wizard-header">
          <div>
            <div className="setup-wizard-kicker">Private. Local. Yours.</div>
            <h2>Meet Nebula</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close setup"><X size={16} /></button>
        </header>

        <main className="setup-wizard-body">
          <section className="setup-wizard-card setup-ready-card">
            <div className="setup-wizard-card-title">
              {discovering ? <LoaderCircle className="setup-spin" size={18} /> : online ? <CheckCircle2 size={18} /> : <PlugZap size={18} />}
              <h3>{discovering ? 'Getting ready' : online ? 'Local AI connected' : 'Connect when ready'}</h3>
            </div>
            <p>{status}</p>
            {selectedModel && <label>
              Recommended assistant
              <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
                {!models.some((model) => model.id === selectedModel) && <option value={selectedModel}>{selectedModel} (configured)</option>}
                {models.map((model) => <option key={model.id} value={model.id}>{model.displayName || model.id}{model.loaded ? ' - ready' : ''}</option>)}
              </select>
              {selectedInfo && <small>{selectedInfo.loaded ? 'Already loaded and ready to answer.' : 'Nebula will load this model when needed.'}</small>}
            </label>}
          </section>

          <button type="button" className="setup-project-choice" onClick={() => void chooseProject()}>
            <FolderOpen size={17} />
            <span><strong>{projectFolder ? projectFolder.split(/[\\/]/).filter(Boolean).at(-1) : 'Choose a project later'}</strong><small>{projectFolder || 'Optional. Chat works without a project.'}</small></span>
          </button>

          <details className="setup-details" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
            <summary><ChevronDown size={14} />Change setup</summary>
            <label>LM Studio endpoint<input value={settings.endpoint} onChange={(event) => onChange({ ...settings, endpoint: event.target.value })} /></label>
            <label>Memory folder<input value={memoryFolder} onChange={(event) => setMemoryFolder(event.target.value)} /></label>
          </details>

          <div className="setup-privacy-note"><Sparkles size={14} /><span>Your conversations, memory, and tools stay on this PC unless you explicitly use a web or cloud feature.</span></div>
        </main>

        <footer className="setup-wizard-footer setup-wizard-footer-simple">
          <button type="button" className="setup-wizard-primary" onClick={finish}>Continue to Nebula</button>
        </footer>
      </section>
    </div>
  )
}
