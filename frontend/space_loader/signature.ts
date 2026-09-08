/**
 * Space bundle signature verification.
 *
 * The on-disk `manifest.build.checksum` is an INTEGRITY check only — it ships
 * in the same manifest as the bundle, so anyone who can replace the bundle can
 * replace the checksum too. It catches corruption, not tampering.
 *
 * This module adds AUTHENTICITY: an ECDSA P-256 signature over the bundle's JS
 * bytes, produced by the marketplace publish pipeline with a private key, and
 * verified here against a pinned set of public keys. A valid signature proves
 * the bundle is exactly what a trusted publisher released.
 *
 * Rollout is staged so it never bricks already-installed (unsigned) spaces:
 *
 *   - policy 'off'     — skip entirely (escape hatch).
 *   - policy 'warn'    — DEFAULT. Unsigned spaces load with a console warning;
 *                        a PRESENT-but-INVALID signature is still rejected
 *                        (a bad signature is a positive tamper signal).
 *   - policy 'require' — unsigned spaces are also rejected. Flip to this once
 *                        the publish pipeline signs and TRUSTED_SPACE_KEYS is
 *                        populated.
 *
 * Dev-linked spaces (construct space dev) are exempt — they're rebuilt locally
 * and never signed. The caller passes `trusted: false` for those.
 *
 * Crypto: ECDSA P-256 / SHA-256 — chosen over Ed25519 because crypto.subtle
 * support for P-256 is universal across the system webviews Tauri rides on
 * (WKWebView, WebView2, WebKitGTK), whereas Ed25519 is still patchy.
 *
 * See docs/plans/2026-05-29-space-publisher-signing.md for the publish side
 * and key-management plan.
 */

export type SignaturePolicy = 'off' | 'warn' | 'require'

export interface SpaceSigningKey {
  /** Stable identifier referenced by `manifest.build.signKeyId`. */
  id: string
  /** Base64 (standard, padded) of the SubjectPublicKeyInfo (SPKI) DER for a
   *  P-256 public key. */
  spkiB64: string
}

/**
 * Pinned marketplace signing public keys. The private half lives in the
 * developer-api secret store (SPACE_SIGNING_KEY_PEM) and signs app.iife.js at
 * publish time; this public SPKI verifies it. Policy stays 'warn' so unsigned
 * (older) spaces keep loading; signed bundles get verified, and a present-but-
 * invalid signature is always rejected.
 */
export const TRUSTED_SPACE_KEYS: SpaceSigningKey[] = [
  { id: 'marketplace-2026-05', spkiB64: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEYZuLBMtamjiDyFzmZRMl8I6S7WMMuyfXU9Z2ka7AMleB+loajtTrvZkGUp7087IABve/ccjEHae1fQEtcbC2Aw==' },
]

/**
 * Active policy. DEFAULT 'warn' — non-breaking. Overridable at build time via
 * VITE_SPACE_SIGNATURE_POLICY so the rollout can be flipped without a code
 * change once signing is live.
 */
export function signaturePolicy(): SignaturePolicy {
  const v = (import.meta as { env?: Record<string, string> }).env?.VITE_SPACE_SIGNATURE_POLICY
  if (v === 'off' || v === 'warn' || v === 'require') return v
  return 'warn'
}

export type SignatureState = 'signed-valid' | 'signed-invalid' | 'unsigned'

export interface SignatureResult {
  /** Whether the bundle is allowed to load under the current policy. */
  ok: boolean
  state: SignatureState
  reason?: string
}

interface BundleBuildMeta {
  signature?: string
  signKeyId?: string
}

// Back the array with a concrete ArrayBuffer so the result is a valid
// BufferSource for crypto.subtle (TS 5.7's generic Uint8Array<ArrayBufferLike>
// isn't assignable to BufferSource otherwise).
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function utf8Bytes(s: string): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder().encode(s)
  const out = new Uint8Array(new ArrayBuffer(enc.byteLength))
  out.set(enc)
  return out
}

async function importKey(spkiB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    base64ToBytes(spkiB64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )
}

/**
 * Verify a bundle's signature and decide whether it may load.
 *
 * @param jsContent  the exact bundle text the checksum was computed over
 * @param build      manifest.build (carries optional signature + signKeyId)
 * @param opts.trusted   false for dev-linked spaces (exempt from enforcement)
 * @param opts.policy    override (defaults to signaturePolicy())
 * @param opts.keys      override trusted keys (defaults to TRUSTED_SPACE_KEYS) —
 *                       used by tests to inject a known keypair
 */
export async function verifyBundleSignature(
  jsContent: string,
  build: BundleBuildMeta | undefined,
  opts: { trusted: boolean; policy?: SignaturePolicy; keys?: SpaceSigningKey[] } = { trusted: true },
): Promise<SignatureResult> {
  const policy = opts.policy ?? signaturePolicy()
  if (policy === 'off' || !opts.trusted) {
    return { ok: true, state: build?.signature ? 'signed-valid' : 'unsigned', reason: 'enforcement skipped' }
  }

  const keys = opts.keys ?? TRUSTED_SPACE_KEYS
  const sig = build?.signature

  if (!sig) {
    // Unsigned. Allowed under 'warn', rejected under 'require'.
    if (policy === 'require') {
      return { ok: false, state: 'unsigned', reason: 'space is unsigned and signature policy is "require"' }
    }
    return { ok: true, state: 'unsigned', reason: 'unsigned (allowed under "warn")' }
  }

  // A signature is present — it MUST verify, regardless of policy. A
  // present-but-invalid signature is a positive tamper signal.
  const key = keys.find(k => k.id === build?.signKeyId) ?? keys[0]
  if (!key) {
    return { ok: false, state: 'signed-invalid', reason: 'bundle is signed but no trusted key is pinned to verify it' }
  }

  try {
    const pub = await importKey(key.spkiB64)
    const data = utf8Bytes(jsContent)
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pub,
      base64ToBytes(sig),
      data,
    )
    if (!valid) {
      return { ok: false, state: 'signed-invalid', reason: `signature did not verify against key "${key.id}"` }
    }
    return { ok: true, state: 'signed-valid' }
  } catch (e) {
    return { ok: false, state: 'signed-invalid', reason: `signature verification error: ${e instanceof Error ? e.message : String(e)}` }
  }
}
