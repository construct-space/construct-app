//! Local STT via whisper-rs (whisper.cpp) with Metal acceleration.
//!
//! Runs entirely on-device — no API keys needed.
//! Expects 16kHz mono f32 PCM audio input.
//! Transcription runs on a blocking thread to avoid stalling the async runtime.

use serde::Serialize;
use std::path::Path;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

#[derive(Serialize, Clone, Debug)]
pub struct SttSegment {
    pub start: f32,
    pub end: f32,
    pub text: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct SttTranscription {
    pub language: Option<String>,
    pub segments: Vec<SttSegment>,
    pub text: String,
}

/// Shared STT engine state, managed by Tauri.
pub struct SttState {
    engine: Arc<Mutex<Option<SttEngine>>>,
}

impl SttState {
    pub fn new() -> Self {
        Self {
            engine: Arc::new(Mutex::new(None)),
        }
    }
}

struct SttEngine {
    ctx: WhisperContext,
}

// Safety: WhisperContext is Send. We protect access with a Mutex.
unsafe impl Send for SttEngine {}

impl SttEngine {
    fn new(model_path: &str) -> Result<Self, String> {
        if !Path::new(model_path).exists() {
            return Err(format!("Whisper model not found: {}", model_path));
        }
        let mut params = WhisperContextParameters::default();
        params.use_gpu = true;
        params.flash_attn = true;
        params.gpu_device = 0;
        log::info!("[STT] Loading model with Metal GPU + flash attention");
        let ctx = WhisperContext::new_with_params(model_path, params)
            .map_err(|e| format!("Failed to load Whisper model: {}", e))?;
        Ok(Self { ctx })
    }

    fn transcribe(&self, audio: &[f32], language: Option<&str>) -> Result<String, String> {
        let mut state = self
            .ctx
            .create_state()
            .map_err(|e| format!("Failed to create Whisper state: {}", e))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(language);
        params.set_translate(false);
        params.set_no_timestamps(true);
        params.set_single_segment(true);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        // Use available cores but cap to avoid starving the app
        params.set_n_threads(std::cmp::min(num_cpus(), 4) as i32);

        state
            .full(params, audio)
            .map_err(|e| format!("Whisper transcription failed: {}", e))?;

        let n_segments = state
            .full_n_segments()
            .map_err(|e| format!("Failed to get segments: {}", e))?;

        let mut text = String::new();
        for i in 0..n_segments {
            if let Ok(seg) = state.full_get_segment_text(i) {
                text.push_str(&seg);
            }
        }
        Ok(text.trim().to_string())
    }

    fn transcribe_segments(
        &self,
        audio: &[f32],
        language: Option<&str>,
    ) -> Result<SttTranscription, String> {
        let mut state = self
            .ctx
            .create_state()
            .map_err(|e| format!("Failed to create Whisper state: {}", e))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(language);
        params.set_translate(false);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_token_timestamps(true);
        params.set_n_threads(std::cmp::min(num_cpus(), 4) as i32);

        state
            .full(params, audio)
            .map_err(|e| format!("Whisper transcription failed: {}", e))?;

        let n_segments = state
            .full_n_segments()
            .map_err(|e| format!("Failed to get segments: {}", e))?;

        let mut segments = Vec::with_capacity(n_segments as usize);
        let mut full_text = String::new();
        for i in 0..n_segments {
            let seg_text = state
                .full_get_segment_text(i)
                .map_err(|e| format!("Failed to read segment {}: {}", i, e))?;
            // whisper.cpp returns t0/t1 in centiseconds (10ms units)
            let t0 = state
                .full_get_segment_t0(i)
                .map_err(|e| format!("Failed to read t0 at {}: {}", i, e))?
                as f32
                / 100.0;
            let t1 = state
                .full_get_segment_t1(i)
                .map_err(|e| format!("Failed to read t1 at {}: {}", i, e))?
                as f32
                / 100.0;
            let trimmed = seg_text.trim();
            if !trimmed.is_empty() {
                if !full_text.is_empty() {
                    full_text.push(' ');
                }
                full_text.push_str(trimmed);
            }
            segments.push(SttSegment {
                start: t0,
                end: t1,
                text: trimmed.to_string(),
            });
        }
        Ok(SttTranscription {
            language: language.map(|s| s.to_string()),
            segments,
            text: full_text,
        })
    }
}

fn num_cpus() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
}

// ── Tauri commands ──

/// Initialize the Whisper STT engine with a model file.
#[tauri::command]
pub async fn stt_init(state: State<'_, SttState>, model_path: String) -> Result<(), String> {
    // Load model on a blocking thread — it's heavy I/O + init
    let engine = tokio::task::spawn_blocking(move || SttEngine::new(&model_path))
        .await
        .map_err(|e| format!("Spawn failed: {}", e))??;

    let mut guard = state.engine.lock().await;
    *guard = Some(engine);
    log::info!("[STT] Whisper engine ready");
    Ok(())
}

/// Transcribe base64-encoded audio. Expects 16kHz mono f32 PCM (little-endian).
#[tauri::command]
pub async fn stt_transcribe(
    state: State<'_, SttState>,
    audio_b64: String,
    language: Option<String>,
) -> Result<String, String> {
    let audio_bytes =
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &audio_b64)
            .map_err(|e| format!("Invalid base64 audio: {}", e))?;

    if audio_bytes.len() % 4 != 0 {
        return Err("Audio bytes must be aligned to f32 (4 bytes per sample)".to_string());
    }
    let audio: Vec<f32> = audio_bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();

    if audio.is_empty() {
        return Err("Empty audio".to_string());
    }

    let duration_secs = audio.len() as f32 / 16000.0;
    log::info!(
        "[STT] Transcribing {:.1}s of audio ({} samples)",
        duration_secs,
        audio.len()
    );

    // Clone the Arc so we can move it into the blocking thread
    let engine_arc = state.engine.clone();

    let text = tokio::task::spawn_blocking(move || {
        // Lock inside the blocking thread — won't stall tokio
        let guard = engine_arc.blocking_lock();
        let engine = guard.as_ref().ok_or("STT engine not initialized")?;
        engine.transcribe(&audio, language.as_deref())
    })
    .await
    .map_err(|e| format!("Spawn failed: {}", e))??;

    log::info!("[STT] Result: {}", text);
    Ok(text)
}

/// Transcribe base64-encoded audio with per-segment timestamps.
/// Expects 16kHz mono f32 PCM (little-endian). Returns segments with start/end in seconds.
#[tauri::command]
pub async fn stt_transcribe_segments(
    state: State<'_, SttState>,
    audio_b64: String,
    language: Option<String>,
) -> Result<SttTranscription, String> {
    let audio_bytes =
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &audio_b64)
            .map_err(|e| format!("Invalid base64 audio: {}", e))?;

    if audio_bytes.len() % 4 != 0 {
        return Err("Audio bytes must be aligned to f32 (4 bytes per sample)".to_string());
    }
    let audio: Vec<f32> = audio_bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();

    if audio.is_empty() {
        return Err("Empty audio".to_string());
    }

    let duration_secs = audio.len() as f32 / 16000.0;
    log::info!(
        "[STT] Transcribing (segments) {:.1}s of audio ({} samples)",
        duration_secs,
        audio.len()
    );

    let engine_arc = state.engine.clone();
    let result = tokio::task::spawn_blocking(move || {
        let guard = engine_arc.blocking_lock();
        let engine = guard.as_ref().ok_or("STT engine not initialized")?;
        engine.transcribe_segments(&audio, language.as_deref())
    })
    .await
    .map_err(|e| format!("Spawn failed: {}", e))??;

    log::info!(
        "[STT] Segments: {}, total chars: {}",
        result.segments.len(),
        result.text.len()
    );
    Ok(result)
}

/// Check if STT engine is loaded.
#[tauri::command]
pub async fn stt_status(state: State<'_, SttState>) -> Result<bool, String> {
    let guard = state.engine.lock().await;
    Ok(guard.is_some())
}
