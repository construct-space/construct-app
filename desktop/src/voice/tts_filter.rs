//! TTS content filter — decides what the voice pipeline speaks vs. skips.
//!
//! Maps operator ResponseBlock types to TTS actions:
//! - Speak:  send content to TTS engine
//! - Cue:    replace with a short spoken phrase ("here's some code")
//! - Skip:   don't speak at all
//!
//! Mirrors frontend/assistant/blocks.ts block types.

use super::response_mode::ResponseMode;

/// How a block should be handled by the TTS engine.
#[derive(Debug, Clone, PartialEq)]
pub enum TtsAction {
    /// Speak the full content (may be trimmed by response mode).
    Speak(String),
    /// Replace block with a brief spoken cue.
    Cue(String),
    /// Don't speak anything.
    Skip,
}

/// Block types from the operator stream.
/// Matches frontend/assistant/blocks.ts ResponseBlock union.
#[derive(Debug, Clone, PartialEq)]
pub enum BlockType {
    Text,
    Code,
    Tool,
    Diff,
    Error,
    Status,
    Progress,
    Question,
    Plan,
    TaskList,
    Table,
    Json,
    Svg,
    Image,
    Link,
    Action,
    Custom(String),
    Unknown(String),
}

impl BlockType {
    pub fn from_str(s: &str) -> Self {
        match s {
            "text" => Self::Text,
            "code" => Self::Code,
            "tool" => Self::Tool,
            "diff" => Self::Diff,
            "error" => Self::Error,
            "status" => Self::Status,
            "progress" => Self::Progress,
            "question" => Self::Question,
            "plan" => Self::Plan,
            "tasklist" => Self::TaskList,
            "table" => Self::Table,
            "json" => Self::Json,
            "svg" => Self::Svg,
            "image" => Self::Image,
            "link" => Self::Link,
            "action" => Self::Action,
            s if s.contains(':') => Self::Custom(s.to_string()),
            other => Self::Unknown(other.to_string()),
        }
    }
}

/// A parsed block from the operator stream, ready for TTS classification.
#[derive(Debug, Clone)]
pub struct StreamBlock {
    pub block_type: BlockType,
    pub content: String,
    /// Optional metadata (tool name, language, filename, etc.)
    pub meta: Option<BlockMeta>,
}

#[derive(Debug, Clone)]
pub enum BlockMeta {
    Tool {
        name: String,
        state: String,
    },
    Code {
        language: String,
        filename: Option<String>,
    },
    Status {
        message: String,
    },
    Progress {
        headline: String,
    },
    Question {
        question: String,
    },
    Error {
        message: String,
    },
}

/// TTS content filter. Classifies blocks and produces speakable output.
pub struct TtsFilter {
    mode: ResponseMode,
    /// Tracks consecutive code blocks to avoid repeating "here's some code"
    last_cue: Option<String>,
}

impl TtsFilter {
    pub fn new(mode: ResponseMode) -> Self {
        Self {
            mode,
            last_cue: None,
        }
    }

    pub fn set_mode(&mut self, mode: ResponseMode) {
        self.mode = mode;
    }

    /// Classify a block and return the TTS action.
    pub fn classify(&mut self, block: &StreamBlock) -> TtsAction {
        match &block.block_type {
            // ── Speakable ──
            BlockType::Text => self.filter_text(&block.content),

            BlockType::Error => {
                if let Some(BlockMeta::Error { message }) = &block.meta {
                    TtsAction::Speak(message.clone())
                } else {
                    TtsAction::Speak(block.content.clone())
                }
            }

            BlockType::Question => {
                if let Some(BlockMeta::Question { question }) = &block.meta {
                    TtsAction::Speak(question.clone())
                } else {
                    TtsAction::Speak(block.content.clone())
                }
            }

            BlockType::Status => {
                if let Some(BlockMeta::Status { message }) = &block.meta {
                    TtsAction::Speak(message.clone())
                } else {
                    TtsAction::Skip
                }
            }

            BlockType::Progress => {
                if let Some(BlockMeta::Progress { headline }) = &block.meta {
                    TtsAction::Speak(headline.clone())
                } else {
                    TtsAction::Skip
                }
            }

            // ── Cued (brief spoken replacement) ──
            BlockType::Code => self.emit_cue("Here's some code"),

            BlockType::Tool => {
                let cue = if let Some(BlockMeta::Tool { name, state }) = &block.meta {
                    match state.as_str() {
                        "running" => format!("Running {}", humanize_tool_name(name)),
                        "done" => format!("Done with {}", humanize_tool_name(name)),
                        "error" => format!("{} failed", humanize_tool_name(name)),
                        _ => format!("Using {}", humanize_tool_name(name)),
                    }
                } else {
                    "Running a tool".to_string()
                };
                self.emit_cue(&cue)
            }

            BlockType::Diff => self.emit_cue("Made some changes to the file"),

            BlockType::Plan => self.emit_cue("Here's the plan"),
            BlockType::TaskList => self.emit_cue("Here are the tasks"),
            BlockType::Table => self.emit_cue("There's a table on screen"),

            // ── Silent (skip entirely) ──
            BlockType::Json
            | BlockType::Svg
            | BlockType::Image
            | BlockType::Link
            | BlockType::Action
            | BlockType::Custom(_)
            | BlockType::Unknown(_) => TtsAction::Skip,
        }
    }

    /// Filter text content based on response mode.
    fn filter_text(&mut self, content: &str) -> TtsAction {
        self.last_cue = None;
        let cleaned = strip_markdown_for_speech(content);
        if cleaned.is_empty() {
            return TtsAction::Skip;
        }

        match self.mode {
            ResponseMode::Conversational => {
                // Cap at ~3 sentences for conversational mode.
                // The LLM prompt should already produce short responses,
                // but this is a safety net for the TTS pipeline.
                let trimmed = cap_sentences(&cleaned, 3);
                TtsAction::Speak(trimmed)
            }
            ResponseMode::Detailed => {
                // Speak full text, but still strip markdown artifacts.
                TtsAction::Speak(cleaned)
            }
        }
    }

    /// Emit a cue, suppressing duplicates for consecutive same-type blocks.
    fn emit_cue(&mut self, cue: &str) -> TtsAction {
        if self.last_cue.as_deref() == Some(cue) {
            // Don't repeat "here's some code" for consecutive code blocks.
            return TtsAction::Skip;
        }
        self.last_cue = Some(cue.to_string());
        TtsAction::Cue(cue.to_string())
    }
}

// ── Helpers ──

/// Strip markdown syntax that sounds bad when spoken aloud.
fn strip_markdown_for_speech(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for line in text.lines() {
        let trimmed = line.trim();
        // Skip horizontal rules
        if trimmed.starts_with("---") || trimmed.starts_with("***") || trimmed.starts_with("___") {
            continue;
        }
        // Strip heading markers
        let line = if trimmed.starts_with('#') {
            trimmed.trim_start_matches('#').trim()
        } else {
            trimmed
        };
        // Strip bold/italic markers
        let line = line.replace("**", "").replace("__", "");
        // Strip inline code backticks
        let line = line.replace('`', "");
        // Strip bullet markers
        let line = if line.starts_with("- ") || line.starts_with("* ") {
            &line[2..]
        } else {
            &line
        };
        // Strip numbered list markers (e.g. "1. ")
        let line = strip_numbered_prefix(line);

        if !line.is_empty() {
            if !out.is_empty() {
                out.push(' ');
            }
            out.push_str(line);
        }
    }
    out
}

fn strip_numbered_prefix(s: &str) -> &str {
    let bytes = s.as_bytes();
    let mut i = 0;
    // Skip digits
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    // Must be followed by ". "
    if i > 0 && i + 1 < bytes.len() && bytes[i] == b'.' && bytes[i + 1] == b' ' {
        &s[i + 2..]
    } else {
        s
    }
}

/// Cap text at N sentence boundaries. Preserves complete sentences.
fn cap_sentences(text: &str, max: usize) -> String {
    let mut count = 0;
    let mut end = 0;
    let chars: Vec<char> = text.chars().collect();

    for (i, &ch) in chars.iter().enumerate() {
        if (ch == '.' || ch == '!' || ch == '?')
            && (i + 1 >= chars.len() || chars[i + 1].is_whitespace())
        {
            count += 1;
            end = i + 1;
            if count >= max {
                break;
            }
        }
    }

    if count == 0 {
        // No sentence boundaries found — return full text.
        text.to_string()
    } else {
        text[..end].trim().to_string()
    }
}

/// Convert tool IDs like "file_read" or "web_search" to spoken form.
fn humanize_tool_name(name: &str) -> String {
    name.replace('_', " ")
}

// ── Markdown fence tracker for raw stream parsing ──

/// Tracks whether we're inside a markdown code fence in a token stream.
/// Use this when processing raw `text_delta` chunks before block normalization.
pub struct FenceTracker {
    in_fence: bool,
    buffer: String,
}

impl FenceTracker {
    pub fn new() -> Self {
        Self {
            in_fence: false,
            buffer: String::new(),
        }
    }

    /// Returns true if we're currently inside a code fence.
    pub fn in_code_block(&self) -> bool {
        self.in_fence
    }

    /// Feed a token/chunk and update fence state.
    /// Returns the content that is NOT inside a code fence (speakable text).
    /// Code fence content is consumed silently.
    pub fn feed(&mut self, chunk: &str) -> Option<String> {
        self.buffer.push_str(chunk);
        let mut speakable = String::new();
        let mut remaining = String::new();

        for line in self.buffer.split_inclusive('\n') {
            let trimmed = line.trim();
            if trimmed.starts_with("```") {
                self.in_fence = !self.in_fence;
                // Don't include the fence line itself in output
                continue;
            }

            if self.in_fence {
                // Inside code block — skip for TTS
                continue;
            } else {
                speakable.push_str(line);
            }
        }

        // Keep incomplete last line in buffer if no newline yet
        if !self.buffer.ends_with('\n') && !self.buffer.is_empty() {
            if let Some(last_nl) = self.buffer.rfind('\n') {
                remaining = self.buffer[last_nl + 1..].to_string();
            } else {
                remaining = self.buffer.clone();
                // Can't classify yet — wait for more input
                self.buffer = remaining;
                return None;
            }
        }

        self.buffer = remaining;

        if speakable.is_empty() {
            None
        } else {
            Some(speakable)
        }
    }

    /// Flush any remaining buffered content.
    pub fn flush(&mut self) -> Option<String> {
        if self.buffer.is_empty() || self.in_fence {
            self.buffer.clear();
            return None;
        }
        let out = std::mem::take(&mut self.buffer);
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::super::response_mode::ResponseMode;
    use super::*;

    #[test]
    fn text_block_speaks() {
        let mut filter = TtsFilter::new(ResponseMode::Conversational);
        let block = StreamBlock {
            block_type: BlockType::Text,
            content: "The server is running on port 3000.".to_string(),
            meta: None,
        };
        assert_eq!(
            filter.classify(&block),
            TtsAction::Speak("The server is running on port 3000.".to_string())
        );
    }

    #[test]
    fn code_block_cues() {
        let mut filter = TtsFilter::new(ResponseMode::Conversational);
        let block = StreamBlock {
            block_type: BlockType::Code,
            content: "fn main() {}".to_string(),
            meta: Some(BlockMeta::Code {
                language: "rust".to_string(),
                filename: None,
            }),
        };
        assert_eq!(
            filter.classify(&block),
            TtsAction::Cue("Here's some code".to_string())
        );
    }

    #[test]
    fn consecutive_code_blocks_suppress_duplicate_cues() {
        let mut filter = TtsFilter::new(ResponseMode::Conversational);
        let block = StreamBlock {
            block_type: BlockType::Code,
            content: "fn a() {}".to_string(),
            meta: None,
        };
        assert_eq!(
            filter.classify(&block),
            TtsAction::Cue("Here's some code".to_string())
        );
        // Second consecutive code block → skip
        let block2 = StreamBlock {
            block_type: BlockType::Code,
            content: "fn b() {}".to_string(),
            meta: None,
        };
        assert_eq!(filter.classify(&block2), TtsAction::Skip);
    }

    #[test]
    fn tool_block_cues_with_name() {
        let mut filter = TtsFilter::new(ResponseMode::Conversational);
        let block = StreamBlock {
            block_type: BlockType::Tool,
            content: String::new(),
            meta: Some(BlockMeta::Tool {
                name: "file_read".to_string(),
                state: "running".to_string(),
            }),
        };
        assert_eq!(
            filter.classify(&block),
            TtsAction::Cue("Running file read".to_string())
        );
    }

    #[test]
    fn diff_block_cues() {
        let mut filter = TtsFilter::new(ResponseMode::Conversational);
        let block = StreamBlock {
            block_type: BlockType::Diff,
            content: "+added\n-removed".to_string(),
            meta: None,
        };
        assert_eq!(
            filter.classify(&block),
            TtsAction::Cue("Made some changes to the file".to_string())
        );
    }

    #[test]
    fn json_block_skips() {
        let mut filter = TtsFilter::new(ResponseMode::Conversational);
        let block = StreamBlock {
            block_type: BlockType::Json,
            content: "{}".to_string(),
            meta: None,
        };
        assert_eq!(filter.classify(&block), TtsAction::Skip);
    }

    #[test]
    fn conversational_caps_sentences() {
        let mut filter = TtsFilter::new(ResponseMode::Conversational);
        let block = StreamBlock {
            block_type: BlockType::Text,
            content: "First thing. Second thing. Third thing. Fourth thing. Fifth thing."
                .to_string(),
            meta: None,
        };
        assert_eq!(
            filter.classify(&block),
            TtsAction::Speak("First thing. Second thing. Third thing.".to_string())
        );
    }

    #[test]
    fn detailed_mode_speaks_all() {
        let mut filter = TtsFilter::new(ResponseMode::Detailed);
        let block = StreamBlock {
            block_type: BlockType::Text,
            content: "First. Second. Third. Fourth. Fifth.".to_string(),
            meta: None,
        };
        assert_eq!(
            filter.classify(&block),
            TtsAction::Speak("First. Second. Third. Fourth. Fifth.".to_string())
        );
    }

    #[test]
    fn strips_markdown_for_speech() {
        let input = "## Heading\n\n**Bold** and `code` here.\n\n- Item one\n- Item two";
        let result = strip_markdown_for_speech(input);
        assert_eq!(result, "Heading Bold and code here. Item one Item two");
    }

    #[test]
    fn error_block_speaks_message() {
        let mut filter = TtsFilter::new(ResponseMode::Conversational);
        let block = StreamBlock {
            block_type: BlockType::Error,
            content: String::new(),
            meta: Some(BlockMeta::Error {
                message: "Connection timed out.".to_string(),
            }),
        };
        assert_eq!(
            filter.classify(&block),
            TtsAction::Speak("Connection timed out.".to_string())
        );
    }

    #[test]
    fn question_block_speaks() {
        let mut filter = TtsFilter::new(ResponseMode::Conversational);
        let block = StreamBlock {
            block_type: BlockType::Question,
            content: String::new(),
            meta: Some(BlockMeta::Question {
                question: "Which database should I use?".to_string(),
            }),
        };
        assert_eq!(
            filter.classify(&block),
            TtsAction::Speak("Which database should I use?".to_string())
        );
    }

    #[test]
    fn fence_tracker_filters_code() {
        let mut tracker = FenceTracker::new();
        let r1 = tracker.feed("Hello world.\n");
        assert_eq!(r1, Some("Hello world.\n".to_string()));

        let r2 = tracker.feed("```rust\n");
        assert_eq!(r2, None); // fence line consumed

        let r3 = tracker.feed("fn main() {}\n");
        assert_eq!(r3, None); // inside fence, skipped

        let r4 = tracker.feed("```\n");
        assert_eq!(r4, None); // closing fence consumed

        let r5 = tracker.feed("Back to text.\n");
        assert_eq!(r5, Some("Back to text.\n".to_string()));
    }

    #[test]
    fn fence_tracker_state() {
        let mut tracker = FenceTracker::new();
        assert!(!tracker.in_code_block());
        tracker.feed("```\n");
        assert!(tracker.in_code_block());
        tracker.feed("```\n");
        assert!(!tracker.in_code_block());
    }
}
