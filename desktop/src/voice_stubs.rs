//! Stub commands when the `voice` feature is disabled.
//! These no-op implementations keep the invoke_handler list unchanged.

pub mod stt {
    use serde::Serialize;

    #[derive(Default)]
    pub struct SttState;
    impl SttState {
        pub fn new() -> Self {
            Self
        }
    }

    #[derive(Serialize)]
    pub struct SttStatus {
        pub ready: bool,
        pub model: String,
    }

    #[tauri::command]
    pub fn stt_init() -> Result<String, String> {
        Err("Voice feature not enabled".into())
    }
    #[tauri::command]
    pub fn stt_transcribe() -> Result<String, String> {
        Err("Voice feature not enabled".into())
    }
    #[tauri::command]
    pub fn stt_transcribe_segments() -> Result<String, String> {
        Err("Voice feature not enabled".into())
    }
    #[tauri::command]
    pub fn stt_status() -> SttStatus {
        SttStatus {
            ready: false,
            model: String::new(),
        }
    }
}

pub mod tts {
    use serde::Serialize;

    #[derive(Default)]
    pub struct TtsState;
    impl TtsState {
        pub fn new() -> Self {
            Self
        }
    }

    #[derive(Serialize, Clone)]
    pub struct VoiceInfo {
        pub id: String,
        pub name: String,
    }

    #[derive(Serialize)]
    pub struct TtsStatus {
        pub ready: bool,
    }

    #[tauri::command]
    pub fn tts_init() -> Result<String, String> {
        Err("Voice feature not enabled".into())
    }
    #[tauri::command]
    pub fn tts_synthesize() -> Result<Vec<u8>, String> {
        Err("Voice feature not enabled".into())
    }
    #[tauri::command]
    pub fn tts_set_voice() -> Result<(), String> {
        Err("Voice feature not enabled".into())
    }
    #[tauri::command]
    pub fn tts_set_speed() -> Result<(), String> {
        Err("Voice feature not enabled".into())
    }
    #[tauri::command]
    pub fn tts_status() -> TtsStatus {
        TtsStatus { ready: false }
    }
    #[tauri::command]
    pub fn tts_voices() -> Vec<VoiceInfo> {
        vec![]
    }
}

pub mod playback {
    #[derive(Default)]
    pub struct PlaybackState;
    impl PlaybackState {
        pub fn new() -> Self {
            Self
        }
    }

    #[tauri::command]
    pub fn playback_init() -> Result<(), String> {
        Err("Voice feature not enabled".into())
    }
    #[tauri::command]
    pub fn playback_queue() -> Result<(), String> {
        Err("Voice feature not enabled".into())
    }
    #[tauri::command]
    pub fn playback_stop() -> Result<(), String> {
        Err("Voice feature not enabled".into())
    }
    #[tauri::command]
    pub fn playback_is_playing() -> bool {
        false
    }
}
