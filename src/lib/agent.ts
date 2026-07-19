import type { AgentStatus, ChatMessage } from '../types/agent'
import type { AppSettings } from '../types/settings'
import type { ApprovalRequest, ToolName, ToolRequest, ToolResult } from '../types/tools'
import {
  canRetryWithoutNativeTools,
  sendChatWithTools,
  sendLmChatWithoutTools,
  streamChat,
  type LmChatMessage,
} from './lmstudio'
import { classifyTool, toolNeedsApproval } from './commandSafety'
import { executeTool, parseToolRequest } from './tools'
import {
  findSkillForTool,
  getEnabledSkills,
  getEnabledSystemPromptAdditions,
  getEnabledToolNames,
  getOpenAIToolsForEnabledSkills,
  getOpenAIToolsForSelectedSkills,
  recordSkillExecution,
} from '../skills'
import { webSearch, type WebSearchResult } from './web'
import { recordModelError, recordModelLoadMetric } from './modelStats'
import { ensureModelReady, modelModeToRole, scheduleHeavyModelIdleUnload, warmModelInBackground } from './modelManager'
import { buildNebulaContext, type NebulaContextHints } from './contextEngine'
import { orchestrateRequest } from './modelOrchestrator'
import { recordContextBundle, recordDiagnosticEvent } from './orchestratorDiagnostics'
import { saveContextInspectorSnapshot } from './contextInspector'
import { NEBULA_IDENTITY_RULES } from './nebulaIdentity'
import { throwIfRunCancelled } from './agentRun'
import { getRuntimeExecutionGrant } from './runtimeExecution'
import { recordExecutionReceipt, updateExecutionReceipt } from './executionReceipts'

export const MAIN_AGENT_SYSTEM_PROMPT = `You are Nebula, a local AI assistant running on Jonard's computer.

Your primary goals are:

1. Help the user solve problems.
2. Write, review, and improve code.
3. Use available tools when necessary.
4. Remember useful lessons.
5. Be honest about what you know and what you do not know.
6. Never claim an action succeeded unless a tool confirms it.

You are not a chatbot pretending to have abilities.

You are an AI agent with access to:

* Memory
* Files
* Terminal tools
* Web search
* Web fetch
* Project workspaces
* User-approved PC actions

Always think before acting.

Rules:

* Read before editing.
* Understand before changing.
* Search memory before searching the web.
* Prefer fixing root causes over temporary workarounds.
* Explain your reasoning clearly when useful.
* Ask questions if important information is missing.
* For greetings, small talk, or simple direct questions, answer briefly in 1-3 sentences.
* Do not list capabilities unless the user asks what you can do.

Qwen2.5-Coder Operating Mode:

* Be concise during tool workflows.
* Prefer one precise tool call over a long explanation when inspection is needed.
* Do not wrap tool JSON in Markdown.
* Do not add comments before or after tool JSON.
* If a tool fails, read the tool result carefully before retrying.
* For coding tasks, inspect the smallest relevant files first, then propose focused edits.

Coding Rules:

* Produce clean, maintainable code.
* Avoid unnecessary complexity.
* Follow existing project style when possible.
* When modifying files, minimize unrelated changes.
* Create diffs instead of rewriting entire files unless necessary.
* Verify solutions using tests when available.

Memory Rules:

* Save useful lessons.
* Save successful fixes.
* Save user preferences.
* Do not save temporary information.
* Do not save secrets, passwords, or tokens.

Web Rules:

* Search the web automatically when the user's question asks for current, external, unfamiliar, or fast-changing information.
* Search memory first; if memory has no useful answer and web tools are available, use web_search.
* Verify important claims when possible.
* Treat only actual web_search or web_fetch results as web evidence.
* Never invent search results, URLs, titles, snippets, dates, scores, or schedules.
* Never print simulated tool syntax such as [web_search query="..."] as if a search ran.
* Record sources for information saved to memory.
* Mark outdated information as needing verification.

Tool Rules:

If a tool is required, respond only with valid tool JSON.
Use double-quoted JSON keys and string values.
Use exactly one top-level object.
The only valid shape is:
{"tool":"tool_name","args":{}}

Example:

{
"tool": "read_file",
"args": {
"path": "src/main.ts"
}
}

Never invent tool results.

Safety Rules:

* Never perform destructive actions without approval.
* Never disable security software.
* Never delete important files without confirmation.
* Never run dangerous commands automatically.
* Never hide actions from the user.

Personality:

Be calm, helpful, curious, and professional.

You are Nebula.

Your purpose is to help the user build, learn, create, and solve problems.

Identity Rules:

* The user experiences one assistant: Nebula.
* Do not mention internal model routing, model names, specialist brains, handoffs, or review passes unless debug details are explicitly requested.
* When specialist routing happens internally, merge the result into one coherent Nebula response.

${NEBULA_IDENTITY_RULES}`

const LIGHTWEIGHT_CHAT_SYSTEM_PROMPT = `You are Nebula, Jonard's local AI assistant.
Reply naturally and concisely in 1-3 sentences.
Always identify yourself as Nebula, never as Qwen or the underlying model.
Do not list capabilities unless asked, and never claim an action occurred without a confirmed tool result.`

const ROLE_PROMPTS = {
  fast: `You are Nebula's fast chat brain.
Your job is quick conversation, simple answers, voice replies, everyday help, summaries, and lightweight reasoning.
Be fast, friendly, and concise.
Do not attempt deep code edits unless routed to the coding model.
If a task needs coding, tool use, file edits, or architecture work, request internal handoff without exposing it to the user.
You remain Nebula in every user-facing answer. Never identify yourself as the base model.`,
  code: `You are Nebula's coding brain.
Your job is programming, debugging, reading files, editing code, terminal planning, project structure, UI implementation, and integration work.
Be precise, practical, and careful.
Prefer minimal safe changes.
Explain what changed.
Ask for review from the review model when changes are risky, large, security-sensitive, or architectural.
You remain Nebula in every user-facing answer. Never identify yourself as the base model.`,
  review: `You are Nebula's senior review brain.
Your job is to inspect plans, code changes, architecture, reasoning quality, security risks, bugs, performance problems, and edge cases.
Be critical but useful.
Do not rewrite everything unless needed.
Return clear findings, severity levels, and recommended fixes.
Focus on correctness, safety, performance, and maintainability.
You remain Nebula in every user-facing answer. Never identify yourself as the base model.`,
} satisfies Record<'fast' | 'code' | 'review', string>

function rolePromptForMode(mode: 'auto' | 'fast' | 'code' | 'review') {
  if (mode === 'code') return ROLE_PROMPTS.code
  if (mode === 'review') return ROLE_PROMPTS.review
  return ROLE_PROMPTS.fast
}

export interface AgentLoopHandlers {
  setStatus: (status: AgentStatus) => void
  onMessage: (message: ChatMessage) => void
  onAssistantToken: (messageId: string, token: string) => void
  onToolRequest: (request: ToolRequest) => void
  onToolResult: (result: ToolResult) => void
  onModelEvent?: (message: string) => void
  onModelResolved?: (model: string) => void
  onModelMetric?: (model: string, metric: { firstTokenMs?: number; loadMs?: number }) => void
  onModelError?: (model: string, error: string) => void
  requestApproval: (approval: ApprovalRequest) => Promise<boolean>
}

function message(role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
    ...extra,
  }
}

function toLmMessage(chatMessage: ChatMessage): LmChatMessage {
  return {
    role: chatMessage.role === 'tool' ? 'system' : chatMessage.role,
    content: chatMessage.role === 'tool' ? `Previous tool result: ${chatMessage.content}` : chatMessage.content,
  }
}

function shouldAutoSearchWeb(userText: string, memoriesFound: boolean) {
  const text = userText.trim()
  if (!text || text.length < 18) return false
  if (memoriesFound && !/\b(latest|current|today|now|news|202[5-9]|updated|recent|price|release|version|docs?)\b/i.test(text)) {
    return false
  }

  return [
    /\b(latest|current|today|right now|nowadays|recent|newest|news|update|changed|still|available|release|version)\b/i,
    /\b(search|look up|google|web|internet|online|source|docs?|documentation)\b/i,
    /\b(price|cost|download|install|requirements|compatibility|benchmark|best model|which model)\b/i,
    /\b(when (?:is|are|will|does|do)|schedule|fixture|kickoff|match|game|score|standings|tournament|world cup|weather|forecast)\b/i,
    /\b(error|failed|not working|unknown|why|how do i|can you find|what is the best)\b/i,
    /\b202[5-9]\b/i,
  ].some((pattern) => pattern.test(text))
}

function explicitResearchRequest(userText: string): { mode: 'web' | 'deep' | 'local'; query: string } | null {
  const definitions = [
    {
      mode: 'web' as const,
      pattern: /^\[WEB SEARCH\]\s*(?:Search the web for current sources, cite useful links, then answer\.\s*Query:\s*)?/i,
    },
    {
      mode: 'deep' as const,
      pattern: /^\[DEEP RESEARCH\]\s*(?:Do deeper multi-source research\.\s*Search broadly, compare sources, summarize findings, and cite links\.\s*Research goal:\s*)?/i,
    },
    {
      mode: 'local' as const,
      pattern: /^\[LOCAL PROJECT SEARCH\]\s*(?:Search and inspect the active project before answering\.\s*Goal:\s*)?/i,
    },
  ]

  for (const definition of definitions) {
    if (!definition.pattern.test(userText)) continue
    return {
      mode: definition.mode,
      query: userText.replace(definition.pattern, '').trim(),
    }
  }

  return null
}

function normalizeExplicitSearchQuery(query: string) {
  const original = query.trim()
  let normalized = original
    .replace(/^(?:please\s+)?(?:find|look up|search(?:\s+the\s+web)?(?:\s+for)?)\s+/i, '')
    .replace(/\s+(?:and\s+)?(?:then\s+)?(?:answer|tell me|summarize|explain|return|respond|give me)\b[\s\S]*$/i, '')
    .trim()
  const topicOnly = normalized
    .replace(/\b(?:official|website|site|url|link)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(?:the|an?|of)\s+/i, '')
    .trim()
  if (topicOnly.split(/\s+/).filter(Boolean).length >= 2) normalized = topicOnly
  return normalized || original
}

function isLightweightChat(userText: string) {
  const text = userText.trim()
  return text.length < 80 && /^(hi|hello|hey|yo|sup|good (morning|afternoon|evening)|how are you|what'?s up)[.!?\s]*$/i.test(text)
}

function formatWebContext(results: WebSearchResult[]) {
  if (results.length === 0) return ''
  return `VERIFIED LIVE WEB RESULTS checked ${new Date().toISOString()}.
Use only the URLs and claims below as web evidence. Do not invent, alter, or supplement URLs, titles, dates, scores, or schedules. If these results do not answer the question, say that the live search was inconclusive. Do not emit tool syntax such as [web_search ...].\n${results
    .map((result, index) => `${index + 1}. ${result.title}\n   URL: ${result.url}\n   Snippet: ${result.snippet}${result.date ? `\n   Date: ${result.date}` : ''}`)
    .join('\n')}`
}

async function runToolWithSafety(
  toolRequest: ToolRequest,
  settings: AppSettings,
  handlers: AgentLoopHandlers,
  enabledToolNames: Set<ToolName>,
  signal?: AbortSignal,
  source: 'desktop' | 'mobile' | 'voice' | 'automation' = 'desktop',
) {
  throwIfRunCancelled(signal)
  handlers.onToolRequest(toolRequest)

  if (!enabledToolNames.has(toolRequest.tool)) {
    const result: ToolResult = {
      ok: false,
      tool: toolRequest.tool,
      error: `Tool ${toolRequest.tool} is not exposed by an enabled skill.`,
    }
    handlers.onToolResult(result)
    return result
  }

  const safety = classifyTool(toolRequest.tool, toolRequest.args)
  const runtimeGrant = getRuntimeExecutionGrant()
  const executionMode = runtimeGrant.mode === 'full' ? 'full' : settings.actionMode
  const receiptId = crypto.randomUUID()
  const receiptStartedAt = new Date().toISOString()
  recordExecutionReceipt({
    id: receiptId,
    tool: toolRequest.tool,
    request: toolRequest,
    executionMode,
    riskLevel: safety.level,
    source,
    status: safety.level === 'blocked' ? 'blocked' : 'running',
    summary: safety.reason,
    startedAt: receiptStartedAt,
  })

  if (safety.level === 'blocked') {
    const result: ToolResult = {
      ok: false,
      tool: toolRequest.tool,
      error: `Blocked by Safety Agent: ${safety.reason}`,
    }
    updateExecutionReceipt(receiptId, { status: 'blocked', finishedAt: new Date().toISOString() })
    handlers.onToolResult(result)
    return result
  }

  const needsApproval = toolNeedsApproval(executionMode, toolRequest.tool, safety)

  if (needsApproval) {
    handlers.setStatus('waiting_approval')
    const approved = await handlers.requestApproval({
      id: crypto.randomUUID(),
      toolRequest,
      riskLevel: safety.level,
      reason: safety.reason,
      requiresTypedConfirm: safety.requiresTypedConfirm,
    })
    throwIfRunCancelled(signal)

    if (!approved) {
      const result: ToolResult = { ok: false, tool: toolRequest.tool, error: 'User rejected the action.' }
      updateExecutionReceipt(receiptId, { status: 'rejected', finishedAt: new Date().toISOString() })
      handlers.onToolResult(result)
      return result
    }
  }

  handlers.setStatus('running_tool')
  const started = performance.now()
  const result = await executeTool(toolRequest, settings, signal)
  throwIfRunCancelled(signal)
  const skill = findSkillForTool(getEnabledSkills(), toolRequest.tool)
  if (skill) {
    recordSkillExecution(
      skill.id,
      performance.now() - started,
      result.ok,
      result.error,
    )
  }
  updateExecutionReceipt(receiptId, {
    status: result.ok ? 'completed' : 'failed',
    summary: result.ok ? `${toolRequest.tool} completed.` : result.error ?? `${toolRequest.tool} failed.`,
    finishedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    commandJobId: typeof result.output === 'object' && result.output !== null && 'jobId' in result.output
      ? String((result.output as { jobId?: unknown }).jobId ?? '') || undefined
      : undefined,
  })
  handlers.onToolResult(result)
  return result
}

export async function runAgentLoop(
  settings: AppSettings,
  userMessage: ChatMessage,
  history: ChatMessage[],
  handlers: AgentLoopHandlers,
  isStopped: () => boolean,
  contextHints: NebulaContextHints = {},
  signal?: AbortSignal,
) {
  throwIfRunCancelled(signal)
  handlers.setStatus('thinking')
  const orchestration = orchestrateRequest(settings, userMessage.content)
  const selectedModel = orchestration.selection
  const selectedRole = modelModeToRole(selectedModel.mode)
  handlers.setStatus('loading_model')
  const modelReady = await ensureModelReady(settings, selectedRole, selectedModel.model, { signal })
  throwIfRunCancelled(signal)
  const resolvedModel = modelReady.resolvedModel
  handlers.onModelEvent?.(
    settings.showModelDebugInfo
      ? modelReady.fallbackUsed
        ? `Model fallback: requested ${modelReady.requestedModel}, using ${resolvedModel}.`
        : `${selectedRole} model ready: ${resolvedModel}${modelReady.loadMs ? ` (${Math.round(modelReady.loadMs)} ms load)` : ''}`
      : 'Nebula is ready.',
  )
  if (modelReady.loadMs) handlers.onModelMetric?.(resolvedModel, { loadMs: modelReady.loadMs })
  const agentSettings: AppSettings = {
    ...settings,
    model: resolvedModel,
    temperature: selectedModel.temperature,
    maxTokens: selectedModel.maxTokens,
  }
  handlers.onModelResolved?.(resolvedModel)

  const contextBundle = await buildNebulaContext(settings, userMessage.content, history, contextHints)
  throwIfRunCancelled(signal)
  recordContextBundle(contextBundle)
  saveContextInspectorSnapshot(contextBundle, {
    model: settings.showModelDebugInfo ? resolvedModel : undefined,
    route: selectedModel.mode,
  })

  const selectedSkillIds = orchestration.skillMatches.map((match) => match.skill.id)
  const selectedTools = selectedSkillIds.length > 0 ? getOpenAIToolsForSelectedSkills(selectedSkillIds) : []
  const openAiTools = selectedTools.length > 0 ? selectedTools : getOpenAIToolsForEnabledSkills()
  const enabledToolNames = getEnabledToolNames()
  const explicitResearch = explicitResearchRequest(userMessage.content)
  let automaticWebContext = ''
  const shouldSearchWeb = explicitResearch?.mode === 'web' || explicitResearch?.mode === 'deep' || (
    !explicitResearch &&
    (settings.autoWebSearch ?? true) &&
    shouldAutoSearchWeb(userMessage.content, contextBundle.summary.memoryHits > 0)
  )
  let webSearchAttempted = false
  if (enabledToolNames.has('web_search') && shouldSearchWeb) {
    webSearchAttempted = true
    const searchQuery = explicitResearch ? normalizeExplicitSearchQuery(explicitResearch.query) : userMessage.content
    const maxResults = explicitResearch?.mode === 'deep' ? 7 : 4
    const toolRequest: ToolRequest = { tool: 'web_search', args: { query: searchQuery, maxResults } }
    handlers.onToolRequest(toolRequest)
    const safety = classifyTool(toolRequest.tool, toolRequest.args)
    if (safety.level !== 'blocked') {
      const results = await webSearch(searchQuery, maxResults)
        .then((output) => {
          const result: ToolResult = { ok: true, tool: 'web_search', output }
          handlers.onToolResult(result)
          return output
        })
        .catch((error) => {
          handlers.onToolResult({
            ok: false,
            tool: 'web_search',
            error: error instanceof Error ? error.message : String(error),
          })
          return []
        })
      const configuredFetchLimit = settings.maxAutoFetchPages ?? 2
      const fetchLimit = Math.max(
        0,
        Math.min(explicitResearch?.mode === 'deep' ? Math.max(configuredFetchLimit, 3) : configuredFetchLimit, 4),
      )
      const fetched = fetchLimit > 0
        ? await Promise.all(
            results.slice(0, fetchLimit).map(async (result) => {
              const toolRequest: ToolRequest = { tool: 'web_fetch', args: { url: result.url } }
              const safety = classifyTool(toolRequest.tool, toolRequest.args)
              if (safety.level === 'blocked') return null
              const fetchResult = await executeTool(toolRequest, settings, signal)
              handlers.onToolRequest(toolRequest)
              handlers.onToolResult(fetchResult)
              return fetchResult.ok ? fetchResult.output : null
            }),
          )
        : []
      automaticWebContext = formatWebContext(results)
      const fetchedContext = fetched
        .filter(Boolean)
        .map((item: any) => `Fetched source: ${item.url}\nTitle: ${item.title}\nChecked: ${item.dateChecked}\nSummary: ${item.summary}`)
        .join('\n\n')
      if (fetchedContext) automaticWebContext = `${automaticWebContext}\n\n${fetchedContext}`
    }
  }
  if (webSearchAttempted && !automaticWebContext) {
    automaticWebContext = 'LIVE WEB SEARCH FAILED OR RETURNED NO VERIFIED RESULTS. Say clearly that live search was unavailable or inconclusive. Do not claim a search succeeded, do not provide guessed current facts, and do not invent sources or tool output.'
  }
  const skillPromptAdditions = getEnabledSystemPromptAdditions()
  const selectedSkillPrompt = orchestration.skillMatches.length
    ? `Selected skills for this request:\n${orchestration.skillMatches
        .map((match) => `- ${match.skill.name} (${match.confidence}%): ${match.reason}`)
        .join('\n')}`
    : 'No specific skills scored high enough; use general Nebula reasoning and ask a clarification question if needed.'
  const toolPrompt =
    openAiTools.length > 0
      ? `${selectedSkillPrompt}\nExecutable tools exposed for this turn: ${openAiTools.map((tool) => tool.function.name).join(', ')}.\nOther enabled executable tools may be used through JSON mode when clearly necessary: ${[...enabledToolNames].join(', ')}.\n${skillPromptAdditions.map((line) => `- ${line}`).join('\n')}`
      : 'No skills are currently exposing tools.'
  const routePrompt = settings.showModelDebugInfo
    ? `Nebula internal route: ${selectedModel.mode}. Model: ${resolvedModel}. Requested: ${selectedModel.model}. ${selectedModel.reason}${modelReady.fallbackUsed ? ` Fallback used: ${modelReady.fallbackUsed}.` : ''}`
    : `Nebula internal route: specialist brain selected. Do not mention model names, routing, or internal handoffs unless the user explicitly enables debug details.`

  const lightweightChat = selectedModel.mode === 'fast' && isLightweightChat(userMessage.content)
  let loopMessages: ChatMessage[] = lightweightChat
    ? [message('system', LIGHTWEIGHT_CHAT_SYSTEM_PROMPT), ...history.slice(-6), userMessage]
    : [
        message('system', MAIN_AGENT_SYSTEM_PROMPT),
        message('system', rolePromptForMode(selectedModel.mode)),
        message('system', routePrompt),
        message('system', contextBundle.prompt),
        ...(automaticWebContext ? [message('system', automaticWebContext)] : []),
        message('system', toolPrompt),
        ...history,
        userMessage,
      ]

  let lmMessages: LmChatMessage[] = loopMessages.map(toLmMessage)
  let useNativeToolCalls = openAiTools.length > 0 && selectedModel.mode !== 'fast'

  for (let step = 0; step < 8; step += 1) {
    if (isStopped()) {
      handlers.setStatus('stopped')
      return
    }
    throwIfRunCancelled(signal)

    const assistantId = crypto.randomUUID()
    let assistantText = ''
    const assistantMessage = message('assistant', '', { id: assistantId })
    handlers.onMessage(assistantMessage)

    try {
      if (useNativeToolCalls) {
        let response
        try {
          const requestStarted = performance.now()
          response = await sendChatWithTools(agentSettings, lmMessages, openAiTools)
          const firstTokenMs = performance.now() - requestStarted
          recordModelLoadMetric(agentSettings.model, { role: selectedRole, lastFirstTokenMs: firstTokenMs })
          handlers.onModelMetric?.(agentSettings.model, { firstTokenMs })
        } catch (error) {
          if (!canRetryWithoutNativeTools(error)) throw error
          useNativeToolCalls = false
          handlers.onModelEvent?.('LM Studio rejected native tool calling, switching to JSON tool mode for this chat.')
          const requestStarted = performance.now()
          response = await sendLmChatWithoutTools(agentSettings, lmMessages)
          const firstTokenMs = performance.now() - requestStarted
          recordModelLoadMetric(agentSettings.model, { role: selectedRole, lastFirstTokenMs: firstTokenMs })
          handlers.onModelMetric?.(agentSettings.model, { firstTokenMs })
        }

        assistantText =
          response.content ||
          (response.toolCalls.length > 0
            ? response.toolCalls.map((call) => `Tool call: ${call.name} ${JSON.stringify(call.args)}`).join('\n')
            : '')
        if (assistantText) handlers.onAssistantToken(assistantId, assistantText)

        const completedAssistant = { ...assistantMessage, content: assistantText }
        loopMessages = [...loopMessages, completedAssistant]
        const assistantLmMessage: LmChatMessage = {
          role: 'assistant',
          content: response.content,
        }
        if (response.toolCalls.length > 0) {
          assistantLmMessage.tool_calls = response.toolCalls.map((call) => ({
            id: call.id,
            type: 'function' as const,
            function: {
              name: call.name,
              arguments: JSON.stringify(call.args),
            },
          }))
        }
        lmMessages = [
          ...lmMessages,
          assistantLmMessage,
        ]

        if (response.toolCalls.length === 0) {
          const jsonToolRequest = parseToolRequest(response.content)
          if (!jsonToolRequest) {
            handlers.setStatus('idle')
            return
          }

          const result = await runToolWithSafety(jsonToolRequest, settings, handlers, enabledToolNames, signal, contextHints.executionSource)
          const resultContent = JSON.stringify(result)
          loopMessages = [...loopMessages, message('tool', resultContent, { toolResult: result })]
          lmMessages = [
            ...lmMessages,
            {
              role: 'system',
              content: `Tool result for ${jsonToolRequest.tool}: ${resultContent}\nUse this tool result to answer the user's original request. Do not call the same tool again unless the result says more information is required.`,
            },
          ]
          handlers.setStatus('thinking')
          continue
        }

        for (const call of response.toolCalls) {
          const toolRequest: ToolRequest = { tool: call.name as ToolName, args: call.args }
          const result = await runToolWithSafety(toolRequest, settings, handlers, enabledToolNames, signal, contextHints.executionSource)
          const resultContent = JSON.stringify(result)
          loopMessages = [...loopMessages, message('tool', resultContent, { toolResult: result })]
          lmMessages = [
            ...lmMessages,
            {
              role: 'tool',
              tool_call_id: call.id,
              name: call.name,
              content: resultContent,
            },
          ]
        }

        handlers.setStatus('thinking')
        continue
      } else {
        let firstTokenRecorded = false
        const requestStarted = performance.now()
        assistantText = await streamChat(agentSettings, loopMessages, (token) => {
          if (!firstTokenRecorded) {
            firstTokenRecorded = true
            const firstTokenMs = performance.now() - requestStarted
            recordModelLoadMetric(agentSettings.model, { role: selectedRole, lastFirstTokenMs: firstTokenMs })
            handlers.onModelMetric?.(agentSettings.model, { firstTokenMs })
            handlers.onModelEvent?.(`First token from ${agentSettings.model}: ${Math.round(firstTokenMs)} ms`)
          }
          assistantText += token
          handlers.onAssistantToken(assistantId, token)
        })
      }
    } catch (error) {
      handlers.setStatus('error')
      const errorMessage = error instanceof Error ? error.message : String(error)
      recordModelError(agentSettings.model, errorMessage)
      handlers.onModelError?.(agentSettings.model, errorMessage)
      handlers.onMessage(message('assistant', `LM Studio error: ${errorMessage}`))
      return
    }

    const completedAssistant = { ...assistantMessage, content: assistantText }
    loopMessages = [...loopMessages, completedAssistant]
    lmMessages = [...lmMessages, toLmMessage(completedAssistant)]
    const toolRequest = parseToolRequest(assistantText)

    if (!toolRequest) {
      scheduleHeavyModelIdleUnload(settings, selectedRole, resolvedModel)
      if (selectedModel.mode === 'fast' && settings.backgroundPreloadCodeModel && settings.projectFolder) {
        warmModelInBackground(settings, 'code', 'Project context is active after chat.')
      }
      if (selectedModel.reviewAfter) {
        await runReviewPass(settings, userMessage, completedAssistant, history, handlers, isStopped, signal)
      }
      handlers.setStatus('idle')
      return
    }

    const result = await runToolWithSafety(toolRequest, settings, handlers, enabledToolNames, signal, contextHints.executionSource)
    loopMessages = [...loopMessages, message('tool', JSON.stringify(result), { toolResult: result })]
    lmMessages = [...lmMessages, { role: 'tool', content: JSON.stringify(result), name: toolRequest.tool }]
    handlers.setStatus('thinking')
  }

  handlers.setStatus('idle')
}

async function runReviewPass(
  settings: AppSettings,
  userMessage: ChatMessage,
  assistantMessage: ChatMessage,
  history: ChatMessage[],
  handlers: AgentLoopHandlers,
  isStopped: () => boolean,
  signal?: AbortSignal,
) {
  throwIfRunCancelled(signal)
  if (isStopped()) return
  handlers.setStatus('reviewing')
  recordDiagnosticEvent({
    type: 'review',
    label: 'Review pass triggered',
    detail: 'Automatic senior review requested for the current response.',
  })
  const reviewModel = settings.modelAssignments?.review || settings.reviewModel || settings.model
  const ready = await ensureModelReady(settings, 'review', reviewModel, { signal })
  throwIfRunCancelled(signal)
  const reviewSettings: AppSettings = {
    ...settings,
    model: ready.resolvedModel,
    temperature: 0.28,
    maxTokens: Math.min(Math.max(settings.maxTokens || 2048, 1536), 4096),
  }
  handlers.onModelResolved?.(ready.resolvedModel)
  if (ready.loadMs) handlers.onModelMetric?.(ready.resolvedModel, { loadMs: ready.loadMs })
  handlers.onModelEvent?.(settings.showModelDebugInfo ? `Review pass using ${ready.resolvedModel}.` : 'Nebula is checking the result.')

  const reviewId = crypto.randomUUID()
  const reviewMessage = message('assistant', '', { id: reviewId })
  handlers.onMessage(reviewMessage)

  const reviewPrompt: ChatMessage[] = [
    message('system', MAIN_AGENT_SYSTEM_PROMPT),
    message('system', ROLE_PROMPTS.review),
    message(
      'system',
      'Perform a concise Nebula review of the preceding answer. Return only actionable findings with severity, then a short verdict. Do not mention model names or internal routing. Do not invent tool results.',
    ),
    ...history.slice(-8),
    userMessage,
    assistantMessage,
  ]

  let firstTokenRecorded = false
  const started = performance.now()
  const output = await streamChat(reviewSettings, reviewPrompt, (token) => {
    if (!firstTokenRecorded) {
      firstTokenRecorded = true
      const firstTokenMs = performance.now() - started
      recordModelLoadMetric(ready.resolvedModel, { role: 'review', lastFirstTokenMs: firstTokenMs })
      handlers.onModelMetric?.(ready.resolvedModel, { firstTokenMs })
      handlers.onModelEvent?.(`First review token from ${ready.resolvedModel}: ${Math.round(firstTokenMs)} ms`)
    }
    handlers.onAssistantToken(reviewId, token)
  }).catch((error) => {
    const messageText = error instanceof Error ? error.message : String(error)
    recordModelError(ready.resolvedModel, messageText)
    handlers.onModelError?.(ready.resolvedModel, messageText)
    return ''
  })

  if (!output) {
    handlers.onAssistantToken(reviewId, 'Review pass could not complete with the current local model state.')
  }
  scheduleHeavyModelIdleUnload(settings, 'review', ready.resolvedModel)
}
