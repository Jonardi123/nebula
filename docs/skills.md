# Nebula Skill System

Nebula skills are local capability packs registered with the central Skill Registry. A skill can be a real executable tool pack, a prompt-only behavior pack, or a future connector placeholder.

## Skill Module Layout

Create a file in `src/skills/`:

```ts
import type { SkillDefinition } from './types'

export const mySkill: SkillDefinition = {
  id: 'my-skill',
  name: 'My Skill',
  description: 'What this capability does.',
  enabled: true,
  version: '0.1.0',
  category: 'integration',
  keywords: ['example', 'capability'],
  requiredPermissions: ['internet.use'],
  requiredTools: ['my_future_tool'],
  modelPreference: 'auto',
  canRunInParallel: true,
  supportsVoice: false,
  supportsBackgroundExecution: true,
  estimatedLatencyMs: 1500,
  estimatedCost: 'free',
  riskLevel: 'needs_approval',
  inputSchema: {
    type: 'object',
    properties: { request: { type: 'string' } },
    required: ['request'],
    additionalProperties: true,
  },
  outputSchema: {
    type: 'object',
    properties: { result: { type: 'string' } },
    additionalProperties: true,
  },
  tools: [],
  systemPromptAdditions: ['Use this skill when the user asks for its domain.'],
  examples: ['Example user request.'],
}
```

Register it in `src/skills/index.ts` by adding it to `INSTALLED_SKILLS`. Future external plugin loading is designed around the same manifest shape.

## Registry

`src/skills/registry.ts` normalizes every skill and fills safe defaults for optional metadata:

- category
- keywords
- model preference
- parallel/background capability flags
- latency estimate
- schemas
- dependencies
- lazy loading metadata

The registry also filters tools. A skill can declare future tools as metadata, but Nebula only exposes executable tools present in `SUPPORTED_TOOLS`. This prevents a prompt-only future skill from making the model call a tool Nebula cannot actually run.

## Routing

The model orchestrator calls `selectSkillsForRequest()` before every request. Skills are scored using keywords and category heuristics. Multiple compatible skills can be selected.

The selected skills are injected into the agent prompt as internal context. The user still interacts only with Nebula.

If no skill has enough confidence, Nebula keeps general reasoning available and should ask a clarification question when the request is ambiguous.

## Permissions

Each skill declares permissions such as:

- `files.read`
- `files.write`
- `terminal.run`
- `apps.launch`
- `browser.use`
- `internet.use`
- `clipboard.read`
- `clipboard.write`
- `camera.use`
- `microphone.use`
- `screen.capture`
- `system.read`
- `system.settings`
- `memory.read`
- `memory.write`
- `email.send`

Permission declarations are shown in the Skills UI and used for planning/safety. Actual execution is still protected by Nebula's tool safety layer.

## Runtime Stats

Every skill execution records:

- usage count
- error count
- average runtime
- last runtime
- last error
- health state
- approximate UI heap usage

The Skills page and Diagnostics page use these stats for developer visibility.

## Skill Pipelines

Nebula does not hardcode fixed pipelines. The orchestrator selects skills, exposes their executable tools, and lets the agent chain tool results through the normal loop.

Example:

`Summarize my README and send it by email`

Current behavior:

- File skill can read the README.
- Chat/Coding skill can summarize.
- Email skill appears as a disabled metadata placeholder until an email executor is added.
- Nebula must not claim email was sent without a real email tool result.

## Debugging

Use the Skills page to inspect:

- enabled/disabled state
- version
- category
- permissions
- required tools
- health
- usage and errors
- average runtime
- model preference
- dependencies

Use the Diagnostics page to inspect:

- route decisions
- selected skills and reasons
- model lifecycle events
- latency metrics
- review triggers
- resource snapshots

## Third-Party Packaging

Executable third-party plugins are intentionally not enabled yet. For now, a third-party capability should be packaged as one of:

- a core skill module committed under `src/skills/`
- a marketplace manifest in `src/skills/marketplace.ts`
- a prompt-only local builder skill

Future plugin folders should use this shape:

```text
skills/
  weather/
    skill.ts
    manifest.json
    README.md
```

The manifest should map cleanly onto `SkillDefinition`. Executors must run through Nebula's safety layer rather than arbitrary downloaded code.
