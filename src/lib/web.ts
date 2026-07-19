import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './runtime'

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  date?: string
}

export interface WebFetchResult {
  url: string
  title: string
  summary: string
  text: string
  dateChecked: string
}

const MAX_FETCHED_TEXT = 12000
const MAX_CONTEXT_TEXT = 6000

export function isPrivateOrLocalUrl(url: string) {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()

    if (!['http:', 'https:'].includes(parsed.protocol)) return true
    if (hostname === 'localhost' || hostname.endsWith('.local')) return true
    if (hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '::1') return true
    if (/^10\./.test(hostname)) return true
    if (/^192\.168\./.test(hostname)) return true
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)) return true
    if (/^169\.254\./.test(hostname)) return true
    if (/\.(exe|msi|bat|cmd|ps1|zip|7z|rar|tar|gz|dmg|pkg)$/i.test(parsed.pathname)) return true

    return false
  } catch {
    return true
  }
}

export function isSuspiciousUrl(url: string) {
  try {
    const parsed = new URL(url)
    return (
      parsed.search.length > 180 ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      /\b(download|installer|setup|payload|token|auth|redirect)\b/i.test(url)
    )
  } catch {
    return true
  }
}

export async function webSearch(query: string, maxResults = 5): Promise<WebSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) throw new Error('web_search query is empty.')

  const bingResults = await bingSearch(trimmed, maxResults).catch(() => [])
  if (bingResults.length > 0) return bingResults

  const duckDuckGoResults = await duckDuckGoSearch(trimmed, maxResults).catch(() => [])
  if (duckDuckGoResults.length > 0) return duckDuckGoResults

  throw new Error('Live web search returned no verified results. Nebula will not invent search results.')
}

async function bingSearch(query: string, maxResults: number): Promise<WebSearchResult[]> {
  const checkedAt = new Date().toISOString()
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.max(1, Math.min(maxResults, 10))}`
  const html = isTauriRuntime() ? await invoke<string>('web_fetch_text', { url }) : await browserFetchText(url)
  const results: WebSearchResult[] = []
  const blockPattern = /<li[^>]*class="[^"]*\bb_algo\b[^"]*"[^>]*>[\s\S]*?<\/li>/gi

  for (const blockMatch of html.matchAll(blockPattern)) {
    const block = blockMatch[0] ?? ''
    const titleMatch = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!titleMatch) continue
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    const normalizedUrl = normalizeBingUrl(titleMatch[1] ?? '')
    const title = stripHtml(titleMatch[2] ?? '')
    const snippet = stripHtml(snippetMatch?.[1] ?? '')
    if (!title || !normalizedUrl || isPrivateOrLocalUrl(normalizedUrl)) continue
    results.push({ title, url: normalizedUrl, snippet, date: checkedAt })
    if (results.length >= Math.max(1, Math.min(maxResults, 10))) break
  }

  return results
}

function normalizeBingUrl(rawUrl: string) {
  try {
    const parsed = new URL(decodeHtml(rawUrl), 'https://www.bing.com')
    const encodedTarget = parsed.hostname.endsWith('bing.com') ? parsed.searchParams.get('u') : null
    if (encodedTarget?.startsWith('a1')) {
      const base64 = encodedTarget.slice(2).replace(/-/g, '+').replace(/_/g, '/')
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
      const target = new TextDecoder().decode(Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)))
      if (/^https?:\/\//i.test(target)) return target
    }
    return parsed.href
  } catch {
    return ''
  }
}

async function duckDuckGoSearch(query: string, maxResults: number): Promise<WebSearchResult[]> {
  const checkedAt = new Date().toISOString()
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const html = isTauriRuntime() ? await invoke<string>('web_fetch_text', { url }) : await browserFetchText(url)
  const results: WebSearchResult[] = []
  const blockPattern = /<div class="result results_links[\s\S]*?(?=<div class="result results_links|<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>|$)/gi

  for (const blockMatch of html.matchAll(blockPattern)) {
    const block = blockMatch[0] ?? ''
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!titleMatch) continue

    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)
    const rawUrl = decodeHtml(titleMatch[1] ?? '')
    const title = stripHtml(titleMatch[2] ?? '')
    const snippet = stripHtml(snippetMatch?.[1] ?? '')
    const normalizedUrl = normalizeDuckDuckGoUrl(rawUrl)
    if (!title || !normalizedUrl || isPrivateOrLocalUrl(normalizedUrl)) continue
    results.push({ title, url: normalizedUrl, snippet, date: checkedAt })
    if (results.length >= Math.max(1, Math.min(maxResults, 10))) break
  }

  return results
}

function normalizeDuckDuckGoUrl(rawUrl: string) {
  try {
    const absolute = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl
    const parsed = new URL(absolute, 'https://html.duckduckgo.com')
    const uddg = parsed.searchParams.get('uddg')
    return uddg ? decodeURIComponent(uddg) : parsed.href
  } catch {
    return ''
  }
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
}

export async function webFetch(url: string, _memoryFolder: string): Promise<WebFetchResult> {
  void _memoryFolder

  if (isPrivateOrLocalUrl(url)) {
    throw new Error('Blocked private, local, non-http(s), or downloadable URL.')
  }

  const html = isTauriRuntime() ? await invoke<string>('web_fetch_text', { url }) : await browserFetchText(url)
  const text = stripHtml(html).slice(0, MAX_FETCHED_TEXT)
  const title = extractTitle(html) || new URL(url).hostname
  const summary = summarizeText(text)
  const dateChecked = new Date().toISOString()

  return {
    url,
    title,
    summary,
    text: text.slice(0, MAX_CONTEXT_TEXT),
    dateChecked,
  }
}

async function browserFetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,text/plain;q=0.9,*/*;q=0.2',
    },
  })
  if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${response.statusText}`)
  const contentType = response.headers.get('content-type') ?? ''
  if (!/text|html|json|xml/i.test(contentType)) {
    throw new Error(`Blocked non-text content type: ${contentType || 'unknown'}`)
  }
  return response.text()
}

function extractTitle(html: string) {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim()
}

export function stripHtml(html: string) {
  return decodeHtml(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function summarizeText(text: string) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 5)
    .join(' ')

  return (sentences || text.slice(0, 900)).slice(0, 1200)
}
