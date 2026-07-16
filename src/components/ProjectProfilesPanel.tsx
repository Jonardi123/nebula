import { RefreshCw, Save, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { detectProjectProfile, getProjectProfiles, saveProjectProfile } from '../lib/projectProfiles'
import type { LogEvent } from '../types/agent'
import type { ProjectProfile } from '../types/nebula'
import type { AppSettings } from '../types/settings'

interface Props {
  settings: AppSettings
  onChange: (settings: AppSettings) => void
  onLog: (type: LogEvent['type'], message: string, details?: unknown) => void
}

export function ProjectProfilesPanel({ settings, onChange, onLog }: Props) {
  const [profiles, setProfiles] = useState<ProjectProfile[]>([])
  const [selectedId, setSelectedId] = useState(settings.activeProjectProfileId)
  const selected = profiles.find((profile) => profile.id === selectedId) ?? profiles[0] ?? null

  function refresh() {
    const next = getProjectProfiles()
    setProfiles(next)
    if (!selectedId && next[0]) setSelectedId(next[0].id)
  }

  async function detectCurrent() {
    if (!settings.projectFolder) {
      onLog('error', 'Choose a project folder before detecting a profile.')
      return
    }
    try {
      const profile = await detectProjectProfile(settings.projectFolder, settings)
      setProfiles(getProjectProfiles())
      setSelectedId(profile.id)
      onChange({ ...settings, activeProjectProfileId: profile.id })
      onLog('status', `Project profile updated: ${profile.name}`)
    } catch (error) {
      onLog('error', `Project profile detection failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function patch(update: Partial<ProjectProfile>) {
    if (!selected) return
    const saved = saveProjectProfile({ ...selected, ...update })
    setProfiles(getProjectProfiles())
    setSelectedId(saved.id)
    onLog('status', `Project profile saved: ${saved.name}`)
  }

  function setActive(profile: ProjectProfile) {
    onChange({ ...settings, activeProjectProfileId: profile.id, projectFolder: profile.folder })
    setSelectedId(profile.id)
    onLog('status', `Active project profile: ${profile.name}`)
  }

  useEffect(refresh, [settings.activeProjectProfileId])

  return (
    <div className="space-y-3 p-3 text-xs">
      <button className="nebula-button-primary flex w-full items-center justify-center gap-2 px-3 py-2" type="button" onClick={detectCurrent}>
        <RefreshCw size={13} />
        Detect Current Project
      </button>

      <div className="space-y-2">
        {profiles.map((profile) => (
          <button
            key={profile.id}
            className={`skill-card w-full rounded-md border p-3 text-left ${profile.id === selected?.id ? 'border-cyan-300/35 bg-cyan-300/10' : 'border-slate-800 bg-slate-950'}`}
            type="button"
            onClick={() => setSelectedId(profile.id)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-100">{profile.name}</div>
                <div className="mt-1 truncate text-[11px] text-slate-500">{profile.folder}</div>
              </div>
              {settings.activeProjectProfileId === profile.id && (
                <span className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[11px] text-emerald-100">active</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-300">
              <span className="rounded-md bg-slate-800 px-2 py-1">{profile.detectedFramework}</span>
              <span className="rounded-md bg-slate-800 px-2 py-1">{profile.packageManager}</span>
              <span className="rounded-md bg-slate-800 px-2 py-1">{profile.commonScripts.length} scripts</span>
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <section className="rounded-md border border-slate-800 bg-slate-950 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-100">Edit Profile</h3>
            <button className="nebula-toggle flex items-center gap-1 px-2 py-1" type="button" onClick={() => setActive(selected)}>
              <Star size={12} />
              Active
            </button>
          </div>
          <Field label="Name" value={selected.name} onChange={(name) => patch({ name })} />
          <Field label="Framework" value={selected.detectedFramework} onChange={(detectedFramework) => patch({ detectedFramework })} />
          <Field label="Package manager" value={selected.packageManager} onChange={(packageManager) => patch({ packageManager })} />
          <TextArea label="Common scripts" value={selected.commonScripts.join('\n')} onChange={(value) => patch({ commonScripts: lines(value) })} />
          <TextArea label="Ignored folders" value={selected.ignoredFolders.join('\n')} onChange={(value) => patch({ ignoredFolders: lines(value) })} />
          <TextArea label="Summary" value={selected.summary} onChange={(summary) => patch({ summary })} />
          <TextArea label="Notes" value={selected.notes} onChange={(notes) => patch({ notes })} />
          <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
            <Save size={12} />
            Autosaves on edit
          </div>
        </section>
      )}
    </div>
  )
}

function lines(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="mb-2 block space-y-1">
      <span className="text-slate-400">{label}</span>
      <input className="nebula-input w-full px-2 py-2 outline-none" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="mb-2 block space-y-1">
      <span className="text-slate-400">{label}</span>
      <textarea className="nebula-input min-h-20 w-full resize-none px-2 py-2 outline-none" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}
