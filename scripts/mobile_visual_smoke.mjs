import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'

const baseUrl = process.env.NEBULA_MOBILE_URL || 'http://127.0.0.1:4174'
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
})

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }))
  const page = await context.newPage()
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const json = path === '/api/v1/status'
      ? { ok: true, runtime: {
          service: 'online', agentStatus: 'idle', model: 'Nebula Qwen', memory: 'ready',
          activeProject: { name: 'nebula' },
          capabilities: { webSearch: true, deepResearch: true, deepThinking: true, projectSearch: true, projectContext: true, guidedLearning: true, personalIntelligence: true },
        } }
      : path === '/api/v1/conversations'
        ? { activeId: 'smoke-chat', folders: [], sessions: [{ id: 'smoke-chat', title: 'New chat', pinned: false, folderId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] }] }
        : path === '/api/v1/settings/mobile-control'
          ? { revision: 1, modelMode: 'auto', singleModelEnabled: false, singleModel: '', dailyModel: 'Nebula Qwen', codeModel: 'Nebula Qwen', reviewModel: '', temperature: 0.4, maxTokens: 2048, autoLoadModels: true, keepDailyModelWarm: true, warmModelWhileTyping: true, backgroundPreloadCodeModel: true, enableAutomaticReviewPass: false, contextInjectionEnabled: true, contextBudgetChars: 18000, autoWebSearch: true, maxAutoFetchPages: 3, memoryReviewMode: 'suggest', actionMode: 'guarded' }
          : path === '/api/v1/models'
            ? [{ id: 'Nebula Qwen', displayName: 'Nebula Qwen', loaded: true, role: 'daily' }]
            : path === '/api/v1/diagnostics/mobile'
              ? { service: 'online', agentStatus: 'idle', activeRun: null, model: 'Nebula Qwen', generatedAt: new Date().toISOString() }
              : { ok: true }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) })
  })

  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    const request = indexedDB.open('nebula-mobile-v1', 1)
    await new Promise((resolve, reject) => {
      request.onupgradeneeded = () => request.result.createObjectStore('private-state')
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('private-state', 'readwrite')
        tx.objectStore('private-state').put('visual-smoke-token', 'device-token')
        tx.oncomplete = () => { db.close(); resolve(undefined) }
        tx.onerror = () => reject(tx.error)
      }
      request.onerror = () => reject(request.error)
    })
  })
  await page.reload({ waitUntil: 'networkidle' })
  const composer = page.getByPlaceholder('Ask Nebula')
  await composer.waitFor({ state: 'visible' })
  await composer.fill('Composer hitbox test')
  const standalonePadding = await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-bottom', '66px')
    const value = getComputedStyle(document.querySelector('.composer-wrap')).paddingBottom
    document.documentElement.style.removeProperty('--safe-bottom')
    return value
  })
  if (standalonePadding !== '20px') throw new Error(`Standalone composer safe spacing regressed: ${standalonePadding}`)
  const box = await composer.boundingBox()
  if (!box || box.y + box.height > 844) throw new Error('Composer is outside the iPhone viewport')
  const stage = await page.locator('.mobile-stage').boundingBox()
  if (!stage || Math.round(stage.width) !== 390 || Math.round(stage.height) !== 844) throw new Error(`Mobile stage is not full screen: ${JSON.stringify(stage)}`)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  if (overflow) throw new Error('Mobile layout has horizontal overflow')

  await page.getByRole('button', { name: 'Search conversations' }).click()
  const chatSearchSize = await page.locator('.search-header input').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
  if (chatSearchSize < 16) throw new Error(`Chat search can trigger iOS focus zoom: ${chatSearchSize}px`)
  await page.locator('.search-header > button').click()

  const nativeStage = await page.evaluate(() => {
    const root = document.documentElement
    root.classList.remove('web-mobile', 'pwa-standalone')
    root.classList.add('native-mobile')
    const bounds = document.querySelector('.mobile-stage').getBoundingClientRect()
    return { width: bounds.width, height: bounds.height, top: bounds.top, bottom: bounds.bottom }
  })
  if (Math.round(nativeStage.width) !== 390 || Math.round(nativeStage.height) !== 844 || Math.round(nativeStage.top) !== 0 || Math.round(nativeStage.bottom) !== 844) {
    throw new Error(`Native mobile stage is not edge-to-edge: ${JSON.stringify(nativeStage)}`)
  }
  await page.evaluate(() => {
    document.documentElement.classList.remove('native-mobile')
    document.documentElement.classList.add('web-mobile', 'pwa-standalone')
  })

  await mkdir('build', { recursive: true })
  await page.screenshot({ path: 'build/mobile-chat-smoke.png', fullPage: true })
  await page.getByRole('button', { name: 'Add tools and context' }).click()
  await page.getByRole('button', { name: /Deep Thinking/ }).waitFor()
  await page.screenshot({ path: 'build/mobile-modes-smoke.png', fullPage: true })
  await page.getByRole('button', { name: 'Close modes' }).click()
  await page.setViewportSize({ width: 390, height: 500 })
  await page.waitForTimeout(120)
  const compactBox = await composer.boundingBox()
  if (!compactBox || compactBox.y + compactBox.height > 500) throw new Error('Composer does not follow a reduced visual viewport')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open conversations' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByText('Appearance', { exact: true }).waitFor()
  const settingsSearchSize = await page.locator('.settings-search input').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
  if (settingsSearchSize < 16) throw new Error(`Settings search can trigger iOS focus zoom: ${settingsSearchSize}px`)
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'build/mobile-settings-smoke.png', fullPage: true })
  console.log(`Mobile visual smoke passed. Composer y=${Math.round(box.y)}, height=${Math.round(box.height)}.`)
} finally {
  await browser.close()
}
