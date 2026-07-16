import { HardDrive, LockKeyhole, ShieldCheck, Wifi } from 'lucide-react'
import { getPermissionCapabilities } from '../lib/permissionCenter'
import { getEnabledSkills } from '../skills'
import type { AppSettings } from '../types/settings'

export function PrivacyPanel({ settings }: { settings: AppSettings }) {
  const permissions = getPermissionCapabilities(settings)
  const enabledSkills = getEnabledSkills()
  const remoteProvider = settings.modelProvider === '9router' || settings.modelProvider === 'openrouter'
  const providerLabel = settings.modelProvider === 'openrouter' ? 'OpenRouter' : settings.modelProvider === '9router' ? '9Router' : 'LM Studio local server'

  return (
    <div className="space-y-3 p-3 text-xs">
      <section className="rounded-md border border-emerald-300/20 bg-emerald-300/[0.07] p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-50"><ShieldCheck size={15} /> Privacy Dashboard</div>
        <p className="mt-1 leading-5 text-slate-400">A plain-language view of where Nebula can read, write, or send data. This page does not make network calls.</p>
      </section>

      <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
        <div className="flex items-center gap-2 font-semibold text-slate-100"><Wifi size={14} /> Model provider</div>
        <div className="mt-2 rounded-md border border-white/10 bg-black/20 p-2">
          <div className="font-semibold text-slate-200">{providerLabel}</div>
          <p className="mt-1 leading-4 text-slate-400">
            {remoteProvider
              ? 'Messages sent while this provider is selected leave this PC. Review its provider settings before using it with private project data.'
              : `Chat requests stay on your machine and go to ${settings.endpoint}.`}
          </p>
        </div>
      </section>

      <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
        <div className="flex items-center gap-2 font-semibold text-slate-100"><HardDrive size={14} /> Local data locations</div>
        <div className="mt-2 space-y-2">
          <DataRow label="Project workspace" value={settings.projectFolder || 'No project selected'} />
          <DataRow label="Memory folder" value={settings.memoryFolder || 'Not configured'} />
          <DataRow label="Conversation recovery" value="Browser storage in the Nebula app profile" />
          <DataRow label="Training traces" value="Local browser storage until explicitly exported" />
        </div>
      </section>

      <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
        <div className="flex items-center gap-2 font-semibold text-slate-100"><LockKeyhole size={14} /> Enabled access</div>
        <div className="mt-2 space-y-2">
          {permissions.map((permission) => (
            <div key={permission.id} className="flex items-start justify-between gap-3 rounded-md border border-white/10 bg-black/20 p-2">
              <div className="min-w-0"><div className="font-semibold text-slate-200">{permission.label}</div><p className="mt-1 leading-4 text-slate-500">{permission.description}</p></div>
              <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] uppercase ${permission.enabled ? 'border-emerald-300/25 text-emerald-200' : 'border-white/10 text-slate-500'}`}>{permission.enabled ? 'On' : 'Off'}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-white/10 bg-white/[0.035] p-3">
        <div className="font-semibold text-slate-100">Enabled skills ({enabledSkills.length})</div>
        <p className="mt-1 leading-4 text-slate-500">{enabledSkills.map((skill) => skill.name).join(', ') || 'No skills enabled.'}</p>
      </section>
    </div>
  )
}

function DataRow({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-white/10 bg-black/20 p-2"><div className="text-[10px] uppercase tracking-[0.08em] text-slate-500">{label}</div><div className="mt-1 break-all text-[11px] text-slate-300">{value}</div></div>
}
