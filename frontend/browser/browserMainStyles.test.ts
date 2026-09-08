import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const browserMainSource = readFileSync(
  resolve(__dirname, '../browser-main.ts'),
  'utf8',
)

const browserHtmlSource = readFileSync(
  resolve(__dirname, '../browser.html'),
  'utf8',
)

describe('browser app styling bootstrap', () => {
  it('loads the shared app stylesheet and applies the saved dark theme before mount', () => {
    expect(browserMainSource).toContain("import './assets/css/main.css'")
    expect(browserHtmlSource).toContain("localStorage.getItem('app-theme-id')")
    expect(browserHtmlSource).toContain("document.documentElement.classList.add('dark')")
  })
})
