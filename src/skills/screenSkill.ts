import type { SkillDefinition } from './types'

export const screenSkill: SkillDefinition = {
  id: 'screen-awareness',
  name: 'Screen Awareness',
  description: 'Captures the current primary screen so Nebula can reference what is visible.',
  enabled: true,
  requiredPermissions: ['screen:capture-primary'],
  riskLevel: 'needs_approval',
  category: 'screen',
  version: '0.2.0',
  keywords: ['screen', 'screenshot', 'vision', 'look', 'visible', 'display', 'desktop'],
  requiredTools: ['capture_screen'],
  modelPreference: 'auto',
  canRunInParallel: false,
  supportsVoice: true,
  supportsBackgroundExecution: false,
  estimatedLatencyMs: 1200,
  estimatedCost: 'free',
  inputSchema: {
    type: 'object',
    properties: { reason: { type: 'string' } },
    additionalProperties: true,
  },
  outputSchema: {
    type: 'object',
    properties: { path: { type: 'string' }, width: { type: 'number' }, height: { type: 'number' } },
    additionalProperties: true,
  },
  tools: [
    {
      name: 'capture_screen',
      description: 'Capture the primary display and return the saved screenshot path and dimensions.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  ],
  systemPromptAdditions: [
    'Use capture_screen when the user asks what is on screen or when screen context would materially help.',
    'A screenshot path is not visual understanding by itself. If no vision model is available, say that visual interpretation needs a vision route.',
  ],
  examples: ['Capture the screen before helping with a visible error.', 'Use screen context when the user says look at this.'],
}
