//! Response mode — controls TTS verbosity based on conversation context.
//!
//! Conversational: short replies (1-3 sentences), direct answers.
//! Detailed: full explanation, still TTS-friendly (short sentences).
//!
//! Mode is selected per-turn based on user intent signals.

/// How verbose the TTS output should be.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum ResponseMode {
    /// Default voice mode: 1-3 sentences, direct answers.
    /// Code/visual blocks get brief spoken cues.
    #[default]
    Conversational,
    /// User asked for explanation: full text spoken,
    /// but still sentence-chunked for TTS streaming.
    Detailed,
}

/// Intent signals that trigger Detailed mode.
const DETAIL_TRIGGERS: &[&str] = &[
    "explain",
    "walk me through",
    "how does",
    "how do",
    "why does",
    "why is",
    "tell me more",
    "go deeper",
    "in detail",
    "step by step",
    "elaborate",
    "break it down",
    "can you describe",
    "what exactly",
    "long explanation",
];

/// Detect response mode from user input text.
/// Returns Detailed if the user's message contains intent signals.
pub fn detect_mode(user_input: &str) -> ResponseMode {
    let lower = user_input.to_lowercase();
    for trigger in DETAIL_TRIGGERS {
        if lower.contains(trigger) {
            return ResponseMode::Detailed;
        }
    }
    ResponseMode::Conversational
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_question_is_conversational() {
        assert_eq!(
            detect_mode("what's the status?"),
            ResponseMode::Conversational
        );
    }

    #[test]
    fn explain_triggers_detailed() {
        assert_eq!(
            detect_mode("explain how the auth middleware works"),
            ResponseMode::Detailed
        );
    }

    #[test]
    fn walk_me_through_triggers_detailed() {
        assert_eq!(
            detect_mode("walk me through the build process"),
            ResponseMode::Detailed
        );
    }

    #[test]
    fn how_does_triggers_detailed() {
        assert_eq!(
            detect_mode("how does the TCP bridge connect?"),
            ResponseMode::Detailed
        );
    }

    #[test]
    fn step_by_step_triggers_detailed() {
        assert_eq!(detect_mode("show me step by step"), ResponseMode::Detailed);
    }

    #[test]
    fn normal_request_is_conversational() {
        assert_eq!(
            detect_mode("fix the login bug"),
            ResponseMode::Conversational
        );
    }

    #[test]
    fn elaborate_triggers_detailed() {
        assert_eq!(
            detect_mode("can you elaborate on that?"),
            ResponseMode::Detailed
        );
    }

    #[test]
    fn default_is_conversational() {
        assert_eq!(ResponseMode::default(), ResponseMode::Conversational);
    }
}
