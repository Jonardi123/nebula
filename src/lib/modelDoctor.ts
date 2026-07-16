import { checkLmStudio, listLmStudioModelInfos } from './lmstudio'
import { getModelRunStats } from './modelStats'
import { getResourceSnapshot } from './resourceDiagnostics'
import type { ModelDoctorCheck } from '../types/nebula'
import type { AppSettings } from '../types/settings'

function check(id: string, title: string, status: ModelDoctorCheck['status'], detail: string, fix?: string): ModelDoctorCheck {
  return { id, title, status, detail, fix }
}

function hasModel(models: { id: string }[], model: string) {
  if (!model) return false
  const normalized = model.toLowerCase()
  return models.some((item) => item.id.toLowerCase() === normalized || item.id.toLowerCase().includes(normalized))
}

function loadedModel(models: { id: string; loaded: boolean }[], model: string) {
  if (!model) return false
  const normalized = model.toLowerCase()
  return models.some((item) => item.loaded && (item.id.toLowerCase() === normalized || item.id.toLowerCase().includes(normalized)))
}

function providerName(settings: AppSettings) {
  if (settings.modelProvider === '9router') return '9Router'
  if (settings.modelProvider === 'openrouter') return 'OpenRouter'
  return 'LM Studio'
}

export async function runModelDoctor(settings: AppSettings): Promise<ModelDoctorCheck[]> {
  const checks: ModelDoctorCheck[] = []
  const daily = settings.modelAssignments?.daily || settings.fastModel || settings.model
  const code = settings.modelAssignments?.code || settings.codeModel
  const review = settings.modelAssignments?.review || settings.reviewModel
  const remoteProvider = settings.modelProvider === '9router' || settings.modelProvider === 'openrouter'
  const provider = providerName(settings)

  const health = await checkLmStudio({ ...settings, model: daily }).catch((error) => ({
    online: false,
    model: daily,
    error: error instanceof Error ? error.message : String(error),
  }))

  checks.push(
    check(
      'server',
      remoteProvider ? 'Provider Health' : 'LM Studio Server',
      health.online ? (health.error ? 'warning' : 'success') : 'error',
      health.online
        ? health.error
          ? `Server responded, but the active model check returned: ${health.error}`
          : 'Server is reachable and returned a chat-compatible response.'
        : health.error ?? 'Server did not respond.',
      health.online
        ? undefined
        : remoteProvider
          ? `Check ${provider} credentials/base URL and internet access.`
          : `Open LM Studio, enable the local server, and verify ${settings.endpoint}`,
    ),
  )

  let models: Awaited<ReturnType<typeof listLmStudioModelInfos>> = []
  try {
    models = await listLmStudioModelInfos(settings)
    checks.push(
      check(
        'models-list',
        'Model Inventory',
        models.length ? 'success' : 'warning',
        models.length ? `${models.length} model${models.length === 1 ? '' : 's'} visible to Nebula.` : 'No models were returned by the provider.',
        models.length ? undefined : remoteProvider ? `Verify the ${provider} API key and /models endpoint.` : 'Refresh LM Studio models or confirm the server exposes /api/v1/models.',
      ),
    )
  } catch (error) {
    checks.push(
      check(
        'models-list',
        'Model Inventory',
        'error',
        error instanceof Error ? error.message : String(error),
        remoteProvider ? `Check ${provider} API key/base URL.` : 'Check the endpoint and make sure LM Studio is not still starting.',
      ),
    )
  }

  const assignedModels = [
    ['Daily chat', daily],
    ['Code', code],
    ['Review', review],
  ] as const

  if (daily && code && daily.toLowerCase() === code.toLowerCase()) {
    checks.push(check('daily-code-overlap', 'Daily And Code Models', 'warning', 'Daily chat and coding are assigned to the same model, so Nebula cannot optimize switching or role quality.', 'Keep a lightweight Gemma-class model as Daily and a coder model as Code.'))
  }
  if (daily && /qwen.*coder|coder/i.test(daily)) {
    checks.push(check('daily-coder', 'Daily Chat Assignment', 'warning', `${daily} looks like a coding model assigned to daily chat.`, 'Assign Gemma or another fast instruct model to Daily; keep Qwen Coder under Code.'))
  }

  assignedModels.forEach(([label, model]) => {
    if (!model) {
      checks.push(check(`assignment-${label}`, `${label} Assignment`, 'warning', 'No model assigned.', `Assign a ${label.toLowerCase()} model in Models or Settings.`))
      return
    }
    const present = hasModel(models, model)
    const loaded = loadedModel(models, model)
    checks.push(
      check(
        `assignment-${label}`,
        `${label} Assignment`,
        present ? (remoteProvider || loaded ? 'success' : 'warning') : 'error',
        present
          ? remoteProvider
            ? `${model} is available from ${provider}.`
            : `${model}${loaded ? ' is loaded.' : ' exists but is unloaded.'}`
          : `${model} was not found in ${provider}'s model list.`,
        present
          ? remoteProvider || loaded
            ? undefined
            : 'Use Models > Warm daily model or load it in LM Studio.'
          : 'Pick the exact model id from the Models page.',
      ),
    )
  })

  const stats = getModelRunStats()
  ;[daily, code, review].filter(Boolean).forEach((model) => {
    const stat = stats[model]
    if (!stat) return
    if (stat.lastError) {
      checks.push(check(`error-${model}`, `Last Error: ${model}`, 'error', stat.lastError, 'Try loading the model once, then run a short hello benchmark.'))
    }
    if ((stat.lastResponseMs ?? 0) > 90000) {
      checks.push(check(`slow-${model}`, `Slow Response: ${model}`, 'warning', `Last response took ${Math.round(stat.lastResponseMs ?? 0)} ms.`, 'Use this as code/review only, lower max tokens, or keep Gemma as daily chat.'))
    }
  })

  if (!settings.autoLoadModels && !remoteProvider) {
    checks.push(check('autoload', 'Auto-load Models', 'warning', 'Auto-load is disabled, so unloaded models will fail until manually loaded.', 'Enable auto-load routed LM Studio model in Settings.'))
  }

  if ((settings.maxTokens ?? 0) > 8192) {
    checks.push(check('tokens', 'Max Tokens', 'warning', `${settings.maxTokens} max tokens may slow local models.`, 'Use 2048-4096 for daily chat and only raise it for long code tasks.'))
  }

  const resources = await getResourceSnapshot().catch(() => null)
  if (resources?.vramTotalMb) {
    const vram = resources.vramTotalMb
    checks.push(
      check(
        'vram',
        'VRAM Planning',
        vram <= 8192 ? 'warning' : 'success',
        vram <= 8192
          ? `${vram.toLocaleString()} MB VRAM reported. One model at a time is the safe default; keep daily chat lightweight and lazy-load code/review models.`
          : `${vram.toLocaleString()} MB VRAM reported. Nebula can safely try keeping the daily model warm while lazily loading heavier roles.`,
        vram <= 8192 ? 'Avoid keeping Qwen 14B and GPT-OSS 20B loaded alongside Gemma. Use auto-load and idle unload.' : undefined,
      ),
    )
  }
  if (resources?.ramAvailableMb !== undefined && resources.ramAvailableMb < 4096) {
    checks.push(check('low-ram', 'Available RAM', 'warning', `${resources.ramAvailableMb.toLocaleString()} MB currently free. Model switching can become unstable under memory pressure.`, 'Close heavyweight apps, lower context/max tokens, or use the daily model until memory recovers.'))
  }

  return checks
}
