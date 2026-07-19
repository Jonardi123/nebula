import { afterEach, describe, expect, it, vi } from 'vitest'
import { webSearch } from './web'

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
