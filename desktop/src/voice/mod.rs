//! Voice pipeline — STT, TTS, playback, content filtering, and response mode control.
//!
//! STT: whisper-rs (whisper.cpp) with Metal acceleration
//! TTS: Kokoro-82M via ONNX Runtime + misaki phonemizer
//! Playback: cpal audio output
//! Filter: block-type aware routing (speak text, cue code, skip JSON)

pub mod playback;
pub mod response_mode;
pub mod stt;
pub mod tts;
pub mod tts_filter;
