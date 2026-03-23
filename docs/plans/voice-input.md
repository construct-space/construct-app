# Voice Input — Local Speech-to-Text

## Status: Planned

## Problem

Mic button exists in AgentInput but only works in release builds (.app bundle with Info.plist). Dev mode crashes because WKWebView's `webkitSpeechRecognition` triggers a TCC check without a plist. Vosk (tauri-plugin-stt) was evaluated and rejected — Russian voices only, requires native lib install, poor quality.

## Requirements

- Offline/local — no cloud API dependency for basic voice input
- English minimum, multi-language nice to have
- Works in both dev and release builds
- Model downloadable on demand (not bundled with app)
- Settings toggle to enable/download

## Options

### 1. Apple SFSpeechRecognizer via Tauri command (recommended for macOS)
- Native macOS/iOS speech recognition, high quality, on-device
- Call from Rust via `objc2` bindings or a Swift helper
- Tauri command: `stt.start`, `stt.stop`, emits events with transcripts
- Only works on macOS/iOS — need fallback for Linux/Windows
- Requires `NSSpeechRecognitionUsageDescription` in Info.plist (already have it)

### 2. Whisper.cpp embedded
- OpenAI Whisper model running locally via whisper.cpp
- `whisper-rs` crate — Rust bindings
- Models: tiny (75MB), base (142MB), small (466MB)
- High quality, multi-language, fully offline
- Heavier than SFSpeech but cross-platform
- Record audio via `cpal` crate, feed to whisper

### 3. Whisper API via operator
- Send audio to OpenAI/Groq Whisper API
- Requires API key, not offline
- Simplest implementation
- Good fallback when local model isn't available

### 4. Deepgram/AssemblyAI streaming
- Real-time streaming transcription
- Requires API key
- Very high quality
- Could offer as premium option

## Recommended approach

**Phase 1**: Apple SFSpeechRecognizer for macOS (covers primary platform)
- Tauri command in Rust calling native Speech framework
- Frontend: mic button calls `invoke('stt_start')`, listens for `stt:result` events
- No model download needed — uses system speech recognizer
- Works in dev mode (Rust-side, not WebView)

**Phase 2**: Whisper.cpp for cross-platform
- Download model on enable (~75MB tiny, ~142MB base)
- Store in app data dir
- Settings page: choose model size, download progress
- Fallback for Linux/Windows

**Phase 3**: Cloud API fallback
- Whisper API / Groq for users who want instant setup
- Configure API key in Settings > Providers

## Vibe Mode (research needed)

Live conversational mode — talk to the AI like a phone call. No typing, just voice in and voice out.

Research areas:
- **TTS (text-to-speech)**: Apple `AVSpeechSynthesizer` for native voice output, or ElevenLabs/OpenAI TTS API for higher quality
- **Streaming**: agent streams text → TTS reads it aloud in real-time as chunks arrive
- **Turn detection**: detect when user stops speaking (VAD — voice activity detection) to auto-send
- **Interruption**: user can speak while AI is talking to interrupt (like a real conversation)
- **UI**: minimal UI — just a waveform/orb visualization, no chat bubbles
- **Latency**: end-to-end voice latency needs to be < 1s to feel natural — may need streaming STT + streaming LLM + streaming TTS pipeline
- Look at how OpenAI Realtime API, Hume AI, and LiveKit handle this

## Implementation notes

- Mic button stays in AgentInput, dimmed until STT is available
- Remove `webkitSpeechRecognition` code (broken in WKWebView)
- For dev mode: SFSpeechRecognizer works without .app bundle since it's called from Rust, not WebView
