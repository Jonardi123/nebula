import { Bot, BrainCircuit, CheckCircle2, Cloud, Globe2, Lock, Shield, Terminal, Wrench } from 'lucide-react'
import { getInstalledSkills, setSkillEnabled } from '../skills'

type AgentState = 'active' | 'ready' | 'off' | 'connector'

interface AgentCard {
  name: string
  description: string
  state: AgentState
  icon: React.ReactNode
  tools: string[]
  note?: string
  action?: {
    label: string
    onClick: () => void
  }
}

interface Props {
  skillsVersion: number
  onSkillsChange: () => void
}

const stateTone: Record<AgentState, string> = {
  active: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  ready: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100',
  off: 'border-slate-600/50 bg-slate-800/40 text-slate-400',
  connector: 'border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-100',
}

export function AgentsPanel({ skillsVersion, onSkillsChange }: Props) {
  const skills = getInstalledSkills()
  const webSearch = skills.find((skill) => skill.id === 'web-search')
  const webCall = skills.find((skill) => skill.id === 'web-call')
  const webEnabled = Boolean(webSearch?.enabled || webCall?.enabled)
  void skillsVersion

  function activateWebAgent() {
    setSkillEnabled('web-search', true)
    setSkillEnabled('web-call', true)
    onSkillsChange()
  }

  const agents: AgentCard[] = [
    {
      name: 'Main Agent',
      description: 'Understands requests, plans work, routes models, coordinates tools, and decides when specialist agents should help.',
      state: 'active',
      icon: <Bot size={15} />,
      tools: ['model_router', 'agent_loop'],
    },
    {
      name: 'Code Agent',
      description: 'Reads project files, suggests focused edits, creates diffs, and uses the code model for implementation work.',
      state: 'ready',
      icon: <Wrench size={15} />,
      tools: ['list_files', 'read_file', 'write_file', 'run_command'],
    },
    {
      name: 'Terminal Agent',
      description: 'Runs project commands, captures stdout/stderr, reports errors, and can stop a running command.',
      state: 'ready',
      icon: <Terminal size={15} />,
      tools: ['run_command', 'stop_agent', 'get_system_info'],
    },
    {
      name: 'Memory Agent',
      description: 'Searches local memory before web research and stores durable lessons, fixes, preferences, and verified findings.',
      state: 'ready',
      icon: <BrainCircuit size={15} />,
      tools: ['search_memory', 'write_memory'],
    },
    {
      name: 'Web Agent',
      description: webEnabled
        ? 'Current-info research is enabled through web search and safe public webpage fetching.'
        : 'Current-info research is installed but disabled. Enable it when you want Nebula to inspect public docs/pages.',
      state: webEnabled ? 'ready' : 'off',
      icon: <Globe2 size={15} />,
      tools: [webSearch?.enabled ? 'web_search' : '', webCall?.enabled ? 'web_fetch' : ''].filter(Boolean),
      note: webEnabled
        ? 'Search uses a provider interface with mock/manual fallback until a search API key is configured.'
        : 'This agent blocks private/local URLs and downloadable files by default.',
      action: webEnabled ? undefined : { label: 'Enable Web Agent', onClick: activateWebAgent },
    },
    {
      name: 'ChatGPT Agent',
      description: 'Cloud escalation connector shell for tasks where local models fail repeatedly or need stronger reasoning.',
      state: 'connector',
      icon: <Cloud size={15} />,
      tools: [],
      note: 'Interface is planned; API calls stay disabled until a key/provider flow is added.',
    },
    {
      name: 'Gemini Agent',
      description: 'Huge-context escalation connector shell for massive codebases, long documents, or large multimodal tasks.',
      state: 'connector',
      icon: <Cloud size={15} />,
      tools: [],
      note: 'Interface is planned; API calls stay disabled until a key/provider flow is added.',
    },
    {
      name: 'Safety Agent',
      description: 'Classifies commands/tools, blocks destructive actions, and keeps private/local web targets out of web_fetch.',
      state: 'active',
      icon: <Shield size={15} />,
      tools: ['commandSafety', 'urlSafety'],
    },
  ]

  return (
    <div className="space-y-3 p-3">
      <div className="nebula-note p-3 text-xs leading-5 text-slate-300">
        Agents are local capability routes. Active agents already run inside Nebula; connector agents are wired as escalation slots but do not call cloud APIs yet.
      </div>

      {agents.map((agent) => (
        <section key={agent.name} className="agent-card rounded-md border border-slate-800 bg-slate-950 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-cyan-200">{agent.icon}</span>
                <h3 className="text-sm font-medium text-slate-100">{agent.name}</h3>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-400">{agent.description}</p>
            </div>
            <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] ${stateTone[agent.state]}`}>
              {agent.state}
            </span>
          </div>

          {agent.tools.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {agent.tools.map((tool) => (
                <span key={tool} className="terminal-font rounded-md bg-slate-800 px-2 py-1 text-[11px] text-cyan-100">
                  {tool}
                </span>
              ))}
            </div>
          )}

          {agent.note && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-white/10 bg-white/[0.03] p-2 text-[11px] leading-4 text-slate-400">
              {agent.state === 'connector' ? <Lock size={12} className="mt-0.5 shrink-0 text-fuchsia-200" /> : <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-cyan-200" />}
              <span>{agent.note}</span>
            </div>
          )}

          {agent.action && (
            <button className="nebula-button-primary mt-3 w-full px-3 py-2 text-xs font-medium" type="button" onClick={agent.action.onClick}>
              {agent.action.label}
            </button>
          )}
        </section>
      ))}
    </div>
  )
}
