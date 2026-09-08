import { describe, it, expect, beforeAll } from 'vitest'
import { verifyBundleSignature, type SpaceSigningKey } from './signature'

// Generate a real P-256 keypair once, sign sample bundle bytes, and exercise
// the verifier through its policy branches. Uses the same crypto.subtle the
// runtime uses, so this also proves the import/verify path actually works.

const BUNDLE = 'console.log("hello from a space bundle")'

function bytesToB64(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s)
}

let key: SpaceSigningKey
let goodSig: string

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey)
  key = { id: 'test-key', spkiB64: bytesToB64(spki) }
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    pair.privateKey,
    new TextEncoder().encode(BUNDLE),
  )
  goodSig = bytesToB64(sig)
})

describe('verifyBundleSignature', () => {
  it('accepts a valid signature', async () => {
    const r = await verifyBundleSignature(BUNDLE, { signature: goodSig, signKeyId: 'test-key' },
      { trusted: true, policy: 'require', keys: [key] })
    expect(r.ok).toBe(true)
    expect(r.state).toBe('signed-valid')
  })

  it('rejects a tampered bundle even under "warn"', async () => {
    const r = await verifyBundleSignature(BUNDLE + '/*evil*/', { signature: goodSig, signKeyId: 'test-key' },
      { trusted: true, policy: 'warn', keys: [key] })
    expect(r.ok).toBe(false)
    expect(r.state).toBe('signed-invalid')
  })

  it('rejects a signature with no matching trusted key', async () => {
    const r = await verifyBundleSignature(BUNDLE, { signature: goodSig, signKeyId: 'test-key' },
      { trusted: true, policy: 'warn', keys: [] })
    expect(r.ok).toBe(false)
    expect(r.state).toBe('signed-invalid')
  })

  it('allows unsigned under "warn" but blocks under "require"', async () => {
    const warn = await verifyBundleSignature(BUNDLE, { checksum: 'x' } as never,
      { trusted: true, policy: 'warn', keys: [key] })
    expect(warn.ok).toBe(true)
    expect(warn.state).toBe('unsigned')

    const require = await verifyBundleSignature(BUNDLE, { checksum: 'x' } as never,
      { trusted: true, policy: 'require', keys: [key] })
    expect(require.ok).toBe(false)
    expect(require.state).toBe('unsigned')
  })

  it('exempts dev-linked (untrusted) spaces from enforcement', async () => {
    const r = await verifyBundleSignature(BUNDLE, undefined,
      { trusted: false, policy: 'require', keys: [key] })
    expect(r.ok).toBe(true)
  })

  it('skips entirely under "off"', async () => {
    const r = await verifyBundleSignature(BUNDLE + 'tampered', { signature: goodSig },
      { trusted: true, policy: 'off', keys: [key] })
    expect(r.ok).toBe(true)
  })
})
