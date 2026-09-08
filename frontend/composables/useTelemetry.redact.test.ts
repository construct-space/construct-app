import { describe, it, expect } from 'vitest'
import { redactSecrets } from './useTelemetry'

describe('redactSecrets', () => {
  it('redacts Construct-issued tokens (cat_/csk_/cst_, with or without _live_)', () => {
    expect(redactSecrets('invalid token cat_live_abcdef123456')).toBe('invalid token cat_<REDACTED>')
    expect(redactSecrets('csk_ABCDEF12345678 leaked')).toBe('csk_<REDACTED> leaked')
    expect(redactSecrets('using cst_live_zzzzzzzz9999')).toBe('using cst_<REDACTED>')
  })

  it('redacts sensitive query params but keeps the key + the rest of the URL', () => {
    expect(redactSecrets('GET https://api.x/me?access_token=cat_live_secret123&foo=bar'))
      .toBe('GET https://api.x/me?access_token=<REDACTED>&foo=bar')
    expect(redactSecrets('ws://h/bus?token=abc.def-ghi&x=1'))
      .toBe('ws://h/bus?token=<REDACTED>&x=1')
  })

  it('redacts Bearer headers and sk- keys', () => {
    expect(redactSecrets('Authorization: Bearer eyJhbGci.payload.sig'))
      .toBe('Authorization: Bearer <REDACTED>')
    expect(redactSecrets('key sk-ant-api03-abcdefghijkl')).toBe('key sk-<REDACTED>')
  })

  it('normalizes home paths', () => {
    expect(redactSecrets('at /Users/alice/app/main.ts:1')).toContain('<HOME>/app/main.ts:1')
    expect(redactSecrets('at /Users/alice/app/main.ts:1')).not.toContain('alice')
  })

  it('leaves ordinary text untouched', () => {
    const s = 'TypeError: cannot read properties of undefined (reading "foo") at render'
    expect(redactSecrets(s)).toBe(s)
  })
})
