import { ChevronLeft, ChevronRight, FolderOpen, PlugZap, Shield, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { checkLmStudio, listLmStudioModelInfos } from '../lib/lmstudio'
import type { SetupWizardState } from '../types/nebula'
import type { AppSettings } from '../types/settings'

const steps: SetupWizardState['step'][] = ['welcome', 'lmstudio', 'workspace', 'permissions']

interface Props {
  open: boolean
  settings: AppSettings
  onChange: (settings: AppSettings) => void
  onClose: () => void
}

export function SetupWizard({ open, settings, onChange, onClose }: Props) {
  const [stepIndex, setStepIndex] = useState(0)
  const [checking, setChecking] = useState(false)
  const [checkMessage, setCheckMessage] = useState('')
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([])
  const [draft, setDraft] = useState<SetupWizardState>(() => ({
    step: 'welcome',
    checkedLmStudio: false,
    lmStudioOnline: false,
    selectedProjectFolder: settings.projectFolder,
    selectedMemoryFolder: settings.memoryFolder,
    dailyModel: settings.modelAssignments?.daily || settings.fastModel,
    codeModel: settings.modelAssignments?.code || settings.codeModel,
    reviewModel: settings.modelAssignments?.review || settings.reviewModel,
  }))
  const step = steps[stepIndex]
  const progress = useMemo(() => Math.round(((stepIndex + 1) / steps.length) * 100), [stepIndex])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void listLmStudioModelInfos(settings).then((models) => {
      if (cancelled) return
      const ids = models.map((model) => model.id)
      setDiscoveredModels(ids)
      const recommended = ids.find((id) => /nebula.*qwen|qwen.*nebula/i.test(id))
      if (recommended && !ids.includes(draft.dailyModel)) patch({ dailyModel: recommended })
    }).catch(() => setDiscoveredModels([]))
    return () => { cancelled = true }
  }, [draft.dailyModel, open, settings])

  if (!open) return null

  function patch(update: Partial<SetupWizardState>) {
    setDraft((current) => ({ ...current, ...update }))
  }

  async function runConnectionCheck() {
    setChecking(true)
    setCheckMessage('')
    try {
      const status = await checkLmStudio({ ...settings, model: draft.dailyModel || settings.model })
      patch({ checkedLmStudio: true, lmStudioOnline: status.online })
      setCheckMessage(status.online ? 'LM Studio responded. If a model is unloaded, Nebula can still auto-load it later.' : status.error ?? 'LM Studio did not respond.')
    } catch (error) {
      patch({ checkedLmStudio: true, lmStudioOnline: false })
      setCheckMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setChecking(false)
    }
  }

  function finish() {
    const now = new Date().toISOString()
    onChange({
      ...settings,
      modelProvider: 'lmstudio',
      model: draft.dailyModel || settings.model,
      fastModel: draft.dailyModel || settings.fastModel,
      codeModel: draft.codeModel || settings.codeModel,
      reviewModel: draft.reviewModel || settings.reviewModel,
      modelAssignments: {
        daily: draft.dailyModel || settings.modelAssignments.daily,
        code: draft.codeModel || settings.modelAssignments.code,
        review: draft.reviewModel || settings.modelAssignments.review,
      },
      projectFolder: draft.selectedProjectFolder,
      memoryFolder: draft.selectedMemoryFolder || 'memory',
      setupWizardCompleted: true,
      setupWizardLastRunAt: now,
      overlayQuickActionsEnabled: true,
      modelProfilerEnabled: true,
    })
    onClose()
  }

  return (
    <div className="setup-wizard-backdrop" role="presentation">
      <section className="setup-wizard" role="dialog" aria-modal="true" aria-label="Nebula setup wizard">
        <header className="setup-wizard-header">
          <div>
            <div className="setup-wizard-kicker">Nebula setup</div>
            <h2>{titleForStep(step)}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close setup wizard">
            <X size={16} />
          </button>
        </header>

        <div className="setup-wizard-progress">
          <span style={{ width: `${progress}%` }} />
        </div>

        <main className="setup-wizard-body">
          {step === 'welcome' && (
            <WizardCard icon={<Sparkles size={18} />} title="Local-first command center">
              <p>This wizard checks the basics: LM Studio endpoint, model roles, workspace, memory, permissions, and daily-use defaults.</p>
              <p>No cloud keys are required and no model is forcibly unloaded.</p>
            </WizardCard>
          )}

          {step === 'lmstudio' && (
            <WizardCard icon={<PlugZap size={18} />} title="Provider and models">
              <label>
                Endpoint
                <input value={settings.endpoint} onChange={(event) => onChange({ ...settings, endpoint: event.target.value })} />
              </label>
              <button type="button" className="setup-wizard-primary" onClick={runConnectionCheck} disabled={checking}>
                {checking ? 'Checking...' : 'Check LM Studio'}
              </button>
              {checkMessage && <p className={draft.lmStudioOnline ? 'setup-good' : 'setup-warn'}>{checkMessage}</p>}
              {!draft.lmStudioOnline && <p className="setup-warn">You can finish setup offline and reconnect from Model Doctor later.</p>}
              <ModelField label="Daily chat model" value={draft.dailyModel} models={discoveredModels} onChange={(dailyModel) => patch({ dailyModel })} />
              <ModelField label="Coding model" value={draft.codeModel} models={discoveredModels} onChange={(codeModel) => patch({ codeModel })} />
              <ModelField label="Review model" value={draft.reviewModel} models={discoveredModels} onChange={(reviewModel) => patch({ reviewModel })} />
            </WizardCard>
          )}

          {step === 'workspace' && (
            <WizardCard icon={<FolderOpen size={18} />} title="Workspace and memory">
              <label>
                Project folder
                <input value={draft.selectedProjectFolder} onChange={(event) => patch({ selectedProjectFolder: event.target.value })} placeholder="Optional project folder path" />
              </label>
              <label>
                Memory folder
                <input value={draft.selectedMemoryFolder} onChange={(event) => patch({ selectedMemoryFolder: event.target.value })} placeholder="memory" />
              </label>
            </WizardCard>
          )}

          {step === 'permissions' && (
            <WizardCard icon={<Shield size={18} />} title="Recommended permissions">
              <PermissionToggle label="Auto-load routed models" checked={settings.autoLoadModels} onChange={(autoLoadModels) => onChange({ ...settings, autoLoadModels })} />
              <PermissionToggle label="Keep daily model warm" checked={settings.keepDailyModelWarm} onChange={(keepDailyModelWarm) => onChange({ ...settings, keepDailyModelWarm })} />
              <PermissionToggle label="Automation scheduler" checked={settings.automationSchedulerEnabled} onChange={(automationSchedulerEnabled) => onChange({ ...settings, automationSchedulerEnabled })} />
              <PermissionToggle label="Voice input" checked={settings.voiceEnabled} onChange={(voiceEnabled) => onChange({ ...settings, voiceEnabled })} />
              <PermissionToggle label="Screenshot Ask Mode" checked={settings.screenshotAskEnabled} onChange={(screenshotAskEnabled) => onChange({ ...settings, screenshotAskEnabled })} />
            </WizardCard>
          )}

        </main>

        <footer className="setup-wizard-footer">
          <button type="button" disabled={stepIndex === 0} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}>
            <ChevronLeft size={14} />
            Back
          </button>
          {step === 'permissions' ? (
            <button type="button" className="setup-wizard-primary" onClick={finish}>
              Finish setup
            </button>
          ) : (
            <button type="button" className="setup-wizard-primary" onClick={() => setStepIndex((current) => Math.min(steps.length - 1, current + 1))}>
              Next
              <ChevronRight size={14} />
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}

function titleForStep(step: SetupWizardState['step']) {
  if (step === 'lmstudio') return 'Connect LM Studio'
  if (step === 'workspace') return 'Choose workspace'
  if (step === 'permissions') return 'Set permissions'
  return 'Welcome'
}

function WizardCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="setup-wizard-card">
      <div className="setup-wizard-card-title">
        {icon}
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  )
}

function ModelField({ label, value, models, onChange }: { label: string; value: string; models: string[]; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {value && !models.includes(value) && <option value={value}>{value} (configured)</option>}
        {models.length === 0 && !value && <option value="">Discover after setup</option>}
        {models.map((model) => <option key={model} value={model}>{model}</option>)}
      </select>
    </label>
  )
}

function PermissionToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="setup-permission-toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}
