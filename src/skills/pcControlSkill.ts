import type { SkillDefinition } from './types'

export const pcControlSkill: SkillDefinition = {
  id: 'pc-control',
  name: 'PC Control',
  description: 'Opens known safe apps and sends a dedicated Windows sleep action after approval.',
  enabled: true,
  requiredPermissions: ['control:known-apps', 'control:sleep'],
  riskLevel: 'high_risk',
  category: 'automation',
  version: '0.2.0',
  keywords: ['pc', 'windows', 'open app', 'notepad', 'calculator', 'sleep', 'desktop'],
  requiredTools: ['open_app', 'sleep_pc'],
  modelPreference: 'auto',
  canRunInParallel: false,
  supportsVoice: true,
  supportsBackgroundExecution: false,
  estimatedLatencyMs: 1200,
  estimatedCost: 'free',
  inputSchema: {
    type: 'object',
    properties: { app: { type: 'string' }, action: { type: 'string' } },
    additionalProperties: true,
  },
  outputSchema: {
    type: 'object',
    properties: { status: { type: 'string' } },
    additionalProperties: true,
  },
  tools: [
    {
      name: 'open_app',
      description: 'Open a known safe local app, or require approval for unknown paths.',
      parameters: {
        type: 'object',
        properties: {
          app: { type: 'string', description: 'Known app name: notepad, calculator, cmd, powershell, explorer.' },
        },
        required: ['app'],
        additionalProperties: false,
      },
    },
    {
      name: 'sleep_pc',
      description: "Put the PC to sleep using Nebula's dedicated safe Windows sleep function.",
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  ],
  systemPromptAdditions: ['Never invent PC control commands. Request sleep_pc or open_app and wait for tool confirmation.'],
  examples: ['Open notepad after approval.', 'Ask before putting the PC to sleep.'],
}
