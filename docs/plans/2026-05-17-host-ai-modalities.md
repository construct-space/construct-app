# Host AI Modalities — `useSpeechToText` and friends

**Status:** TODO — design needed before implementation.

## Background

Spaces have started reaching for modalities beyond text LLMs:

- **space-video** imports `useSpeechToText` for `transcribe` actions (currently stubbed; the action throws "not configured").
- **space-canvas** wanted brain-side image search/generation (`callTool('search_images')`) — removed in the 2026-05-17 migration; now freepik-only.
- Future asks already on the horizon: TTS for voice mode in space-chat, image gen in space-design, embeddings for cross-space search.

There's no consistent host-side answer. Brain owns LLM provider routing (Anthropic / OpenAI / MiMo / local), credits accounting, and OAuth. Everything else is currently each-space-rolls-its-own — and breaks the moment we want a unified credit meter or org-level provider settings.

## The real question

"What is the host's AI provider plane?" — not "what does `useSpeechToText` return."

Today brain knows about LLM providers (`brain/provider/anthropic.go`, `brain/provider/openai.go`, etc.) but only along the text/tool-calling axis. STT, TTS, image gen, embeddings, vision (beyond what the LLM API natively does) are unrepresented.

Three plausible shapes:

### Option A — extend brain's provider registry to cover all modalities

```
brain/provider/
  anthropic.go        ← chat, vision
  openai.go           ← chat, vision, embeddings, tts, stt (whisper)
  elevenlabs.go       ← tts, stt
  freepik.go          ← image
  ...
```

SDK exposes `useSpeechToText() / useImageGen() / useTTS() / useEmbeddings()` — each routes through brain to whichever provider the user/org configured for that modality. Same credit meter, same key plumbing, same OAuth flow.

**Pro:** one place for keys, billing, rate-limits. **Con:** brain grows in scope; non-text modalities need different streaming semantics.

### Option B — each modality lives in its own service

Add `api/stt`, `api/tts`, `api/image-gen` services behind the gateway. Brain doesn't touch them. SDK composables call the gateway directly.

**Pro:** clean separation; each service can scale + deploy independently. **Con:** every new modality is a new deploy; credits/billing aggregation gets harder; org settings UI needs to know about N services.

### Option C — first-party modalities through brain, third-party via space-shipped tools

LLM, vision, embeddings, image-gen → brain (cloud APIs).
STT/TTS that need local models (whisper.cpp, coqui) → space ships the tool via [`useSpaceTool`](./2026-05-17-space-binary-api.md).

**Pro:** matches reality of where each modality is moving (some cloud-cheap, some local-only). **Con:** spaces have to know which path to take; awkward for STT specifically since both cloud (ElevenLabs Scribe, Whisper API) and local (whisper.cpp) are common.

## What needs deciding

- **First call**: A, B, or C? Leaning A for v1 — same provider registry, same key vault, same credits — with C-style local fallback only when latency/cost demands it.
- **STT specifically**: do we ship a "default provider" the user gets for free (metered), or require BYO key from day one?
- **Modality matrix**: which modalities are v1? Chat + vision exist. STT is the next ask (video). TTS + image-gen + embeddings are inbound but not blocking.

## API sketch (open)

```ts
const stt = useSpeechToText()
stt.defaultProviderId.value       // 'elevenlabs-scribe' | 'whisper-local' | …
stt.configured.value              // bool — has the org/user provided a key or accepted credits?
const result = await stt.transcribe({
  audio: blob | path,
  language?: string,
  speakers?: number,
})
// { text, segments: [{start, end, text, speaker?}, …], cost? }
```

Same shape for `useImageGen`, `useTTS`, `useEmbeddings` — pluggable provider, identical credit/auth pattern.

## Not in scope here

- LLM provider work — that exists in brain already.
- The agent dispatch question — see [2026-05-17 cross-space dispatch](./2026-05-17-cross-space-agent-dispatch.md).
