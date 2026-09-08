//! Local alarm scheduler — fires scheduled notifications natively, on time,
//! even when the main window is closed-to-tray and offline.
//!
//! The server scheduler (api/source) stays the source of truth: it persists
//! tasks, syncs across devices, and advances `next_run_at` (the online
//! device-bus runner claims + reports). But a server-driven ring needs the
//! network and a live webview — and macOS App Nap throttles a hidden webview's
//! timers (the same reason notifications.rs lives in Rust). So this module is
//! the resilient *local* ring: the frontend syncs the user's enabled
//! notify-class tasks here, and a background thread computes due times locally
//! and shows an OS notification + sound. It never talks to the network.
//!
//! Scope: rings while the process is alive (window open OR closed-to-tray) and
//! offline. It does NOT cover a full quit (no process) — that needs OS-level
//! scheduling (launchd / Task Scheduler), a separate effort. Heavy App Nap can
//! still delay a tick; the grace window absorbs short lag.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use chrono::{Datelike, Local, NaiveTime, TimeZone, Timelike};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_notification::NotificationExt;

/// How often the local timer wakes to check for due alarms.
const TICK: Duration = Duration::from_secs(30);
/// Only ring if we're within this window of the scheduled instant — a brief
/// sleep/lag still rings; a long absence doesn't ring a stale alarm.
const GRACE_SECS: i64 = 120;
const STATE_FILE: &str = "local-alarms.json";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlarmSchedule {
    pub kind: String, // interval | daily | weekly | once
    #[serde(default)]
    pub every_minutes: Option<i64>,
    #[serde(default)]
    pub time: Option<String>, // "HH:MM" for daily / weekly
    #[serde(default)]
    pub weekdays: Option<Vec<u32>>, // 0=Sun .. 6=Sat for weekly
    #[serde(default)]
    pub at: Option<String>, // ISO8601 for once
    #[serde(default)]
    pub timezone: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlarmNotify {
    pub title: String,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub sound: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAlarm {
    pub task_id: String,
    pub schedule: AlarmSchedule,
    pub notify: AlarmNotify,
}

#[derive(Default, Serialize, Deserialize)]
struct PersistState {
    #[serde(default)]
    alarms: Vec<LocalAlarm>,
    /// task_id -> last fired occurrence key, so a restart (or a second tick
    /// within the grace window) doesn't re-ring the same occurrence.
    #[serde(default)]
    fired: HashMap<String, String>,
}

pub struct LocalAlarmState {
    inner: Mutex<PersistState>,
}

impl LocalAlarmState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(load_state().unwrap_or_default()),
        }
    }
}

impl Default for LocalAlarmState {
    fn default() -> Self {
        Self::new()
    }
}

fn state_path() -> Result<PathBuf, String> {
    let dir = crate::config::get_profile_data_dir()?;
    Ok(PathBuf::from(dir).join(STATE_FILE))
}

fn load_state() -> Option<PersistState> {
    let raw = fs::read_to_string(state_path().ok()?).ok()?;
    serde_json::from_str(&raw).ok()
}

fn save_state(state: &PersistState) {
    if let Ok(path) = state_path() {
        if let Ok(json) = serde_json::to_string_pretty(state) {
            let _ = fs::write(path, json);
        }
    }
}

fn parse_hhmm(s: &str) -> Option<NaiveTime> {
    let mut it = s.split(':');
    let h: u32 = it.next()?.parse().ok()?;
    let m: u32 = it.next()?.parse().ok()?;
    NaiveTime::from_hms_opt(h, m, 0)
}

/// Today's occurrence at `t` (system local tz); returns its instant (unix
/// seconds) if `now` is within the grace window after it and the weekday matches.
fn daily_weekly_instant(
    now: chrono::DateTime<Local>,
    t: NaiveTime,
    weekday_ok: impl Fn(u32) -> bool,
) -> Option<i64> {
    if !weekday_ok(now.weekday().num_days_from_sunday()) {
        return None;
    }
    let today = now.date_naive();
    let occ = Local.from_local_datetime(&today.and_time(t)).single()?;
    let delta = now.signed_duration_since(occ).num_seconds();
    if (0..GRACE_SECS).contains(&delta) {
        Some(occ.timestamp())
    } else {
        None
    }
}

/// Returns the scheduled instant (unix seconds) if `sched` is due now (system
/// local tz), else None.
fn due_instant(sched: &AlarmSchedule, now: chrono::DateTime<Local>) -> Option<i64> {
    match sched.kind.as_str() {
        "daily" => daily_weekly_instant(now, parse_hhmm(sched.time.as_deref()?)?, |_| true),
        "weekly" => {
            let weekdays = sched.weekdays.clone().unwrap_or_default();
            daily_weekly_instant(now, parse_hhmm(sched.time.as_deref()?)?, |wd| {
                weekdays.contains(&wd)
            })
        }
        "once" => {
            let at = chrono::DateTime::parse_from_rfc3339(sched.at.as_deref()?).ok()?;
            let delta = now
                .signed_duration_since(at.with_timezone(&Local))
                .num_seconds();
            if (0..GRACE_SECS).contains(&delta) {
                Some(at.timestamp())
            } else {
                None
            }
        }
        "interval" => {
            let every = sched.every_minutes?;
            if every <= 0 {
                return None;
            }
            let epoch_min = now.timestamp() / 60;
            if epoch_min % every == 0 && now.second() < 30 {
                Some(epoch_min * 60)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Per-occurrence dedup key. Minute-granular so this native tick and the online
/// JS bus -> selfNotify handler (which only knows `scheduled_for`, not the
/// schedule kind) compute the same key and only one of them rings a task. Keyed
/// per task_id, so a one-shot timer (single occurrence ever) never collides.
fn fire_key(due_unix: i64) -> String {
    (due_unix / 60).to_string()
}

fn fire<R: Runtime>(app: &AppHandle<R>, notify: &AlarmNotify) {
    let mut builder = app.notification().builder().title(notify.title.clone());
    if let Some(body) = &notify.body {
        builder = builder.body(body.clone());
    }
    if notify.sound.unwrap_or(false) {
        builder = builder.sound("default");
    }
    if let Err(e) = builder.show() {
        log::warn!("[local_alarms] notification show failed: {}", e);
    }
}

fn tick<R: Runtime>(app: &AppHandle<R>) {
    let Some(state) = app.try_state::<std::sync::Arc<LocalAlarmState>>() else {
        return;
    };
    let now = Local::now();

    // Collect what to fire under the lock; show notifications after releasing it.
    let mut to_fire: Vec<AlarmNotify> = Vec::new();
    {
        let Ok(mut s) = state.inner.lock() else {
            return;
        };
        let alarms = s.alarms.clone();
        let mut changed = false;
        for alarm in &alarms {
            let Some(due) = due_instant(&alarm.schedule, now) else {
                continue;
            };
            let key = fire_key(due);
            if s.fired.get(&alarm.task_id) == Some(&key) {
                continue; // already rang this occurrence (here or via the JS bus)
            }
            s.fired.insert(alarm.task_id.clone(), key);
            changed = true;
            to_fire.push(alarm.notify.clone());
        }
        if changed {
            save_state(&s);
        }
    }

    for notify in &to_fire {
        fire(app, notify);
    }
}

/// Spawn the background timer. Idempotent per app handle (call once at setup).
pub fn start<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(TICK);
        tick(&app);
    });
}

/// Atomically claim a single task occurrence so only ONE path rings it: this
/// native tick (offline / closed-to-tray) or the online JS bus -> selfNotify
/// handler (in-app, app-wide). Both call this with the same minute-granular
/// `fire_key`; the first caller gets `true` and rings, the loser gets `false`.
/// `fire_key` is `floor(scheduledForUnixSeconds / 60)` as a string.
#[tauri::command]
pub fn local_alarms_try_fire(
    state: tauri::State<'_, std::sync::Arc<LocalAlarmState>>,
    task_id: String,
    fire_key: String,
) -> Result<bool, String> {
    let mut s = state.inner.lock().map_err(|e| e.to_string())?;
    if s.fired.get(&task_id) == Some(&fire_key) {
        return Ok(false); // already rang this occurrence
    }
    s.fired.insert(task_id, fire_key);
    save_state(&s);
    Ok(true)
}

/// Replace the synced alarm set. The frontend calls this on launch, on a short
/// interval, and on focus with the user's enabled notify-class scheduled tasks.
#[tauri::command]
pub fn local_alarms_sync(
    state: tauri::State<'_, std::sync::Arc<LocalAlarmState>>,
    alarms: Vec<LocalAlarm>,
) -> Result<(), String> {
    let snapshot = {
        let mut s = state.inner.lock().map_err(|e| e.to_string())?;
        s.alarms = alarms;
        // Drop fired-keys for alarms that no longer exist so the map can't grow
        // unbounded across edits/deletes.
        let ids: std::collections::HashSet<String> =
            s.alarms.iter().map(|a| a.task_id.clone()).collect();
        s.fired.retain(|task_id, _| ids.contains(task_id));
        save_state(&s);
        s.alarms.clone()
    };
    // Reconcile OS-level jobs (launchd) outside the lock — they ring even when
    // the app is fully quit. No-ops on non-macOS for now.
    reconcile_os_agents(&snapshot);
    Ok(())
}

/// Keep OS-level scheduled jobs in sync with the alarm set, so daily/weekly
/// alarms ring even when Construct is fully quit (no process). macOS uses a
/// launchd LaunchAgent per alarm; other platforms are a no-op for now (Windows
/// Task Scheduler is a follow-up). One-shot ("once") and "interval" alarms
/// aren't covered at the OS level — they ring via the in-app path when running.
fn reconcile_os_agents(alarms: &[LocalAlarm]) {
    #[cfg(target_os = "macos")]
    macos_launchd::reconcile(alarms);
    #[cfg(not(target_os = "macos"))]
    let _ = alarms;
}

#[cfg(target_os = "macos")]
mod macos_launchd {
    //! One launchd LaunchAgent per daily/weekly alarm. At the scheduled
    //! calendar time launchd runs `osascript` to post a notification with a
    //! sound — works with the app fully quit. Caveats: the banner is
    //! attributed to the script runner (not Construct) and can't open it; if
    //! the Mac is asleep the job fires on wake, not during sleep; and macOS may
    //! prompt once for notification permission, which can't be answered
    //! headlessly. Agents are reconciled on every sync and removed when an
    //! alarm is disabled/deleted.
    use super::{AlarmSchedule, LocalAlarm};
    use std::collections::HashMap;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    const LABEL_PREFIX: &str = "space.construct.alarm.";
    const SOUND: &str = "Glass";

    fn agents_dir() -> Option<PathBuf> {
        Some(PathBuf::from(std::env::var("HOME").ok()?).join("Library/LaunchAgents"))
    }

    fn safe_id(id: &str) -> String {
        id.chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
            .collect()
    }

    fn applescript_escape(s: &str) -> String {
        s.replace('\\', "\\\\").replace('"', "\\\"")
    }

    fn xml_escape(s: &str) -> String {
        s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
    }

    fn hhmm(time: &Option<String>) -> Option<(u32, u32)> {
        let t = time.as_deref()?;
        let mut it = t.split(':');
        let h: u32 = it.next()?.parse().ok()?;
        let m: u32 = it.next()?.parse().ok()?;
        Some((h, m))
    }

    fn calendar_interval_xml(sched: &AlarmSchedule) -> Option<String> {
        match sched.kind.as_str() {
            "daily" => {
                let (h, m) = hhmm(&sched.time)?;
                Some(format!(
                    "<dict><key>Hour</key><integer>{h}</integer><key>Minute</key><integer>{m}</integer></dict>"
                ))
            }
            "weekly" => {
                let (h, m) = hhmm(&sched.time)?;
                let weekdays = sched.weekdays.clone().unwrap_or_default();
                if weekdays.is_empty() {
                    return None;
                }
                // launchd Weekday: 0=Sun..6=Sat (7 also Sun) — matches our codes.
                let mut arr = String::from("<array>");
                for wd in weekdays {
                    arr.push_str(&format!(
                        "<dict><key>Weekday</key><integer>{wd}</integer><key>Hour</key><integer>{h}</integer><key>Minute</key><integer>{m}</integer></dict>"
                    ));
                }
                arr.push_str("</array>");
                Some(arr)
            }
            _ => None, // once / interval: in-app path only
        }
    }

    fn plist_for(alarm: &LocalAlarm) -> Option<(String, String)> {
        let interval = calendar_interval_xml(&alarm.schedule)?;
        let label = format!("{LABEL_PREFIX}{}", safe_id(&alarm.task_id));
        let title = applescript_escape(&alarm.notify.title);
        let body = applescript_escape(alarm.notify.body.as_deref().unwrap_or(""));
        let sound = if alarm.notify.sound.unwrap_or(false) {
            format!(" sound name \"{SOUND}\"")
        } else {
            String::new()
        };
        let script =
            format!("display notification \"{body}\" with title \"{title}\"{sound}");
        let script_xml = xml_escape(&script);
        let plist = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/osascript</string>
    <string>-e</string>
    <string>{script_xml}</string>
  </array>
  <key>StartCalendarInterval</key>
  {interval}
  <key>RunAtLoad</key><false/>
</dict>
</plist>
"#
        );
        Some((label, plist))
    }

    fn unload(path: &Path) {
        let _ = Command::new("launchctl").arg("unload").arg(path).output();
    }

    fn load(path: &Path) {
        let _ = Command::new("launchctl").arg("load").arg("-w").arg(path).output();
    }

    pub fn reconcile(alarms: &[LocalAlarm]) {
        let Some(dir) = agents_dir() else {
            return;
        };
        if fs::create_dir_all(&dir).is_err() {
            return;
        }

        // Desired agents (daily/weekly notify alarms), keyed by label.
        let mut desired: HashMap<String, String> = HashMap::new();
        for alarm in alarms {
            if alarm.notify.title.is_empty() {
                continue;
            }
            if let Some((label, plist)) = plist_for(alarm) {
                desired.insert(label, plist);
            }
        }

        // Remove our agents that are no longer desired.
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.starts_with(LABEL_PREFIX) || !name.ends_with(".plist") {
                    continue;
                }
                let label = name.trim_end_matches(".plist").to_string();
                if !desired.contains_key(&label) {
                    let path = entry.path();
                    unload(&path);
                    let _ = fs::remove_file(&path);
                }
            }
        }

        // Write + (re)load desired agents — only when the plist content changed,
        // so a 60s sync doesn't churn launchctl.
        for (label, plist) in &desired {
            let path = dir.join(format!("{label}.plist"));
            let unchanged = fs::read_to_string(&path).map(|c| &c == plist).unwrap_or(false);
            if unchanged {
                continue;
            }
            if fs::write(&path, plist).is_ok() {
                unload(&path);
                load(&path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local_at(h: u32, m: u32) -> chrono::DateTime<Local> {
        let today = Local::now().date_naive();
        Local
            .from_local_datetime(&today.and_time(NaiveTime::from_hms_opt(h, m, 0).unwrap()))
            .single()
            .unwrap()
    }

    #[test]
    fn daily_due_within_grace_only() {
        let sched = AlarmSchedule {
            kind: "daily".into(),
            every_minutes: None,
            time: Some("09:00".into()),
            weekdays: None,
            at: None,
            timezone: None,
        };
        // Exactly at 09:00 → due.
        assert!(due_instant(&sched, local_at(9, 0)).is_some());
        // 09:01 (within 120s grace) → due.
        assert!(due_instant(&sched, local_at(9, 1)).is_some());
        // 09:05 (past grace) → not due.
        assert!(due_instant(&sched, local_at(9, 5)).is_none());
        // 08:59 (before) → not due.
        assert!(due_instant(&sched, local_at(8, 59)).is_none());
    }

    #[test]
    fn weekly_matches_weekday() {
        let today_wd = Local::now().weekday().num_days_from_sunday();
        let other_wd = (today_wd + 1) % 7;
        let base = AlarmSchedule {
            kind: "weekly".into(),
            every_minutes: None,
            time: Some("09:00".into()),
            weekdays: Some(vec![today_wd]),
            at: None,
            timezone: None,
        };
        assert!(due_instant(&base, local_at(9, 0)).is_some());
        let off = AlarmSchedule {
            weekdays: Some(vec![other_wd]),
            ..base.clone()
        };
        assert!(due_instant(&off, local_at(9, 0)).is_none());
    }

    #[test]
    fn occurrence_key_is_stable_per_minute() {
        let sched = AlarmSchedule {
            kind: "daily".into(),
            every_minutes: None,
            time: Some("09:00".into()),
            weekdays: None,
            at: None,
            timezone: None,
        };
        let a = due_instant(&sched, local_at(9, 0));
        let b = due_instant(&sched, local_at(9, 1));
        assert!(a.is_some() && a == b, "same occurrence key across the grace window");
    }
}
