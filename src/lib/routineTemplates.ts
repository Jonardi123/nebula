import type { NebulaRoutine, RoutineTemplate } from '../types/nebula'
import { createRoutineStep, saveNebulaRoutine, makeAutomationId } from './automationRoutines'

function now() {
  return new Date().toISOString()
}

export function getRoutineTemplates(): RoutineTemplate[] {
  return [
    {
      id: 'tpl-system-health-check',
      name: 'System Health Check',
      description: 'Refresh diagnostics, check Memory Core, and notify when Nebula is ready.',
      category: 'system',
      trigger: { type: 'manual', timeOfDay: '09:00', intervalMinutes: 30 },
      riskLevel: 'safe',
      steps: [
        createRoutineStep('refresh_diagnostics'),
        createRoutineStep('search_memory', 'preferences commands project fixes'),
        createRoutineStep('send_notification', 'Nebula health check finished.'),
      ],
    },
    {
      id: 'tpl-project-warmup',
      name: 'Project Warmup',
      description: 'Summarize the current project and recall useful project memory.',
      category: 'project',
      trigger: { type: 'project_opened', timeOfDay: '09:00', intervalMinutes: 30 },
      riskLevel: 'safe',
      steps: [
        createRoutineStep('summarize_project'),
        createRoutineStep('search_memory', 'project lessons mistakes commands'),
        createRoutineStep('send_notification', 'Project warmup complete.'),
      ],
    },
    {
      id: 'tpl-fix-my-app-scan',
      name: 'Fix My App Scan',
      description: 'Run a safe project summary and memory scan before a debugging session.',
      category: 'project',
      trigger: { type: 'manual', timeOfDay: '09:00', intervalMinutes: 30 },
      riskLevel: 'safe',
      steps: [
        createRoutineStep('summarize_project'),
        createRoutineStep('search_memory', 'recent errors build failed fix'),
        createRoutineStep('send_notification', 'Fix My App scan is ready. Open Tasks to continue.'),
      ],
    },
    {
      id: 'tpl-model-health-check',
      name: 'Model Health Check',
      description: 'Refresh diagnostics and notify you to run the speed profiler if models feel slow.',
      category: 'models',
      trigger: { type: 'lmstudio_online', timeOfDay: '09:00', intervalMinutes: 30 },
      riskLevel: 'safe',
      steps: [
        createRoutineStep('refresh_diagnostics'),
        createRoutineStep('send_notification', 'LM Studio is online. Use Model Profiler for latency checks.'),
      ],
    },
    {
      id: 'tpl-summarize-today',
      name: 'Summarize Today',
      description: 'Collect recent Memory Core notes and produce a daily reminder card.',
      category: 'daily',
      trigger: { type: 'scheduled_time', timeOfDay: '18:00', intervalMinutes: 30 },
      riskLevel: 'safe',
      steps: [
        createRoutineStep('search_memory', 'today project commands lessons preferences'),
        createRoutineStep('send_notification', 'Daily Nebula summary is ready in routine history.'),
      ],
    },
    {
      id: 'tpl-open-coding-workspace',
      name: 'Open Coding Workspace',
      description: 'Launch a known safe coding helper app and warm project context.',
      category: 'desktop',
      trigger: { type: 'manual', timeOfDay: '09:00', intervalMinutes: 30 },
      riskLevel: 'needs_confirmation',
      steps: [
        createRoutineStep('open_known_app', 'explorer'),
        createRoutineStep('summarize_project'),
        createRoutineStep('send_notification', 'Coding workspace routine finished.'),
      ],
    },
  ]
}

export function installRoutineTemplate(template: RoutineTemplate): NebulaRoutine {
  const timestamp = now()
  return saveNebulaRoutine({
    id: makeAutomationId('routine'),
    name: template.name,
    description: template.description,
    trigger: template.trigger,
    steps: template.steps.map((step) => ({ ...step, id: makeAutomationId('step') })),
    riskLevel: template.riskLevel,
    enabled: template.trigger.type === 'manual',
    createdAt: timestamp,
    updatedAt: timestamp,
    runHistory: [],
  })
}
