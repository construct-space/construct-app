//! Biometric + keychain token persistence for Construct's own auth session.
//!
//! Separate from oauth::oauth_read_keychain (which reads Claude Code's
//! credentials). These commands manage the app's session tokens:
//! `cat_*` access + refresh pair stored per-user in the OS keychain
//! (macOS Keychain Services, Windows Credential Manager, Linux Secret Service).
//!
//! `biometric_verify` is a separate, explicit prompt — callers choose when
//! to require it. The keychain entries themselves are not biometric-ACL'd,
//! so disk-level access could extract them; the gate is UX, not a hardware
//! root of trust. Good enough for "don't re-type your password every launch"
//! while staying cross-platform.

use serde::{Deserialize, Serialize};

const KEYRING_SERVICE: &str = "space.construct.personal";

#[derive(Serialize, Deserialize, Clone)]
pub struct StoredTokens {
    pub access_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
}

// macOS path: shell to `security`. The keyring crate's apple-native backend
// reports set_password success but the entry never lands in the user's
// default Keychain when the app is ad-hoc-signed (the usual Tauri dev
// build). `security` CLI uses the same API path as everyday tools (the
// `oauth::oauth_read_keychain` command already does this for Claude Code
// credentials) and actually writes.
//
// Windows + Linux still go through the keyring crate — it's well-behaved
// on Credential Manager / Secret Service.
#[cfg(target_os = "macos")]
mod keychain {
    use super::{StoredTokens, KEYRING_SERVICE};
    use std::process::{Command, Stdio};

    pub fn save(account: &str, json: &str) -> Result<(), String> {
        // -U tells `security` to update in place if the entry already exists
        // — without it, a second write fails with errSecDuplicateItem.
        let status = Command::new("security")
            .args([
                "add-generic-password",
                "-s",
                KEYRING_SERVICE,
                "-a",
                account,
                "-w",
                json,
                "-U",
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| format!("security add-generic-password spawn failed: {e}"))?;
        if !status.status.success() {
            return Err(format!(
                "security add-generic-password exited {}: {}",
                status.status,
                String::from_utf8_lossy(&status.stderr)
            ));
        }
        Ok(())
    }

    pub fn load(account: &str) -> Result<StoredTokens, String> {
        let out = Command::new("security")
            .args([
                "find-generic-password",
                "-s",
                KEYRING_SERVICE,
                "-a",
                account,
                "-w",
            ])
            .output()
            .map_err(|e| format!("security find-generic-password spawn failed: {e}"))?;
        if !out.status.success() {
            return Err("no keychain entry".to_string());
        }
        let mut payload =
            String::from_utf8(out.stdout).map_err(|e| format!("keychain payload not utf8: {e}"))?;
        // `-w` outputs the password followed by a trailing newline.
        if payload.ends_with('\n') {
            payload.pop();
        }
        serde_json::from_str(&payload).map_err(|e| format!("keychain payload invalid: {e}"))
    }

    pub fn clear(account: &str) -> Result<(), String> {
        let out = Command::new("security")
            .args([
                "delete-generic-password",
                "-s",
                KEYRING_SERVICE,
                "-a",
                account,
            ])
            .output()
            .map_err(|e| format!("security delete-generic-password spawn failed: {e}"))?;
        // Missing entry is fine — logout is idempotent.
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            if stderr.contains("could not be found") {
                return Ok(());
            }
            return Err(format!("security delete-generic-password: {stderr}"));
        }
        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
mod keychain {
    use super::{StoredTokens, KEYRING_SERVICE};
    use keyring::Entry;

    fn entry(account: &str) -> Result<Entry, String> {
        Entry::new(KEYRING_SERVICE, account).map_err(|e| format!("keychain open failed: {e}"))
    }

    pub fn save(account: &str, json: &str) -> Result<(), String> {
        entry(account)?
            .set_password(json)
            .map_err(|e| format!("keychain write failed: {e}"))
    }

    pub fn load(account: &str) -> Result<StoredTokens, String> {
        let json = entry(account)?
            .get_password()
            .map_err(|e| format!("keychain read failed: {e}"))?;
        serde_json::from_str(&json).map_err(|e| format!("keychain payload invalid: {e}"))
    }

    pub fn clear(account: &str) -> Result<(), String> {
        match entry(account)?.delete_credential() {
            Ok(_) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("keychain delete failed: {e}")),
        }
    }
}

#[tauri::command]
pub async fn biometric_available() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos::available()
    }
    #[cfg(target_os = "windows")]
    {
        windows_impl::available().await
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

#[tauri::command]
pub async fn biometric_verify(reason: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let reason = reason.clone();
        tokio::task::spawn_blocking(move || macos::verify(&reason))
            .await
            .map_err(|e| format!("biometric task failed: {e}"))?
    }
    #[cfg(target_os = "windows")]
    {
        windows_impl::verify(&reason).await
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = reason;
        Err("Biometric authentication is not available on this platform".into())
    }
}

#[tauri::command]
pub fn construct_auth_save_tokens(
    account: String,
    access_token: String,
    refresh_token: Option<String>,
) -> Result<(), String> {
    let bundle = StoredTokens {
        access_token,
        refresh_token,
    };
    let json = serde_json::to_string(&bundle).map_err(|e| e.to_string())?;
    keychain::save(&account, &json)
}

#[tauri::command]
pub fn construct_auth_load_tokens(account: String) -> Result<StoredTokens, String> {
    keychain::load(&account)
}

#[tauri::command]
pub fn construct_auth_clear_tokens(account: String) -> Result<(), String> {
    keychain::clear(&account)
}

#[cfg(target_os = "macos")]
mod macos {
    use block2::RcBlock;
    use objc2::rc::autoreleasepool;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};
    use std::sync::mpsc::{channel, Sender};
    use std::sync::{Arc, Mutex};

    pub fn available() -> bool {
        autoreleasepool(|_| unsafe {
            let ctx = LAContext::new();
            ctx.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
                .is_ok()
        })
    }

    pub fn verify(reason: &str) -> Result<(), String> {
        autoreleasepool(|_| unsafe {
            let ctx = LAContext::new();
            let policy = LAPolicy::DeviceOwnerAuthenticationWithBiometrics;

            if let Err(err) = ctx.canEvaluatePolicy_error(policy) {
                return Err(format!("biometric policy unavailable: {err}"));
            }

            let ns_reason = NSString::from_str(reason);

            // LAContext.evaluatePolicy calls the reply block on an arbitrary
            // background thread. Bridge to this thread via an mpsc channel.
            // The block is Fn (block2 requires it) but fires exactly once —
            // wrap the Sender in Mutex<Option<_>> so we can .take() it.
            let (tx, rx) = channel::<Result<(), String>>();
            // Arc<Mutex<...>> so the closure captures a cloneable handle —
            // block2::RcBlock requires Fn+Clone, and Mutex is not Clone.
            let slot: Arc<Mutex<Option<Sender<Result<(), String>>>>> =
                Arc::new(Mutex::new(Some(tx)));

            let slot_cb = slot.clone();
            let block = RcBlock::new(move |success: Bool, err: *mut NSError| {
                let outcome = if success.as_bool() {
                    Ok(())
                } else if !err.is_null() {
                    let msg = (*err).localizedDescription();
                    Err(msg.to_string())
                } else {
                    Err("Biometric authentication failed".into())
                };
                if let Some(sender) = slot_cb.lock().ok().and_then(|mut g| g.take()) {
                    let _ = sender.send(outcome);
                }
            });

            ctx.evaluatePolicy_localizedReason_reply(policy, &ns_reason, &block);

            rx.recv()
                .map_err(|e| format!("biometric channel closed: {e}"))?
        })
    }
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use windows::core::HSTRING;
    use windows::Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
    };

    pub async fn available() -> bool {
        // The IAsyncOperation .get() method isn't exposed without an extension
        // trait in windows 0.62 — use the Future impl (via windows-future)
        // instead. Availability returns quickly so the async hop is cheap.
        match UserConsentVerifier::CheckAvailabilityAsync() {
            Ok(op) => match op.await {
                Ok(v) => v == UserConsentVerifierAvailability::Available,
                Err(_) => false,
            },
            Err(_) => false,
        }
    }

    pub async fn verify(reason: &str) -> Result<(), String> {
        let hr = HSTRING::from(reason);
        // IAsyncOperation implements Future via windows-future; .await is fine
        // from a tokio runtime.
        let outcome = UserConsentVerifier::RequestVerificationAsync(&hr)
            .map_err(|e| format!("Windows Hello request failed: {e}"))?
            .await
            .map_err(|e| format!("Windows Hello failed: {e}"))?;
        match outcome {
            UserConsentVerificationResult::Verified => Ok(()),
            UserConsentVerificationResult::DeviceNotPresent => {
                Err("No Windows Hello device available".into())
            }
            UserConsentVerificationResult::NotConfiguredForUser => {
                Err("Windows Hello not set up for this user".into())
            }
            UserConsentVerificationResult::Canceled => Err("Cancelled".into()),
            _ => Err("Biometric verification failed".into()),
        }
    }
}
