import { Check, Clipboard, ExternalLink, Link2, LoaderCircle, RefreshCw, ShieldCheck, Smartphone, Trash2, Wifi, WifiOff } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import QRCode from 'qrcode'
import { useCallback, useEffect, useState } from 'react'
import type { MobileBridgeSnapshot, PairingCodeResult } from '../lib/mobileBridge'

export function MobileConnectionPanel() {
  const [snapshot, setSnapshot] = useState<MobileBridgeSnapshot | null>(null)
  const [pairing, setPairing] = useState<PairingCodeResult | null>(null)
  const [qr, setQr] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const [, setClock] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const next = await invoke<MobileBridgeSnapshot>('mobile_bridge_status')
      setSnapshot(next)
      setError('')
      return next
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return null
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 10_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const url = pairing?.installUrl ?? snapshot?.installUrl
    if (!url) { setQr(''); return }
    void QRCode.toDataURL(url, { width: 248, margin: 1, color: { dark: '#111827', light: '#f8fafc' }, errorCorrectionLevel: 'M' })
      .then(setQr).catch(() => setQr(''))
  }, [pairing?.installUrl, snapshot?.installUrl])

  async function toggleServe() {
    if (!snapshot) return
    setBusy('serve')
    setError('')
    try {
      const next = await invoke<MobileBridgeSnapshot>(snapshot.serveEnabled ? 'mobile_bridge_disable_tailscale' : 'mobile_bridge_enable_tailscale')
      setSnapshot(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy('')
    }
  }

  async function createCode() {
    setBusy('pair')
    setError('')
    try {
      const next = await invoke<PairingCodeResult>('mobile_bridge_create_pairing_code')
      setPairing(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy('')
    }
  }

  async function revoke(id: string) {
    setBusy(id)
    try {
      await invoke('mobile_bridge_revoke_client', { id })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy('')
    }
  }

  async function copy(value: string, kind: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      window.setTimeout(() => setCopied(''), 1_600)
    } catch {
      setError('Clipboard access was unavailable. Select and copy the value manually.')
    }
  }

  const url = pairing?.installUrl ?? snapshot?.installUrl ?? ''
  const remaining = pairing ? Math.max(0, Math.ceil((pairing.expiresAtMs - Date.now()) / 1000)) : 0

  return (
    <div className="sidebar-panel-content p-3 text-xs text-slate-300">
      <section className="rounded-lg border border-cyan-400/15 bg-cyan-400/[0.035] p-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><Smartphone size={19} /></div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-100">Nebula on iPhone</h3>
            <p className="mt-1 leading-4 text-slate-500">Private mobile chat through this PC. The model, memory, and tools stay here.</p>
          </div>
          <button type="button" className="grid h-8 w-8 place-items-center rounded-md border border-white/10 text-slate-500 hover:text-slate-200" onClick={() => void refresh()} aria-label="Refresh mobile status"><RefreshCw size={14} /></button>
        </div>
      </section>

      {!snapshot ? <div className="mt-3 flex items-center gap-2 rounded-md border border-white/8 p-3 text-slate-500"><LoaderCircle className="animate-spin" size={14} /> Checking the private bridge...</div> : <>
        <section className="mt-3 space-y-2 rounded-lg border border-white/8 bg-black/15 p-3">
          <StatusRow label="Local bridge" ok={snapshot.listening} detail={snapshot.listening ? `Listening only on 127.0.0.1:${snapshot.port}` : snapshot.lastError || 'Unavailable'} />
          <StatusRow label="Tailscale" ok={snapshot.tailscaleOnline} detail={snapshot.tailscaleOnline ? 'Private network online' : 'Open Tailscale and reconnect'} />
          <StatusRow label="Phone link" ok={snapshot.serveEnabled} detail={snapshot.serveEnabled ? 'Private HTTPS link enabled' : 'Not shared with your tailnet'} />
          <button type="button" className="mt-1 flex h-9 w-full items-center justify-center gap-2 rounded-md border border-cyan-300/20 bg-cyan-300/8 text-cyan-100 hover:bg-cyan-300/12 disabled:opacity-40" onClick={() => void toggleServe()} disabled={busy === 'serve' || !snapshot.listening || !snapshot.tailscaleOnline}>
            {busy === 'serve' ? <LoaderCircle className="animate-spin" size={14} /> : snapshot.serveEnabled ? <WifiOff size={14} /> : <Wifi size={14} />}
            {snapshot.serveEnabled ? 'Disable private link' : 'Enable private link'}
          </button>
        </section>

        {snapshot.serveEnabled && url && <section className="mt-3 rounded-lg border border-white/8 bg-white/[0.025] p-3">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.12em] text-slate-500"><Link2 size={13} /> Install link</div>
          <div className="mt-2 break-all rounded-md bg-black/25 px-2 py-2 font-mono text-[10px] leading-4 text-slate-300">{url}</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" className="flex h-8 items-center justify-center gap-2 rounded-md border border-white/10 hover:bg-white/5" onClick={() => void copy(url, 'url')}>{copied === 'url' ? <Check size={13} /> : <Clipboard size={13} />} {copied === 'url' ? 'Copied' : 'Copy link'}</button>
            <button type="button" className="flex h-8 items-center justify-center gap-2 rounded-md border border-white/10 hover:bg-white/5" onClick={() => window.open(url, '_blank')}><ExternalLink size={13} /> Open</button>
          </div>
          {qr && <div className="mx-auto mt-3 w-fit rounded-lg bg-white p-2"><img className="h-36 w-36" src={qr} alt="QR code for the private Nebula mobile link" /></div>}
          <p className="mt-2 text-center text-[10px] leading-4 text-slate-500">Open on your iPhone in Safari, then Share and Add to Home Screen.</p>
        </section>}

        <section className="mt-3 rounded-lg border border-white/8 bg-white/[0.025] p-3">
          <div className="flex items-center justify-between gap-2">
            <div><div className="text-[10px] font-semibold uppercase tracking-[.12em] text-slate-500">Pair this phone</div><p className="mt-1 text-[10px] leading-4 text-slate-600">Codes work once and expire after ten minutes.</p></div>
            <button type="button" className="h-8 rounded-md border border-violet-300/20 bg-violet-300/8 px-3 text-violet-100 disabled:opacity-40" onClick={() => void createCode()} disabled={!snapshot.serveEnabled || busy === 'pair'}>{pairing && remaining > 0 ? 'New code' : 'Generate code'}</button>
          </div>
          {pairing && remaining > 0 && <div className="mt-3 rounded-lg border border-violet-300/15 bg-black/25 p-3 text-center">
            <button type="button" className="font-mono text-2xl font-semibold tracking-[.25em] text-white" onClick={() => void copy(pairing.code, 'code')} title="Copy pairing code">{pairing.code}</button>
            <p className="mt-1 text-[10px] text-slate-500">{copied === 'code' ? 'Copied' : `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`}</p>
          </div>}
        </section>

        <section className="mt-3 rounded-lg border border-white/8 bg-white/[0.025] p-3">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.12em] text-slate-500"><ShieldCheck size={13} /> Paired devices</div>
          <div className="mt-2 space-y-2">{snapshot.pairedClients.filter((client) => !client.revokedAt).length === 0 ? <p className="rounded-md border border-dashed border-white/8 p-3 text-center text-[10px] text-slate-600">No phones paired yet.</p> : snapshot.pairedClients.filter((client) => !client.revokedAt).map((client) => <div key={client.id} className="flex items-center gap-2 rounded-md border border-white/7 bg-black/15 p-2">
            <Smartphone size={14} className="text-slate-500" /><div className="min-w-0 flex-1"><strong className="block truncate text-[11px] text-slate-200">{client.name}</strong><span className="text-[9px] text-slate-600">Last used {new Date(Number(client.lastSeenAt)).toLocaleString()}</span></div><button type="button" className="grid h-7 w-7 place-items-center rounded-md text-red-300/60 hover:bg-red-400/10 hover:text-red-200" onClick={() => void revoke(client.id)} disabled={busy === client.id} aria-label={`Revoke ${client.name}`}><Trash2 size={13} /></button>
          </div>)}</div>
        </section>
      </>}

      {error && <div className="mt-3 rounded-md border border-red-400/20 bg-red-400/8 p-2.5 leading-4 text-red-200">{error}</div>}
      <p className="mt-3 px-1 text-[10px] leading-4 text-slate-600">Nebula binds the bridge to localhost. Tailscale provides private HTTPS transport; public Funnel is never enabled.</p>
    </div>
  )
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return <div className="flex items-center gap-2"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ok ? 'bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,.65)]' : 'bg-amber-300'}`} /><div className="min-w-0 flex-1"><strong className="block text-[11px] font-medium text-slate-300">{label}</strong><span className="block truncate text-[9px] text-slate-600">{detail}</span></div></div>
}
