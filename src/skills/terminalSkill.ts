import type { SkillDefinition } from './types'

export const terminalSkill: SkillDefinition = {
  id: 'terminal',
  name: 'Terminal',
  description: 'Runs project-local shell commands with safety checks and approval gates.',
  enabled: true,
  requiredPermissions: ['run:project-command'],
  riskLevel: 'high_risk',
  category: 'terminal',
  version: '0.2.0',
  keywords: ['terminal', 'command', 'powershell', 'cmd', 'npm', 'build', 'test', 'git', 'system info', 'time'],
  requiredTools: ['run_command', 'get_system_info', 'get_current_time', 'stop_agent'],
  modelPreference: 'code',
  canRunInParallel: false,
  supportsVoice: false,
  supportsBackgroundExecution: true,
  estimatedLatencyMs: 4500,
  estimatedCost: 'free',
  inputSchema: {
    type: 'object',
    properties: { command: { type: 'string' }, cwd: { type: 'string' } },
    additionalProperties: true,
  },
  outputSchema: {
    type: 'object',
    properties: { code: { type: 'number' }, stdout: { type: 'string' }, stderr: { type: 'string' } },
    additionalProperties: true,
  },
  tools: [
    {
      name: 'run_command',
      description: 'Run a command in the selected project folder by default.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to run. Never assume admin privileges.' },
          cwd: { type: 'string', description: 'Optional working directory.' },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_system_info',
      description: 'Read basic local system information.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'get_current_time',
      description: 'Return the current local time.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'stop_agent',
      description: 'Stop the current agent loop and running command if possible.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  ],
  systemPromptAdditions: ['Commands that modify the machine require approval. Never run hidden, admin, or destructive commands.'],
  examples: ['Run npm test after asking approval if needed.', 'Use git status to inspect current repo state.'],
}
