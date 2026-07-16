import type { SkillDefinition } from './types'

export const webSearchSkill: SkillDefinition = {
  id: 'web-search',
  name: 'Web Search',
  description: 'Searches the web through a provider interface. Uses manual/mock results until an API provider is configured.',
  enabled: true,
  requiredPermissions: ['network:web-search'],
  riskLevel: 'needs_approval',
  category: 'search',
  version: '0.2.0',
  keywords: ['web', 'search', 'current', 'latest', 'internet', 'online', 'docs', 'source'],
  requiredTools: ['web_search'],
  modelPreference: 'auto',
  canRunInParallel: true,
  supportsVoice: true,
  supportsBackgroundExecution: true,
  estimatedLatencyMs: 3000,
  estimatedCost: 'free',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' }, maxResults: { type: 'number' } },
    required: ['query'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: { results: { type: 'array' } },
    additionalProperties: true,
  },
  tools: [
    {
      name: 'web_search',
      description: 'Search the web and return title, url, snippet, and date when available.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' },
          maxResults: { type: 'number', description: 'Maximum results to return.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  ],
  systemPromptAdditions: [
    'Use web_search only when current or external information is needed. Mention source URLs and date checked for verified findings.',
  ],
  examples: ['Search current LM Studio API docs.', 'Find latest package setup instructions when local knowledge is stale.'],
}
