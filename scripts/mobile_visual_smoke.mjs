import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'

const baseUrl = process.env.NEBULA_MOBILE_URL || 'http://127.0.0.1:4174'
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
})

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const json = path === '/api/v1/status'
      ? { ok: true, runtime: { service: 'online', agentStatus: 'idle', model: 'Nebula Qwen', memory: 'ready' } }
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
  const box = await composer.boundingBox()
  if (!box || box.y + box.height > 844) throw new Error('Composer is outside the iPhone viewport')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  if (overflow) throw new Error('Mobile layout has horizontal overflow')

  await mkdir('build', { recursive: true })
  await page.screenshot({ path: 'build/mobile-chat-smoke.png', fullPage: true })
  await page.getByRole('button', { name: 'Open conversations' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByText('Appearance', { exact: true }).waitFor()
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'build/mobile-settings-smoke.png', fullPage: true })
  console.log(`Mobile visual smoke passed. Composer y=${Math.round(box.y)}, height=${Math.round(box.height)}.`)
} finally {
  await browser.close()
}
