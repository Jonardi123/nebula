import { AppWindow, ChevronRight, Palette, ShieldCheck, TerminalSquare, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NEBULA_RELEASE } from '../../release'
import type { VisualTheme } from '../types/settings'

const SEEN_KEY = `nebula-whats-new-${NEBULA_RELEASE.version}`

export function BlackMatterWhatsNew({ onThemeChange }: { onThemeChange: (theme: VisualTheme) => void }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try { setOpen(localStorage.getItem(SEEN_KEY) !== 'seen') } catch { setOpen(true) }
  }, [])

  function dismiss() {
    try { localStorage.setItem(SEEN_KEY, 'seen') } catch { /* one-time state is optional */ }
    setOpen(false)
  }

  if (!open) return null
  return (
    <div className="black-matter-whats-new-backdrop" role="presentation" onPointerDown={(event) => { if (event.currentTarget === event.target) dismiss() }}>
      <section className="black-matter-whats-new" role="dialog" aria-modal="true" aria-labelledby="black-matter-whats-new-title">
        <button className="black-matter-whats-new-close" type="button" aria-label="Close" onClick={dismiss}><X size={17} /></button>
        <div className="black-matter-whats-new-mark" aria-hidden="true"><i /></div>
        <span>Nebula 2.0</span>
        <h2 id="black-matter-whats-new-title">Black Matter is online.</h2>
        <p>A quieter workspace with dependable local command and app control. Your chats, projects, memory, models, pairing, and custom avatar are unchanged.</p>
        <div className="black-matter-whats-new-list">
          <div><ShieldCheck size={17} /><span><strong>Truthful execution modes</strong><small>Approval, Safe, or session-only Full Access.</small></span></div>
          <div><TerminalSquare size={17} /><span><strong>Live Terminal dock</strong><small>Streaming output, Stop, receipts, and health.</small></span></div>
          <div><AppWindow size={17} /><span><strong>Natural app launching</strong><small>Start Menu discovery, aliases, and ambiguity checks.</small></span></div>
          <div><Palette size={17} /><span><strong>Live themes</strong><small>Black Matter is default; Original remains one click away.</small></span></div>
        </div>
        <div className="black-matter-whats-new-actions">
          <button type="button" onClick={() => { onThemeChange('original'); dismiss() }}>Use Nebula Original</button>
          <button type="button" onClick={dismiss}>Enter Black Matter <ChevronRight size={16} /></button>
        </div>
        <small>Full Access never runs as administrator and always resets to Safe after restart.</small>
      </section>
    </div>
  )
}
