import type { SkillDefinition } from './types'

export const memorySkill: SkillDefinition = {
  id: 'memory',
  name: 'Memory',
  description: 'Searches and writes local Markdown memory for durable preferences, project facts, and lessons.',
  enabled: true,
  requiredPermissions: ['read:memory', 'write:memory'],
  riskLevel: 'needs_approval',
  category: 'memory',
  version: '0.2.0',
  keywords: ['memory', 'remember', 'preference', 'lesson', 'project fact', 'recall', 'save'],
  requiredTools: ['search_memory', 'write_memory'],
  modelPreference: 'auto',
  canRunInParallel: true,
  supportsVoice: true,
  supportsBackgroundExecution: true,
  estimatedLatencyMs: 700,
  estimatedCost: 'free',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' }, memoryFile: { type: 'string' } },
    additionalProperties: true,
  },
  outputSchema: {
    type: 'object',
    properties: { matches: { type: 'array' }, saved: { type: 'boolean' } },
    additionalProperties: true,
  },
  tools: [
    {
      name: 'search_memory',
      description: 'Search local Nebula memory files for relevant saved information.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'write_memory',
      description: 'Append a useful durable lesson or preference to a memory file.',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Memory file name.' },
          content: { type: 'string', description: 'Markdown content to append.' },
        },
        required: ['file', 'content'],
        additionalProperties: false,
      },
    },
  ],
  systemPromptAdditions: [
    'Use memory when it can reduce repeated questions or preserve durable lessons. Save only useful, reusable information.',
  ],
  examples: ['Remember that this project uses LM Studio, not Ollama.', 'Search memory for previous Windows npm fixes.'],
}
