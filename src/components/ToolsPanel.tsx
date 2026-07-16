import { SUPPORTED_TOOLS } from '../lib/tools'

const dangerous = ['sleep_pc', 'write_file', 'create_file', 'append_file', 'run_command', 'open_app']
const patchQueued = ['write_file', 'create_file', 'append_file']

export function ToolsPanel() {
  return (
    <div className="space-y-2 p-3">
      {SUPPORTED_TOOLS.map((tool) => (
        <div key={tool} className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs">
          <span className="terminal-font text-slate-200">{tool}</span>
          <span className={patchQueued.includes(tool) ? 'text-cyan-300' : dangerous.includes(tool) ? 'text-amber-300' : 'text-emerald-300'}>
            {patchQueued.includes(tool) ? 'patch queue' : dangerous.includes(tool) ? 'approval' : 'safe'}
          </span>
        </div>
      ))}
      <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs leading-5 text-red-100">
        Blocked: drive formatting, system-folder deletion, antivirus disabling, password changes, hidden commands,
        credential stealing, random download-and-execute flows, and large deletes without explicit confirmation.
      </div>
    </div>
  )
}
