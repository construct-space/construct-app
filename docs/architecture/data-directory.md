# Data Directory Layout

## Location

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/Construct/` |
| macOS Dev | `~/Library/Application Support/Construct Dev/` |
| Windows | `%APPDATA%\Construct\` |
| Linux | `$XDG_DATA_HOME/construct/` (or `~/.local/share/construct/`) |

Override with `CONSTRUCT_DATA_DIR` env var.

## Structure

```
Construct/
  config/
    auth.json              ← user identity + auth token
    settings.json          ← app preferences (theme, editor, toolbar)
    window-state.json      ← window position/size (Tauri plugin)
  state/
    pinned.json            ← sidebar pinned items
  sessions/                ← operator agent sessions (JSONL, internal)
  chat-sessions/           ← block-based UI sessions (JSON, frontend-facing)
  spaces/                  ← installed marketplace spaces
    code/                  ← space-code manifest + agent + config
    design/
    ai/
    ...
  logs/
    conversations/         ← conversation transcripts
  telemetry.db             ← local analytics (SQLite)
```

## Conventions

- **Config** = user-editable settings (auth, preferences, window state)
- **State** = app-managed state (pins, recent items)
- **Sessions** = operator internal sessions (agent loop transcripts)
- **Chat sessions** = frontend UI sessions (Turn/Block model for resume)
- **Spaces** = installed space packages (manifest + agent config)
- **Logs** = conversation history
- **Telemetry** = local-only analytics (never sent without consent)

## Auth

Single `config/auth.json`:

```json
{
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "User Name",
    "avatar": ""
  },
  "token": "jwt...",
  "oauth_token": "cat_...",
  "authenticated": true,
  "updated_at": "2026-03-21T..."
}
```

No duplicate auth files. No raw tokens in settings.

## Version

Both Construct and Operator share the same version. The operator binary is bundled with the app — no separate copy in the data directory.
