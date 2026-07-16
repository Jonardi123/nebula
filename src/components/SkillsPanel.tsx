import { Activity, CheckCircle2, Clock, Download, Gauge, Layers, Package, Search, Shield, Sparkles, Trash2, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { getSkillDrafts, saveSkillDraft } from '../lib/skillBuilder'
import {
  getInstalledSkills,
  getMarketplaceItems,
  installMarketplaceItem,
  getSkillRuntimeStat,
  setSkillEnabled,
  uninstallMarketplaceItem,
} from '../skills'
import type { MarketplaceItem, SkillDefinition } from '../skills'
import type { SkillCategory } from '../skills/types'

interface Props {
  skillsVersion: number
  onSkillsChange: () => void
}

const riskTone: Record<SkillDefinition['riskLevel'], string> = {
  safe: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
  needs_approval: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
  high_risk: 'text-red-300 border-red-500/30 bg-red-500/10',
  blocked: 'text-red-200 border-red-400/40 bg-red-500/20',
}

export function SkillsPanel({ skillsVersion, onSkillsChange }: Props) {
  const [view, setView] = useState<'installed' | 'marketplace' | 'builder'>('installed')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<'all' | SkillCategory>('all')
  const [draft, setDraft] = useState({
    name: '',
    description: '',
    permissions: '',
    exposedTools: '',
    promptAdditions: '',
    examples: '',
    riskLevel: 'safe' as SkillDefinition['riskLevel'],
  })
  const skills = getInstalledSkills()
  const categories = useMemo(
    () => Array.from(new Set(skills.map((skill) => skill.category).filter(Boolean))) as SkillCategory[],
    [skills, skillsVersion],
  )
  const filteredSkills = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return skills.filter((skill) => {
      const matchesCategory = category === 'all' || skill.category === category
      const haystack = [
        skill.name,
        skill.description,
        skill.category,
        skill.version,
        skill.requiredPermissions.join(' '),
        skill.requiredTools?.join(' '),
        skill.keywords?.join(' '),
        skill.tools.map((tool) => tool.name).join(' '),
      ].join(' ').toLowerCase()
      return matchesCategory && (!needle || haystack.includes(needle))
    })
  }, [skills, query, category, skillsVersion])
  const marketplaceItems = getMarketplaceItems()
  const filteredMarketplace = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return marketplaceItems
    return marketplaceItems.filter((item) =>
      [item.name, item.description, item.category, item.author, item.tags.join(' ')].join(' ').toLowerCase().includes(needle),
    )
  }, [marketplaceItems, query, skillsVersion])

  function toggle(skillId: string, enabled: boolean) {
    setSkillEnabled(skillId, enabled)
    onSkillsChange()
  }

  function install(item: MarketplaceItem) {
    installMarketplaceItem(item.id)
    setSkillEnabled(item.installedSkill.id, true)
    onSkillsChange()
    setView('installed')
  }

  function uninstall(item: MarketplaceItem) {
    uninstallMarketplaceItem(item.id)
    onSkillsChange()
  }

  function saveDraft() {
    const name = draft.name.trim()
    if (!name) return
    saveSkillDraft({
      name,
      description: draft.description.trim() || 'Local prompt skill pack.',
      permissions: lines(draft.permissions),
      exposedTools: lines(draft.exposedTools).map((line) => {
        const [toolName, ...description] = line.split(':')
        return { name: toolName.trim(), description: description.join(':').trim() || 'Declared metadata only.' }
      }),
      promptAdditions: lines(draft.promptAdditions),
      examples: lines(draft.examples),
      riskLevel: draft.riskLevel,
      enabled: true,
    })
    setDraft({
      name: '',
      description: '',
      permissions: '',
      exposedTools: '',
      promptAdditions: '',
      examples: '',
      riskLevel: 'safe',
    })
    onSkillsChange()
    setView('installed')
  }

  return (
    <div className="space-y-3 p-3">
      <div className="settings-switch grid grid-cols-3 gap-1 rounded-[10px] border border-white/10 bg-white/[0.035] p-1">
        <button className={view === 'installed' ? 'settings-switch-active' : ''} type="button" onClick={() => setView('installed')}>
          Installed
        </button>
        <button className={view === 'marketplace' ? 'settings-switch-active' : ''} type="button" onClick={() => setView('marketplace')}>
          Marketplace
        </button>
        <button className={view === 'builder' ? 'settings-switch-active' : ''} type="button" onClick={() => setView('builder')}>
          Builder
        </button>
      </div>

      {view === 'builder' ? (
        <SkillBuilder
          draft={draft}
          onDraftChange={setDraft}
          onSave={saveDraft}
          draftsCount={getSkillDrafts().length}
        />
      ) : view === 'marketplace' ? (
        <>
          <div className="marketplace-search flex items-center gap-2 px-3 py-2">
            <Search size={14} className="text-cyan-200" />
            <input
              className="min-w-0 flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-500"
              placeholder="Search skills, plugins, permissions..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className="nebula-note p-3 text-xs leading-5 text-slate-300">
            Marketplace installs are local capability packs. Nebula does not download or execute third-party code yet; online providers can plug into this catalog later.
          </div>

          <div className="space-y-3">
            {filteredMarketplace.map((item) => (
              <MarketplaceCard key={item.id} item={item} onInstall={() => install(item)} onUninstall={() => uninstall(item)} />
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="marketplace-search flex items-center gap-2 px-3 py-2">
            <Search size={14} className="text-cyan-200" />
            <input
              className="min-w-0 flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-500"
              placeholder="Search installed skills, permissions, tools..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {(['all', ...categories] as Array<'all' | SkillCategory>).map((item) => (
              <button
                key={item}
                className={`rounded-full border px-3 py-1 text-[11px] transition ${category === item ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-50' : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-100'}`}
                type="button"
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="grid gap-3">
            {filteredSkills.map((skill) => (
              <InstalledSkillCard key={skill.id} skill={skill} onToggle={toggle} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function lines(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function SkillBuilder({
  draft,
  draftsCount,
  onDraftChange,
  onSave,
}: {
  draft: {
    name: string
    description: string
    permissions: string
    exposedTools: string
    promptAdditions: string
    examples: string
    riskLevel: SkillDefinition['riskLevel']
  }
  draftsCount: number
  onDraftChange: (draft: any) => void
  onSave: () => void
}) {
  function patch(update: Partial<typeof draft>) {
    onDraftChange({ ...draft, ...update })
  }

  return (
    <section className="skill-card rounded-md border border-slate-800 bg-slate-950 p-3">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-100">Prompt Skill Builder</h3>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          Builds local prompt/skill packs only. Executable third-party code stays disabled in v1.
        </p>
        <div className="mt-1 text-[11px] text-slate-500">{draftsCount} local drafts saved</div>
      </div>
      <Field label="Name" value={draft.name} onChange={(name) => patch({ name })} />
      <Field label="Description" value={draft.description} onChange={(description) => patch({ description })} />
      <Area label="Permissions" value={draft.permissions} placeholder="files.read&#10;memory.write" onChange={(permissions) => patch({ permissions })} />
      <Area label="Exposed tool metadata" value={draft.exposedTools} placeholder="tool_name: what it would do" onChange={(exposedTools) => patch({ exposedTools })} />
      <Area label="Prompt additions" value={draft.promptAdditions} placeholder="When this skill is enabled, Nebula should..." onChange={(promptAdditions) => patch({ promptAdditions })} />
      <Area label="Examples" value={draft.examples} placeholder="Example requests this pack helps with" onChange={(examples) => patch({ examples })} />
      <label className="mb-3 block space-y-1">
        <span className="text-slate-400">Risk level</span>
        <select className="nebula-input w-full px-2 py-2 outline-none" value={draft.riskLevel} onChange={(event) => patch({ riskLevel: event.target.value as SkillDefinition['riskLevel'] })}>
          <option value="safe">safe</option>
          <option value="needs_approval">needs_approval</option>
          <option value="high_risk">high_risk</option>
          <option value="blocked">blocked</option>
        </select>
      </label>
      <button className="nebula-button-primary w-full px-3 py-2" type="button" onClick={onSave}>
        Save Local Skill
      </button>
    </section>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="mb-3 block space-y-1">
      <span className="text-slate-400">{label}</span>
      <input className="nebula-input w-full px-2 py-2 outline-none" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function Area({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return (
    <label className="mb-3 block space-y-1">
      <span className="text-slate-400">{label}</span>
      <textarea className="nebula-input min-h-20 w-full resize-none px-2 py-2 outline-none" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function InstalledSkillCard({ skill, onToggle }: { skill: SkillDefinition; onToggle: (skillId: string, enabled: boolean) => void }) {
  const stat = getSkillRuntimeStat(skill)
  const healthTone = skill.enabled
    ? stat.health === 'error'
      ? 'border-red-400/30 bg-red-400/10 text-red-200'
      : stat.health === 'warning'
        ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
        : stat.usageCount > 0
          ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
          : 'border-slate-600 bg-slate-800/60 text-slate-300'
    : 'border-slate-700 bg-slate-900 text-slate-500'

  return (
    <section className="skill-card rounded-md border border-slate-800 bg-slate-950 p-3 transition duration-200 hover:border-cyan-300/25 hover:bg-slate-950/80">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-cyan-300" />
            <h3 className="text-sm font-medium text-slate-100">{skill.name}</h3>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${healthTone}`}>
              {skill.enabled ? stat.health : 'disabled'}
            </span>
            {(skill.source === 'marketplace' || skill.source === 'builder') && (
              <span className="rounded-full border border-fuchsia-300/25 bg-fuchsia-300/10 px-2 py-0.5 text-[10px] uppercase text-fuchsia-100">
                {skill.source}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-400">{skill.description}</p>
          {(skill.author || skill.version) && (
            <div className="mt-1 text-[11px] text-slate-500">
              {skill.author ?? 'Unknown'} {skill.version ? `v${skill.version}` : ''} {skill.category ? `- ${skill.category}` : ''}
            </div>
          )}
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-slate-300">
          <span>{skill.enabled ? 'On' : 'Off'}</span>
          <input type="checkbox" checked={skill.enabled} onChange={(event) => onToggle(skill.id, event.target.checked)} />
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <Metric icon={<Activity size={11} />} label="Usage" value={`${stat.usageCount} runs`} />
        <Metric icon={<Gauge size={11} />} label="Errors" value={`${stat.errorCount}`} />
        <Metric icon={<Clock size={11} />} label="Avg runtime" value={stat.averageRuntimeMs ? `${stat.averageRuntimeMs} ms` : 'n/a'} />
        <Metric icon={<Zap size={11} />} label="Latency est." value={`${skill.estimatedLatencyMs ?? 0} ms`} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
        <div className="rounded-md border border-white/10 bg-black/20 p-2">
          <div className="text-[10px] uppercase text-slate-500">Model preference</div>
          <div className="mt-1 text-slate-200">{skill.modelPreference ?? 'auto'}</div>
        </div>
        <div className="rounded-md border border-white/10 bg-black/20 p-2">
          <div className="text-[10px] uppercase text-slate-500">Execution</div>
          <div className="mt-1 text-slate-200">
            {skill.canRunInParallel ? 'parallel' : 'serial'} / {skill.supportsBackgroundExecution ? 'background' : 'foreground'}
          </div>
        </div>
      </div>

      <SkillDetails skill={skill} />

      <div className="mt-3 rounded-md border border-white/10 bg-black/20 p-2 text-[11px] text-slate-400">
        <div className="mb-1 flex items-center gap-1 text-slate-300">
          <Layers size={11} />
          Dependencies
        </div>
        {skill.dependencies?.length ? skill.dependencies.join(', ') : 'No dependencies'}
        {stat.lastError && <div className="mt-2 text-red-200">Last error: {stat.lastError}</div>}
      </div>
    </section>
  )
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-2 text-slate-300">
      <div className="flex items-center gap-1 text-[10px] uppercase text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-slate-100">{value}</div>
    </div>
  )
}

function MarketplaceCard({
  item,
  onInstall,
  onUninstall,
}: {
  item: MarketplaceItem & { installed?: boolean }
  onInstall: () => void
  onUninstall: () => void
}) {
  const skill = item.installedSkill

  return (
    <section className="marketplace-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Package size={15} className={item.kind === 'plugin' ? 'text-fuchsia-200' : 'text-cyan-200'} />
            <h3 className="text-sm font-semibold text-slate-50">{item.name}</h3>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase text-slate-300">
              {item.kind}
            </span>
            {item.featured && (
              <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-0.5 text-[10px] uppercase text-cyan-100">
                featured
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-400">{item.description}</p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
            <span>{item.category}</span>
            <span>by {item.author}</span>
            <span>v{item.version}</span>
          </div>
        </div>

        {item.installed ? (
          <button className="marketplace-action marketplace-action-remove" type="button" onClick={onUninstall}>
            <Trash2 size={13} />
            Remove
          </button>
        ) : (
          <button className="marketplace-action" type="button" onClick={onInstall}>
            <Download size={13} />
            Install
          </button>
        )}
      </div>

      <SkillDetails skill={skill} compact />

      <div className="mt-3 flex flex-wrap gap-1.5">
        {item.tags.map((tag) => (
          <span key={tag} className="rounded-full border border-slate-700/80 bg-slate-900/70 px-2 py-1 text-[11px] text-slate-400">
            {tag}
          </span>
        ))}
        {item.installed && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-[11px] text-emerald-200">
            <CheckCircle2 size={11} />
            installed
          </span>
        )}
      </div>
    </section>
  )
}

function SkillDetails({ skill, compact = false }: { skill: SkillDefinition; compact?: boolean }) {
  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className={`rounded-md border px-2 py-1 text-[11px] ${riskTone[skill.riskLevel]}`}>
          {skill.riskLevel}
        </span>
        {skill.requiredPermissions.map((permission) => (
          <span key={permission} className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-400">
            <Shield size={11} />
            {permission}
          </span>
        ))}
      </div>

      <div className="mt-3">
        <div className="mb-1 text-[11px] uppercase text-slate-500">Exposed tools</div>
        <div className="flex flex-wrap gap-1.5">
          {skill.tools.length > 0 ? (
            skill.tools.map((tool) => (
              <span key={tool.name} className="terminal-font rounded-md bg-slate-800 px-2 py-1 text-[11px] text-cyan-100">
                {tool.name}
              </span>
            ))
          ) : (
            <span className="text-[11px] text-slate-500">Prompt-only pack</span>
          )}
        </div>
      </div>

      {!compact && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] uppercase text-slate-500">Examples</div>
          <ul className="space-y-1 text-xs leading-5 text-slate-400">
            {skill.examples.slice(0, 2).map((example) => (
              <li key={example}>{example}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
