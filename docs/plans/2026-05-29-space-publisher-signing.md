# Space publisher signing

Status: client verification scaffold landed (inert by default); publish-side
signing + key ceremony pending.

## Problem

Dynamic spaces are arbitrary JS executed via `eval()` in the host webview
(`SpaceLoader.ts`), with the host's full Tauri capability set (shell, fs,
sql, http_fetch). The only pre-execution gates today are:

1. `manifest.build.checksum` — SHA-256 of `app.iife.js`. **Self-referential**:
   the checksum ships in the same manifest as the bundle, so an attacker who
   can replace the bundle replaces the checksum too. Detects corruption, not
   tampering.
2. `scanBundleForForbiddenNativeAccess` — a static string scan, trivially
   defeated by obfuscation (`window['__TAU'+'RI__']`).

So "did this code come from a publisher I trust, unmodified?" is currently
unanswerable. Signing answers it.

## Design

**Authenticity via ECDSA P-256 / SHA-256.** The publish pipeline signs the
bundle bytes with a private key; the app verifies against a pinned public key.

- **Algorithm:** ECDSA P-256, SHA-256 digest. Chosen over Ed25519 because
  `crypto.subtle` P-256 support is universal across the system webviews Tauri
  rides (WKWebView / WebView2 / WebKitGTK); Ed25519 is still patchy in WKWebView.
- **What is signed (v1):** the exact bytes of `app.iife.js` — the same bytes
  the checksum covers, and the only *executable* content. (Future: sign the
  hash of `checksums.json` to cover every file — manifest, css, agent configs —
  in one signature. See "Future".)
- **Manifest fields** (added to `manifest.build`):
  - `signature`: base64 (standard) of the raw ECDSA signature.
  - `signKeyId`: id of the key that signed it (enables rotation — verify against
    the named key, fall back to the first pinned key if absent).
- **Trust anchor:** `TRUSTED_SPACE_KEYS` in `frontend/space_loader/signature.ts`
  — an array of `{ id, spkiB64 }` (base64 SPKI DER of the P-256 public key).
  Pinned in the app binary so a compromised marketplace API can't swap the key.

### Verification (implemented)

`verifyBundleSignature(jsContent, manifest.build, { trusted, policy, keys })`
in `signature.ts`, called from `loadSpaceFromSource` after the checksum phase:

- `signed-valid` → load.
- `signed-invalid` (signature present but doesn't verify, or no key to verify
  it) → **always rejected**, regardless of policy. A bad signature is a
  positive tamper signal.
- `unsigned` → governed by policy.
- Dev-linked / preview spaces pass `trusted: false` → exempt (rebuilt locally,
  never signed).

### Rollout policy (`signaturePolicy()`, `VITE_SPACE_SIGNATURE_POLICY`)

| policy    | unsigned          | signed-invalid | default |
|-----------|-------------------|----------------|---------|
| `off`     | load              | load           |         |
| `warn`    | load + warn       | **reject**     | ✅ now  |
| `require` | **reject**        | **reject**     | target  |

Default `warn` is non-breaking: every currently-installed space is unsigned
(verified against the real data dir — none carry `build.signature`), and
`TRUSTED_SPACE_KEYS` is empty, so behaviour is identical to today.

## Remaining work (publish side — developer-api / `construct` CLI / cli)

1. **Key ceremony.** Generate the marketplace P-256 keypair. Private key lives
   in the publish service's secret store (never in the repo / app). Record the
   public SPKI.
2. **Pin the public key.** Add `{ id, spkiB64 }` to `TRUSTED_SPACE_KEYS`.
3. **Sign at publish.** `construct publish` (or the server-side upload handler)
   signs `app.iife.js` after build and writes `build.signature` + `build.signKeyId`
   into the bundled `manifest.json`. Must sign the exact bytes the app reads
   (`src.readText(jsEntry)`), so sign post-build, pre-zip.
4. **Flip to `require`.** Once a full marketplace re-publish wave is signed (or
   a grace window passes), set `VITE_SPACE_SIGNATURE_POLICY=require`. Communicate
   to third-party publishers first — unsigned/old bundles stop loading.
5. **Surface in UI.** `DynamicSpacePage` already renders `_lastLoadError`; the
   new `phase: 'signature'` errors flow through it. Consider a "verified
   publisher" badge for `signed-valid`.

## Future hardening

- Sign the digest of `checksums.json` instead of just the JS, covering every
  file in the bundle (manifest `actions`/`permissions`, css, agent configs).
- Per-publisher keys (each developer signs with their own key, app trusts a
  marketplace-signed key registry) instead of a single marketplace key.
- Revocation: a signed, app-fetched revocation list keyed by `signKeyId` +
  space id + version, checked at load.
- Move verification into Rust (`ed25519-dalek`/`p256`) if we ever want it on a
  path that doesn't have `crypto.subtle`.

## Why not just enforce now

Enforcing `require` today would brick every installed space (all unsigned) and
the entire marketplace until the publish pipeline signs. The staged policy lets
the verification machinery ship and bake while the (cross-repo) signing side
catches up, with `signed-invalid` already hard-failing so the protection is
real the moment a single bundle is signed.
