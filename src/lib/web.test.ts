import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPrivateOrLocalUrl, isSuspiciousUrl, webSearch } from './web'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('webSearch', () => {
  it('parses live Bing result cards and unwraps their destination URLs', async () => {
    const target = 'https://example.com/docs'
    const encodedTarget = `a1${btoa(target).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
    const html = `
      <ol id="b_results">
        <li class="b_algo">
          <h2><a href="https://www.bing.com/ck/a?u=${encodedTarget}"><strong>Nebula</strong> Docs &#38; Guide</a></h2>
          <div class="b_caption"><p>Verified documentation result.</p></div>
        </li>
      </ol>
    `
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })))

    const results = await webSearch('Nebula docs', 3)

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      title: 'Nebula Docs & Guide',
      url: target,
      snippet: 'Verified documentation result.',
    })
  })

  it('fails honestly instead of returning fabricated fallback results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html><body>No result cards</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })))

    await expect(webSearch('unknown current event', 5)).rejects.toThrow(
      'Live web search returned no verified results',
    )
  })
})

describe('SSRF protection', () => {
  it('blocks private and local network addresses', () => {
    expect(isPrivateOrLocalUrl('http://localhost:8080/path')).toBe(true)
    expect(isPrivateOrLocalUrl('http://127.0.0.1:1234/api')).toBe(true)
    expect(isPrivateOrLocalUrl('http://0.0.0.0')).toBe(true)
    expect(isPrivateOrLocalUrl('http://[::1]')).toBe(true)
    expect(isPrivateOrLocalUrl('http://10.0.0.1:80')).toBe(true)
    expect(isPrivateOrLocalUrl('http://192.168.1.1')).toBe(true)
    expect(isPrivateOrLocalUrl('http://172.16.0.1')).toBe(true)
    expect(isPrivateOrLocalUrl('http://169.254.1.1')).toBe(true)
    expect(isPrivateOrLocalUrl('http://myhost.local')).toBe(true)
  })

  it('blocks non-HTTP protocols and downloadable file extensions', () => {
    expect(isPrivateOrLocalUrl('ftp://example.com/file')).toBe(true)
    expect(isPrivateOrLocalUrl('file:///etc/passwd')).toBe(true)
    expect(isPrivateOrLocalUrl('https://example.com/installer.exe')).toBe(true)
    expect(isPrivateOrLocalUrl('https://example.com/archive.zip')).toBe(true)
  })

  it('allows legitimate public HTTPS URLs', () => {
    expect(isPrivateOrLocalUrl('https://example.com')).toBe(false)
    expect(isPrivateOrLocalUrl('https://docs.github.com/en/actions')).toBe(false)
  })

  it('treats unparseable URLs as private', () => {
    expect(isPrivateOrLocalUrl('not-a-url')).toBe(true)
  })

  it('flags URLs with credentials or suspicious keywords', () => {
    expect(isSuspiciousUrl('https://user:pass@example.com')).toBe(true)
    expect(isSuspiciousUrl('https://example.com/auth/callback?token=abc')).toBe(true)
    expect(isSuspiciousUrl('https://example.com/download/payload')).toBe(true)
    expect(isSuspiciousUrl('https://example.com/search?q=normal')).toBe(false)
  })
})
