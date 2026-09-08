//! Local TTS via Kokoro-82M ONNX model.
//!
//! Pipeline: text → misaki G2P → phoneme tokens → ONNX inference → f32 PCM at 24kHz.
//! Runs entirely on-device via ONNX Runtime.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use ort::session::Session;
use tauri::State;
use tokio::sync::Mutex;

pub const TTS_SAMPLE_RATE: u32 = 24000;

/// Available Kokoro voices.
pub const VOICES: &[(&str, &str)] = &[
    ("af_heart", "Heart (Female, US)"),
    ("af_sky", "Sky (Female, US)"),
    ("af_nicole", "Nicole (Female, US)"),
    ("am_adam", "Adam (Male, US)"),
    ("am_michael", "Michael (Male, US)"),
    ("bf_emma", "Emma (Female, UK)"),
    ("bm_george", "George (Male, UK)"),
];

/// Shared TTS engine state, managed by Tauri.
pub struct TtsState {
    engine: Arc<Mutex<Option<TtsEngine>>>,
}

impl TtsState {
    pub fn new() -> Self {
        Self {
            engine: Arc::new(Mutex::new(None)),
        }
    }
}

struct TtsEngine {
    session: Session,
    voices: VoiceStore,
    vocab: HashMap<char, i64>,
    g2p: misaki_rs::g2p::G2P,
    current_voice: String,
    speed: f32,
}

unsafe impl Send for TtsEngine {}

/// Build the Kokoro phoneme vocabulary (178 tokens).
fn build_vocab() -> HashMap<char, i64> {
    let pad = "$";
    let punctuation = r#";:,.!?¡¿—…"«»"" "#;
    let letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let letters_ipa = "ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̩'ᵻ";

    let symbols: String = [pad, punctuation, letters, letters_ipa].concat();
    symbols
        .chars()
        .enumerate()
        .map(|(idx, c)| (c, idx as i64))
        .collect()
}

/// Voice embedding store — loads voice data from individual .bin files.
struct VoiceStore {
    voices_dir: String,
    cache: HashMap<String, Vec<f32>>,
}

impl VoiceStore {
    fn new(voices_dir: &str) -> Self {
        Self {
            voices_dir: voices_dir.to_string(),
            cache: HashMap::new(),
        }
    }

    /// Get the style vector for a voice, indexed by token count.
    /// Each voice .bin file contains style vectors of 256 floats each, one per possible token length.
    fn get_style(&mut self, voice: &str, token_count: usize) -> Result<Vec<f32>, String> {
        if !self.cache.contains_key(voice) {
            let path = format!("{}/{}.bin", self.voices_dir, voice);
            if !Path::new(&path).exists() {
                return Err(format!("Voice file not found: {}", path));
            }
            let bytes =
                std::fs::read(&path).map_err(|e| format!("Failed to read voice file: {}", e))?;
            let floats: Vec<f32> = bytes
                .chunks_exact(4)
                .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                .collect();
            self.cache.insert(voice.to_string(), floats);
        }

        let data = self.cache.get(voice).unwrap();
        let total_vectors = data.len() / 256;
        let idx = token_count.min(total_vectors.saturating_sub(1));
        let start = idx * 256;
        let end = start + 256;

        if end > data.len() {
            return Err(format!("Voice data too short for {} tokens", token_count));
        }

        Ok(data[start..end].to_vec())
    }
}

impl TtsEngine {
    fn new(model_path: &str, voices_dir: &str) -> Result<Self, String> {
        if !Path::new(model_path).exists() {
            return Err(format!("Kokoro model not found: {}", model_path));
        }

        let session = Session::builder()
            .map_err(|e| format!("Failed to create ONNX session builder: {}", e))?
            .with_execution_providers([ort::ep::CoreML::default().build()])
            .map_err(|e| format!("Failed to set CoreML EP: {}", e))?
            .with_intra_threads(4)
            .map_err(|e| format!("Failed to set threads: {}", e))?
            .commit_from_file(model_path)
            .map_err(|e| format!("Failed to load Kokoro model: {}", e))?;
        log::info!("[TTS] Loaded with CoreML (Metal/ANE) acceleration");

        let vocab = build_vocab();
        let g2p = misaki_rs::g2p::G2P::new(misaki_rs::language::Language::EnglishUS);
        let voices = VoiceStore::new(voices_dir);

        Ok(Self {
            session,
            voices,
            vocab,
            g2p,
            current_voice: "af_heart".to_string(),
            speed: 1.0,
        })
    }

    /// Convert text to phoneme token IDs.
    fn tokenize(&self, text: &str) -> Result<Vec<i64>, String> {
        let (phonemes, _tokens) = self
            .g2p
            .g2p(text)
            .map_err(|e| format!("G2P failed: {:?}", e))?;

        let mut ids: Vec<i64> = Vec::new();
        ids.push(0); // BOS pad token ($)

        for ch in phonemes.chars() {
            if let Some(&id) = self.vocab.get(&ch) {
                ids.push(id);
            }
            // Skip unknown chars silently
        }

        ids.push(0); // EOS pad token ($)

        if ids.len() > 512 {
            ids.truncate(512);
        }

        Ok(ids)
    }

    fn synthesize(&mut self, text: &str) -> Result<Vec<f32>, String> {
        if text.trim().is_empty() {
            return Ok(Vec::new());
        }

        // For long text, split into sentences and concatenate
        let sentences = split_sentences(text);
        let mut all_audio = Vec::new();

        for sentence in &sentences {
            let chunk = sentence.trim();
            if chunk.is_empty() {
                continue;
            }
            let audio = self.synthesize_chunk(chunk)?;
            if !all_audio.is_empty() && !audio.is_empty() {
                // 50ms silence gap between sentences at 24kHz
                all_audio.extend(vec![0.0f32; 1200]);
            }
            all_audio.extend(audio);
        }

        Ok(all_audio)
    }

    fn synthesize_chunk(&mut self, text: &str) -> Result<Vec<f32>, String> {
        let tokens = self.tokenize(text)?;
        if tokens.len() <= 2 {
            return Ok(Vec::new()); // Only BOS/EOS
        }

        let token_count = tokens.len();
        let style = self.voices.get_style(&self.current_voice, token_count)?;

        // Build input tensors using ort's ndarray re-export
        let input_ids = ort::value::Tensor::from_array((vec![1, token_count as i64], tokens))
            .map_err(|e| format!("Failed to create input tensor: {}", e))?;

        let style_tensor = ort::value::Tensor::from_array((vec![1_i64, 256], style))
            .map_err(|e| format!("Failed to create style tensor: {}", e))?;

        let speed_tensor = ort::value::Tensor::from_array((vec![1_i64], vec![self.speed]))
            .map_err(|e| format!("Failed to create speed tensor: {}", e))?;

        // Run ONNX inference
        let outputs = self
            .session
            .run(ort::inputs![
                "input_ids" => input_ids,
                "style" => style_tensor,
                "speed" => speed_tensor,
            ])
            .map_err(|e| format!("Kokoro inference failed: {}", e))?;

        // Extract f32 audio output — try_extract_raw_tensor returns (&Shape, &[f32])
        let (_shape, audio_data) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Failed to extract audio: {}", e))?;

        Ok(audio_data.to_vec())
    }
}

/// Split text into sentence-sized chunks for Kokoro (max ~500 chars).
fn split_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();

    for ch in text.chars() {
        current.push(ch);
        if (ch == '.' || ch == '!' || ch == '?') && current.len() > 10 {
            sentences.push(current.trim().to_string());
            current = String::new();
        }
    }

    if !current.trim().is_empty() {
        sentences.push(current.trim().to_string());
    }

    sentences
}

// ── Tauri commands ──

#[tauri::command]
pub async fn tts_init(
    state: State<'_, TtsState>,
    model_path: String,
    voices_dir: String,
) -> Result<(), String> {
    let engine = tokio::task::spawn_blocking(move || TtsEngine::new(&model_path, &voices_dir))
        .await
        .map_err(|e| format!("Spawn failed: {}", e))??;

    let mut guard = state.engine.lock().await;
    *guard = Some(engine);
    log::info!("[TTS] Kokoro engine ready");
    Ok(())
}

/// Synthesize text to base64-encoded f32 PCM at 24kHz mono.
#[tauri::command]
pub async fn tts_synthesize(state: State<'_, TtsState>, text: String) -> Result<String, String> {
    let engine_arc = state.engine.clone();

    let audio = tokio::task::spawn_blocking(move || {
        let mut guard = engine_arc.blocking_lock();
        let engine = guard.as_mut().ok_or("TTS engine not initialized")?;
        engine.synthesize(&text)
    })
    .await
    .map_err(|e| format!("Spawn failed: {}", e))??;

    let bytes: Vec<u8> = audio.iter().flat_map(|f| f.to_le_bytes()).collect();
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    Ok(b64)
}

#[tauri::command]
pub async fn tts_set_voice(state: State<'_, TtsState>, voice: String) -> Result<(), String> {
    let mut guard = state.engine.lock().await;
    let engine = guard.as_mut().ok_or("TTS engine not initialized")?;
    engine.current_voice = voice.clone();
    log::info!("[TTS] Voice set to {}", voice);
    Ok(())
}

#[tauri::command]
pub async fn tts_set_speed(state: State<'_, TtsState>, speed: f32) -> Result<(), String> {
    let mut guard = state.engine.lock().await;
    let engine = guard.as_mut().ok_or("TTS engine not initialized")?;
    engine.speed = speed.clamp(0.5, 2.0);
    Ok(())
}

#[tauri::command]
pub async fn tts_status(state: State<'_, TtsState>) -> Result<bool, String> {
    let guard = state.engine.lock().await;
    Ok(guard.is_some())
}

#[tauri::command]
pub async fn tts_voices() -> Result<Vec<(String, String)>, String> {
    Ok(VOICES
        .iter()
        .map(|(id, label)| (id.to_string(), label.to_string()))
        .collect())
}
