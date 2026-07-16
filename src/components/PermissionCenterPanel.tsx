import { Lock, Shield, ShieldCheck, ShieldOff } from 'lucide-react'
import { getPermissionCapabilities, setPermissionCapability } from '../lib/permissionCenter'
import type { AppSettings } from '../types/settings'

export function PermissionCenterPanel({
  settings,
  onChange,
}: {
  settings: AppSettings
  onChange: (settings: AppSettings) => void
}) {
  const capabilities = getPermissionCapabilities(settings)
  const grouped = Object.entries(
    capabilities.reduce<Record<string, typeof capabilities>>((groups, capability) => {
      groups[capability.category] = [...(groups[capability.category] ?? []), capability]
      return groups
    }, {}),
  )

  return (
    <div className="permission-center-panel space-y-3 p-3 text-xs">
      <section className="permission-center-hero">
        <ShieldCheck size={18} />
        <div>
          <h2>Permission Center</h2>
          <p>Control which local Nebula capabilities are active. Hard safety blocks stay enforced under every mode.</p>
        </div>
      </section>

      {grouped.map(([category, items]) => (
        <section key={category} className="permission-group">
          <h3>{category}</h3>
          <div className="space-y-2">
            {items.map((capability) => (
              <article key={capability.id} className={`permission-card ${capability.enabled ? 'permission-card-on' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className="permission-icon">
                    {capability.locked ? <Lock size={15} /> : capability.enabled ? <ShieldCheck size={15} /> : <ShieldOff size={15} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <strong>{capability.label}</strong>
                      <span className={`permission-risk permission-risk-${capability.riskLevel}`}>{capability.riskLevel}</span>
                    </div>
                    <p>{capability.description}</p>
                    <div className="permission-used-by">
                      {capability.usedBy.map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                    {capability.lockedReason && <small>{capability.lockedReason}</small>}
                  </div>
                  <label className="permission-switch">
                    <input
                      type="checkbox"
                      checked={capability.enabled}
                      disabled={capability.locked}
                      onChange={(event) => onChange(setPermissionCapability(settings, capability.id, event.target.checked))}
                    />
                    <span />
                  </label>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      <section className="permission-center-note">
        <Shield size={14} />
        <span>Formatting drives, deleting system folders, disabling security tools, credential access, and hidden execution remain blocked.</span>
      </section>
    </div>
  )
}
