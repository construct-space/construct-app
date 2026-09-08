//! Audio playback via cpal — streams f32 PCM to the default output device.
//!
//! Supports queuing audio chunks for seamless sentence-by-sentence playback
//! and interruption (stop immediately when user starts speaking).

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use super::tts::TTS_SAMPLE_RATE;

pub struct PlaybackState {
    inner: Arc<Mutex<Option<PlaybackEngine>>>,
}

impl PlaybackState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
        }
    }
}

/// Thread-safe audio buffer shared between cpal callback and Tauri commands.
struct SharedBuffer {
    data: std::sync::Mutex<Vec<f32>>,
    write_pos: AtomicUsize,
    read_pos: AtomicUsize,
    playing: AtomicBool,
}

struct PlaybackEngine {
    buffer: Arc<SharedBuffer>,
    /// Kept alive to maintain the audio stream
    _stream: cpal::Stream,
}

unsafe impl Send for PlaybackEngine {}
unsafe impl Sync for PlaybackEngine {}

impl PlaybackEngine {
    fn new() -> Result<Self, String> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or("No audio output device found")?;

        let config = cpal::StreamConfig {
            channels: 1,
            sample_rate: cpal::SampleRate(TTS_SAMPLE_RATE),
            buffer_size: cpal::BufferSize::Default,
        };

        let buffer = Arc::new(SharedBuffer {
            data: std::sync::Mutex::new(Vec::new()),
            write_pos: AtomicUsize::new(0),
            read_pos: AtomicUsize::new(0),
            playing: AtomicBool::new(false),
        });

        let buf_ref = buffer.clone();

        let stream = device
            .build_output_stream(
                &config,
                move |output: &mut [f32], _info: &cpal::OutputCallbackInfo| {
                    if !buf_ref.playing.load(Ordering::Relaxed) {
                        output.fill(0.0);
                        return;
                    }

                    let read = buf_ref.read_pos.load(Ordering::Relaxed);
                    let write = buf_ref.write_pos.load(Ordering::Relaxed);
                    let available = write.saturating_sub(read);

                    if available == 0 {
                        output.fill(0.0);
                        buf_ref.playing.store(false, Ordering::Relaxed);
                        return;
                    }

                    if let Ok(data) = buf_ref.data.try_lock() {
                        let to_copy = output.len().min(available);
                        for i in 0..to_copy {
                            output[i] = data.get(read + i).copied().unwrap_or(0.0);
                        }
                        for i in to_copy..output.len() {
                            output[i] = 0.0;
                        }
                        buf_ref.read_pos.store(read + to_copy, Ordering::Relaxed);
                    } else {
                        output.fill(0.0);
                    }
                },
                |err| {
                    log::error!("[Playback] Audio stream error: {}", err);
                },
                None,
            )
            .map_err(|e| format!("Failed to build audio stream: {}", e))?;

        stream
            .play()
            .map_err(|e| format!("Failed to start audio stream: {}", e))?;

        Ok(Self {
            buffer,
            _stream: stream,
        })
    }

    fn queue(&self, samples: &[f32]) {
        let mut data = self.buffer.data.lock().unwrap();
        data.extend_from_slice(samples);
        self.buffer.write_pos.store(data.len(), Ordering::Relaxed);
        self.buffer.playing.store(true, Ordering::Relaxed);
    }

    fn stop(&self) {
        self.buffer.playing.store(false, Ordering::Relaxed);
        let mut data = self.buffer.data.lock().unwrap();
        data.clear();
        self.buffer.read_pos.store(0, Ordering::Relaxed);
        self.buffer.write_pos.store(0, Ordering::Relaxed);
    }

    fn is_playing(&self) -> bool {
        self.buffer.playing.load(Ordering::Relaxed)
    }
}

// ── Tauri commands ──

#[tauri::command]
pub async fn playback_init(state: State<'_, PlaybackState>) -> Result<(), String> {
    let engine = PlaybackEngine::new()?;
    let mut guard = state.inner.lock().await;
    *guard = Some(engine);
    log::info!(
        "[Playback] Audio output initialized at {}Hz",
        TTS_SAMPLE_RATE
    );
    Ok(())
}

/// Queue base64-encoded f32 PCM audio for playback.
#[tauri::command]
pub async fn playback_queue(
    state: State<'_, PlaybackState>,
    audio_b64: String,
) -> Result<(), String> {
    let audio_bytes =
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &audio_b64)
            .map_err(|e| format!("Invalid base64: {}", e))?;

    let samples: Vec<f32> = audio_bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();

    let guard = state.inner.lock().await;
    let engine = guard.as_ref().ok_or("Playback not initialized")?;
    engine.queue(&samples);
    Ok(())
}

/// Stop playback and clear queue.
#[tauri::command]
pub async fn playback_stop(state: State<'_, PlaybackState>) -> Result<(), String> {
    let guard = state.inner.lock().await;
    if let Some(engine) = guard.as_ref() {
        engine.stop();
    }
    Ok(())
}

/// Check if audio is currently playing.
#[tauri::command]
pub async fn playback_is_playing(state: State<'_, PlaybackState>) -> Result<bool, String> {
    let guard = state.inner.lock().await;
    Ok(guard.as_ref().map(|e| e.is_playing()).unwrap_or(false))
}
