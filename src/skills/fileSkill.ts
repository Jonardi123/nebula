import type { SkillDefinition } from './types'

export const fileSkill: SkillDefinition = {
  id: 'files',
  name: 'Files',
  description: 'Lists and reads project files, with edit tools gated through approvals.',
  enabled: true,
  requiredPermissions: ['read:project-files', 'write:project-files'],
  riskLevel: 'needs_approval',
  category: 'files',
  version: '0.2.0',
  keywords: ['file', 'files', 'folder', 'project', 'read', 'write', 'edit', 'diff', 'package.json', 'README'],
  requiredTools: ['list_files', 'read_file', 'write_file', 'create_file', 'append_file'],
  modelPreference: 'code',
  canRunInParallel: true,
  supportsVoice: false,
  supportsBackgroundExecution: true,
  estimatedLatencyMs: 900,
  estimatedCost: 'free',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' }, intent: { type: 'string' } },
    additionalProperties: true,
  },
  outputSchema: {
    type: 'object',
    properties: { files: { type: 'array' }, content: { type: 'string' } },
    additionalProperties: true,
  },
  tools: [
    {
      name: 'list_files',
      description: 'List files in a project directory.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Folder path. Defaults to selected project folder.' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'read_file',
      description: 'Read a UTF-8 text file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path.' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    {
      name: 'write_file',
      description: 'Overwrite an existing file after approval.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
    {
      name: 'create_file',
      description: 'Create a new file after approval.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
    {
      name: 'append_file',
      description: 'Append text to a file after approval.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  ],
  systemPromptAdditions: ['Prefer reading files before proposing edits. Use write tools only after the intended change is clear.'],
  examples: ['Read package.json before changing scripts.', 'Create a README section after approval.'],
}
