# Voice Pipeline Implementation Plan

## Tauri/Rust Desktop App with Go AI Sidecar

### Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  Tauri App                       │
│                                                  │
│  ┌──────────┐    ┌───────────────────────────┐  │
│  │ Frontend  │◄──►│     Rust Backend          │  │
│  │ (WebView) │    │                           │  │
│  │           │    │  ┌─────────┐ ┌─────────┐  │  │
│  │ - UI      │    │  │  STT    │ │  TTS    │  │  │
│  │ - State   │    │  │whisper  │ │ kokoro  │  │  │
│  │ - Controls│    │  │  -rs    │ │   ox    │  │  │
│  │           │    │  └────┬────┘ └────▲────┘  │  │
│  └──────────┘    │       │            │       │  │
│                  │       ▼            │       │  │
│                  │  ┌─────────────────┘──┐    │  │
│                  │  │   TCP Client       │    │  │
│                  │  │   (streaming)      │    │  │
│                  │  └────────┬───────────┘    │  │
│                  └───────────┼────────────────┘  │
│                              │ TCP                │
│                  ┌───────────▼───────────────┐   │
│                  │   Go Sidecar (AI Brain)    │   │
│                  │   - LLM orchestration      │   │
│                  │   - Tool calling           │   │
│                  │   - RAG / Agent logic       │   │
│                  └───────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### Target Platform

- macOS (Apple Silicon M1 Air and up, 8GB+ RAM)
- Metal GPU acceleration for STT
- CPU inference for TTS (Kokoro is lightweight enough)

---

## Phase 1: Project Scaffolding

### 1.1 Create Tauri Project

```bash
cargo install create-tauri-app
cargo create-tauri-app voice-app --template vanilla
cd voice-app
```

### 1.2 Cargo.toml Dependencies

Add these to `src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }

# Audio capture & playback
cpal = "0.15"

# STT - Whisper via whisper.cpp
whisper-rs = { version = "0.16", features = ["metal"] }

# TTS - Kokoro via ONNX
kokorox = "0.1"  # check latest version on crates.io

# Audio format handling
hound = "3.5"        # WAV encoding/decoding
rubato = "0.15"      # resampling

# TCP communication with Go sidecar
tokio = { version = "1", features = ["net", "io-util", "sync", "macros", "rt-multi-thread"] }

# Logging
tracing = "0.1"
tracing-subscriber = "0.3"
```

### 1.3 Directory Structure

```
voice-app/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs              # Tauri entry point
│   │   ├── lib.rs               # Module declarations
│   │   ├── audio/
│   │   │   ├── mod.rs
│   │   │   ├── capture.rs       # Mic capture via cpal
│   │   │   └── playback.rs      # Audio playback via cpal
│   │   ├── stt/
│   │   │   ├── mod.rs
│   │   │   └── whisper.rs       # Whisper-rs integration
│   │   ├── tts/
│   │   │   ├── mod.rs
│   │   │   └── kokoro.rs        # Kokorox integration
│   │   ├── bridge/
│   │   │   ├── mod.rs
│   │   │   └── tcp_client.rs    # TCP client to Go sidecar
│   │   └── commands/
│   │       └── mod.rs           # Tauri commands (frontend API)
│   ├── models/                  # Downloaded model files
│   │   ├── whisper-large-v3-turbo.bin
│   │   ├── kokoro-v1.0.onnx
│   │   └── voices-v1.0.bin
│   └── binaries/                # Go sidecar binary
│       └── go-brain-aarch64-apple-darwin
├── src/                         # Frontend (HTML/JS/CSS)
│   ├── index.html
│   ├── main.js
│   └── styles.css
├── go-brain/                    # Go sidecar source
│   ├── main.go
│   ├── go.mod
│   └── ...
└── Cargo.toml
```

---

## Phase 2: Audio Capture Module

### 2.1 Mic Capture (`audio/capture.rs`)

Implement continuous mic capture using `cpal`:

- Open default input device
- Capture at 16kHz mono f32 (Whisper's native format)
- If device doesn't support 16kHz, capture at native rate and resample with `rubato`
- Use a ring buffer or channel (`tokio::sync::mpsc`) to stream audio chunks
- Implement Voice Activity Detection (VAD) to detect speech start/stop
  - Simple energy-based VAD is fine for v1
  - Consider `silero-vad` ONNX model for better accuracy later
- Send complete utterances (speech segments) to STT module

Key design decisions:
- Chunk size: 30ms frames for VAD processing
- Buffer: accumulate chunks during speech, send full utterance on silence detection
- Silence threshold: ~0.5s of silence to end an utterance

### 2.2 Audio Playback (`audio/playback.rs`)

Implement audio playback for TTS output:

- Open default output device
- Accept f32 PCM samples at 24kHz (Kokoro's output rate)
- Resample to device native rate if needed
- Support streaming playback — start playing before full audio is generated
- Use a queue/channel to receive audio chunks from TTS
- Support interruption (stop playback if user starts speaking)

---

## Phase 3: STT Module (Whisper)

### 3.1 Whisper Integration (`stt/whisper.rs`)

```rust
// Pseudocode structure
pub struct SttEngine {
    ctx: WhisperContext,
}

impl SttEngine {
    pub fn new(model_path: &str) -> Result<Self> {
        let params = WhisperContextParameters::default();
        // Metal acceleration is automatic with the "metal" feature
        let ctx = WhisperContext::new_with_params(model_path, params)?;
        Ok(Self { ctx })
    }

    pub fn transcribe(&self, audio: &[f32]) -> Result<String> {
        let mut state = self.ctx.create_state()?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });

        // Key settings
        params.set_language(Some("auto")); // auto-detect language
        params.set_translate(false);       // keep original language
        params.set_no_timestamps(true);    // we don't need timestamps
        params.set_single_segment(true);   // optimize for single utterances
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);

        state.full(params, audio)?;

        let mut text = String::new();
        for i in 0..state.full_n_segments()? {
            text.push_str(&state.full_get_segment_text(i)?);
        }
        Ok(text.trim().to_string())
    }
}
```

### 3.2 Model Selection

- Use `ggml-large-v3-turbo` model (~1.5GB)
- Download from Hugging Face: `ggerganov/whisper-large-v3-turbo`
- For lighter option on 8GB machines: `ggml-medium` (~1.5GB) or `ggml-small` (~500MB)
- Model path should be configurable at runtime

### 3.3 Language Detection

Whisper auto-detects language. After transcription:
- Extract detected language from Whisper state
- Pass language info alongside text to Go brain (useful for multilingual responses)

---

## Phase 4: TTS Module (Kokoro)

### 4.1 Kokoro Integration (`tts/kokoro.rs`)

Two integration approaches — pick one:

**Option A: Use kokorox as a library crate**

If kokorox exposes a library API, import and call directly:

```rust
// Pseudocode — API may differ, check kokorox docs
pub struct TtsEngine {
    engine: KokoroEngine,
}

impl TtsEngine {
    pub fn new(model_path: &str, voices_path: &str) -> Result<Self> {
        let engine = KokoroEngine::load(model_path, voices_path)?;
        Ok(Self { engine })
    }

    pub fn synthesize(&self, text: &str, voice: &str, lang: &str) -> Result<Vec<f32>> {
        self.engine.generate(text, voice, lang, 1.0)
    }
}
```

**Option B: Run kokorox as a subprocess with pipe streaming**

If library integration is difficult, spawn kokorox CLI and pipe text:

```rust
use std::process::{Command, Stdio};
use tokio::io::AsyncWriteExt;

// Spawn kokorox in stream mode
let mut child = Command::new("./koko")
    .arg("stream")
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .spawn()?;

// Pipe text in, get WAV audio out
child.stdin.write_all(text.as_bytes())?;
```

### 4.2 Streaming TTS Playback

Critical for responsiveness — don't wait for full audio before playing:

1. Receive streaming tokens from Go brain over TCP
2. Buffer tokens until a complete sentence is detected (period, question mark, exclamation, newline)
3. Send each complete sentence to Kokoro for synthesis
4. Start playing first sentence audio immediately
5. Queue subsequent sentence audio for seamless playback

### 4.3 Voice Configuration

Kokoro supports multiple voices per language:
- English (US): `af_heart`, `af_sky`, `af_nicole`, `am_adam`, etc.
- English (UK): `bf_emma`, `bm_george`
- Spanish: `ef_dora`
- French: `ff_siwis`
- Japanese: `jf_alpha`
- Chinese: `zf_xiaobei`
- Plus more via espeak-ng

Store voice preference in app config. Let user select via frontend.

---

## Phase 5: TCP Bridge to Go Sidecar

### 5.1 Protocol Design (`bridge/tcp_client.rs`)

Define a simple JSON-over-TCP protocol with newline delimiters:

```json
// Rust -> Go (user speech)
{
    "type": "user_input",
    "text": "What's the weather like?",
    "language": "en",
    "timestamp": 1700000000
}

// Go -> Rust (AI response, streamed token by token or chunk by chunk)
{
    "type": "response_chunk",
    "text": "The weather",
    "done": false
}

// Go -> Rust (final chunk)
{
    "type": "response_chunk",
    "text": ".",
    "done": true
}

// Go -> Rust (error)
{
    "type": "error",
    "message": "Model unavailable"
}

// Rust -> Go (interrupt/cancel)
{
    "type": "cancel"
}
```

### 5.2 TCP Client Implementation

```rust
pub struct BrainClient {
    stream: TcpStream,
    reader: BufReader<OwnedReadHalf>,
    writer: OwnedWriteHalf,
}

impl BrainClient {
    pub async fn connect(addr: &str) -> Result<Self> {
        let stream = TcpStream::connect(addr).await?;
        let (read, write) = stream.into_split();
        Ok(Self {
            reader: BufReader::new(read),
            writer: write,
        })
    }

    pub async fn send_input(&mut self, text: &str, lang: &str) -> Result<()> {
        let msg = serde_json::json!({
            "type": "user_input",
            "text": text,
            "language": lang
        });
        self.writer.write_all(msg.to_string().as_bytes()).await?;
        self.writer.write_all(b"\n").await?;
        Ok(())
    }

    // Returns a stream of response chunks
    pub fn response_stream(&mut self) -> impl Stream<Item = Result<String>> {
        // Read newline-delimited JSON from self.reader
        // Yield each chunk's text field
        // Stop when done == true
    }
}
```

### 5.3 Reconnection & Health Check

- Auto-reconnect if Go sidecar restarts
- Heartbeat ping every 5s
- Queue unsent messages during reconnection

---

## Phase 6: Go Sidecar Setup

### 6.1 Tauri Sidecar Configuration

In `tauri.conf.json`:

```json
{
    "bundle": {
        "externalBin": [
            "binaries/go-brain"
        ]
    }
}
```

### 6.2 Sidecar Lifecycle

In Rust, manage the Go sidecar process:

```rust
// Start sidecar on app launch
let sidecar = app.shell().sidecar("go-brain")
    .args(["--port", "9876"])
    .spawn()?;

// Kill sidecar on app exit
app.on_event(|event| {
    if let tauri::RunEvent::Exit = event {
        sidecar.kill().ok();
    }
});
```

### 6.3 Go Side TCP Server (minimal reference)

The Go brain should:
- Listen on a configurable TCP port (default 9876)
- Accept the JSON protocol defined above
- Stream response tokens back as they're generated
- Support cancel messages to abort generation mid-stream

---

## Phase 7: Pipeline Orchestration

### 7.1 Main Pipeline (`lib.rs` or dedicated orchestrator)

Wire everything together with async channels:

```rust
// Channel architecture
let (audio_tx, audio_rx) = mpsc::channel::<Vec<f32>>(32);      // mic -> STT
let (text_tx, text_rx) = mpsc::channel::<String>(32);           // STT -> TCP
let (response_tx, response_rx) = mpsc::channel::<String>(32);   // TCP -> TTS
let (playback_tx, playback_rx) = mpsc::channel::<Vec<f32>>(32); // TTS -> speaker

// Task 1: Mic capture -> audio chunks
tokio::spawn(async move {
    audio_capture_loop(audio_tx).await;
});

// Task 2: Audio chunks -> transcription
tokio::spawn(async move {
    while let Some(audio) = audio_rx.recv().await {
        let text = stt_engine.transcribe(&audio)?;
        if !text.is_empty() {
            text_tx.send(text).await?;
        }
    }
});

// Task 3: Transcription -> Go brain -> response chunks
tokio::spawn(async move {
    while let Some(text) = text_rx.recv().await {
        brain_client.send_input(&text, "auto").await?;
        let mut sentence_buffer = String::new();

        while let Some(chunk) = brain_client.next_chunk().await? {
            sentence_buffer.push_str(&chunk.text);

            // Flush on sentence boundary
            if is_sentence_end(&sentence_buffer) {
                response_tx.send(sentence_buffer.clone()).await?;
                sentence_buffer.clear();
            }

            if chunk.done { break; }
        }
        // Flush remaining
        if !sentence_buffer.is_empty() {
            response_tx.send(sentence_buffer).await?;
        }
    }
});

// Task 4: Response sentences -> TTS -> audio playback
tokio::spawn(async move {
    while let Some(sentence) = response_rx.recv().await {
        let audio = tts_engine.synthesize(&sentence, "af_heart", "en-us")?;
        playback_tx.send(audio).await?;
    }
});

// Task 5: Audio playback queue
tokio::spawn(async move {
    while let Some(audio) = playback_rx.recv().await {
        play_audio(&audio).await;
    }
});
```

### 7.2 Interruption Handling

When the user starts speaking while TTS is playing:
1. VAD detects speech → immediately stop playback
2. Send `cancel` message to Go brain to abort generation
3. Clear all pending TTS/playback queues
4. Start transcribing the new utterance

---

## Phase 8: Tauri Commands (Frontend API)

### 8.1 Commands (`commands/mod.rs`)

Expose to the frontend:

```rust
#[tauri::command]
async fn start_listening(state: State<'_, AppState>) -> Result<(), String> {
    // Start mic capture + pipeline
}

#[tauri::command]
async fn stop_listening(state: State<'_, AppState>) -> Result<(), String> {
    // Stop mic capture
}

#[tauri::command]
async fn set_voice(state: State<'_, AppState>, voice: String) -> Result<(), String> {
    // Change TTS voice
}

#[tauri::command]
async fn set_language(state: State<'_, AppState>, lang: String) -> Result<(), String> {
    // Set preferred language
}

#[tauri::command]
async fn get_status(state: State<'_, AppState>) -> Result<AppStatus, String> {
    // Return current pipeline status
}
```

### 8.2 Events (Rust -> Frontend)

Emit events for the UI to react to:

```rust
app.emit("stt-result", &TranscriptionEvent { text, language })?;
app.emit("tts-start", ())?;
app.emit("tts-end", ())?;
app.emit("ai-response-chunk", &ResponseChunk { text, done })?;
app.emit("pipeline-status", &status)?;
app.emit("error", &error_msg)?;
```

---

## Phase 9: Frontend (Minimal)

### 9.1 UI Elements

Keep it simple for v1:

- Push-to-talk button (or toggle for continuous listening)
- Status indicator (idle / listening / processing / speaking)
- Transcript display (user speech + AI response)
- Voice selector dropdown
- Language selector dropdown
- Settings panel (model paths, TCP port, etc.)

### 9.2 Event Listeners

```javascript
const { listen } = window.__TAURI__.event;
const { invoke } = window.__TAURI__.core;

listen('stt-result', (event) => {
    appendTranscript('user', event.payload.text);
});

listen('ai-response-chunk', (event) => {
    appendTranscript('ai', event.payload.text);
});

listen('pipeline-status', (event) => {
    updateStatusIndicator(event.payload);
});
```

---

## Phase 10: Model Management

### 10.1 Model Download Script

Create a setup script or first-run flow:

```bash
#!/bin/bash
# download_models.sh

MODELS_DIR="src-tauri/models"
mkdir -p $MODELS_DIR

# Whisper large-v3-turbo (GGML format for whisper.cpp)
echo "Downloading Whisper large-v3-turbo..."
curl -L -o $MODELS_DIR/ggml-large-v3-turbo.bin \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"

# Kokoro ONNX model + voices
echo "Downloading Kokoro model..."
curl -L -o $MODELS_DIR/kokoro-v1.0.onnx \
    "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/kokoro-v1.0.onnx"
curl -L -o $MODELS_DIR/voices-v1.0.bin \
    "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices-v1.0.bin"

echo "Done. Models saved to $MODELS_DIR"
```

### 10.2 App Bundle Considerations

Models are large — don't bundle them in the .app:
- On first launch, check if models exist
- If missing, prompt user and download to `~/Library/Application Support/voice-app/models/`
- Show download progress in UI
- Allow user to point to custom model paths

---

## Implementation Order

Execute phases in this order for fastest working prototype:

1. **Phase 1** — Scaffolding (30 min)
2. **Phase 10** — Download models first so you can test (15 min)
3. **Phase 3** — Get STT working standalone (test with a WAV file) (2 hrs)
4. **Phase 2.1** — Add mic capture, pipe to STT (2 hrs)
5. **Phase 4** — Get TTS working standalone (test with hardcoded text) (2 hrs)
6. **Phase 2.2** — Add audio playback for TTS output (1 hr)
7. **Phase 5** — TCP bridge to Go sidecar (2 hrs)
8. **Phase 6** — Sidecar lifecycle management (1 hr)
9. **Phase 7** — Wire the full pipeline together (3 hrs)
10. **Phase 8** — Tauri commands (1 hr)
11. **Phase 9** — Basic frontend (2 hrs)

**Estimated total: ~16 hours for a working prototype**

---

## Key Technical Notes

### Memory Budget (8GB M1 Air)

| Component | Approx Memory |
|-----------|--------------|
| Whisper large-v3-turbo | ~1.5 GB |
| Kokoro ONNX | ~350 MB |
| Audio buffers | ~50 MB |
| Tauri + WebView | ~200 MB |
| Go sidecar (varies) | ~500 MB - 2 GB |
| **Total** | **~2.6 - 4.1 GB** |

Leaves 4-5GB for macOS and other apps. If the Go brain runs a large local LLM, consider using Whisper `small` or `medium` instead to free up memory.

### Performance Targets

| Metric | Target |
|--------|--------|
| STT latency (utterance → text) | < 1s |
| TTS time-to-first-audio | < 1.5s |
| TCP round-trip overhead | < 50ms |
| Total voice-to-voice latency | < 3s (depends on LLM speed) |

### Gotchas & Tips

- **whisper-rs Metal**: the `metal` feature flag auto-enables GPU. No extra config needed on M1.
- **Audio format**: Whisper expects 16kHz mono f32. cpal may give you different formats — always resample.
- **Kokoro output**: 24kHz f32 PCM. Resample to device rate before playback.
- **Thread safety**: WhisperContext is `Send` but not `Sync`. Create one state per transcription call, or wrap in a `Mutex`.
- **Tauri async**: Use `tokio::spawn` for long-running tasks. Never block the main thread.
- **Sidecar path**: Tauri expects sidecar binaries named with target triple suffix, e.g., `go-brain-aarch64-apple-darwin`.
- **TCP backpressure**: If TTS is slower than Go brain's token streaming, buffer response chunks. Don't drop them.
- **Interruption**: This is the hardest part. Cancellation must propagate through all pipeline stages cleanly. Use `tokio::CancellationToken` or `watch` channels.
