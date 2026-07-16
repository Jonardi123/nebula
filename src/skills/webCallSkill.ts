import type { SkillDefinition } from './types'

export const webCallSkill: SkillDefinition = {
  id: 'web-call',
  name: 'Web Call',
  description: 'Fetches webpage text safely, blocks local/private URLs, strips HTML, and limits content size.',
  enabled: true,
  requiredPermissions: ['network:web-fetch'],
  riskLevel: 'needs_approval',
  category: 'browser',
  version: '0.2.0',
  keywords: ['webpage', 'fetch', 'url', 'source', 'docs', 'article', 'browser'],
  requiredTools: ['web_fetch'],
  modelPreference: 'auto',
  canRunInParallel: true,
  supportsVoice: false,
  supportsBackgroundExecution: true,
  estimatedLatencyMs: 3500,
  estimatedCost: 'free',
  inputSchema: {
    type: 'object',
    properties: { url: { type: 'string' } },
    required: ['url'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: { title: { type: 'string' }, summary: { type: 'string' }, url: { type: 'string' } },
    additionalProperties: true,
  },
  tools: [
    {
      name: 'web_fetch',
      description: 'Fetch text from a public webpage. Never download or execute files.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Public http(s) URL to fetch.' },
        },
        required: ['url'],
        additionalProperties: false,
      },
    },
  ],
  systemPromptAdditions: [
    'Use web_fetch only for public webpages. Do not fetch local network, private IP, file, executable, archive, or installer URLs.',
  ],
  examples: ['Fetch a public documentation page and summarize the relevant parts.'],
}
