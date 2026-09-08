import { describe, it, expect } from 'vitest'
import { rewriteRelativeCssUrls } from './spaceCss'

const toSpaceUrl = (path: string) => `space://localhost/weather/${path.replace(/^\.?\//, '')}`

describe('rewriteRelativeCssUrls', () => {
  it('rewrites a relative url() against a no-slash (zip) cssPath without truncating', () => {
    // Regression: a bundle-relative entry like "style.css" has no "/", so the
    // old baseDir slice produced "style.cs". Must not happen.
    const out = rewriteRelativeCssUrls(`a{background:url(./logo.png)}`, 'style.css', toSpaceUrl)
    expect(out).toBe(`a{background:url("space://localhost/weather/logo.png")}`)
  })

  it('resolves relative to a nested css entry directory', () => {
    const out = rewriteRelativeCssUrls(`a{background:url(img/x.png)}`, 'assets/app.css', toSpaceUrl)
    expect(out).toBe(`a{background:url("space://localhost/weather/assets/img/x.png")}`)
  })

  it('leaves data:, http(s):, blob:, asset:, and space: URLs untouched', () => {
    const css = [
      `a{background:url(data:image/png;base64,AAAA)}`,
      `b{background:url("https://x/y.png")}`,
      `c{background:url(blob:abc)}`,
      `d{background:url(asset://localhost/x.png)}`,
      `e{background:url(space://localhost/weather/x.png)}`,
    ].join('')
    expect(rewriteRelativeCssUrls(css, 'style.css', toSpaceUrl)).toBe(css)
  })
})
