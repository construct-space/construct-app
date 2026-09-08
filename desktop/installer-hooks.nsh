; NSIS installer hooks for Construct (Tauri 2 `bundle.windows.nsis.installerHooks`).
;
; Problem this fixes:
;   In-place updates failed with "Error opening file for writing:
;   C:\Program Files\Construct\construct-brain.exe". Tauri's NSIS template
;   closes the main app (construct.exe), but the `construct-brain` sidecar is a
;   separate process that keeps running and holds a lock on construct-brain.exe,
;   so the installer can't overwrite it.
;
; Fix: before any files are written, force-kill the app and the sidecar (and any
;   children) so every Construct .exe is unlocked. taskkill is silent if the
;   process isn't running, so this is safe on a first-time install too.

!macro NSIS_HOOK_PREINSTALL
  ; Kill the main app first (/T also takes its child sidecar), then the sidecar
  ; explicitly in case it was orphaned (parent crashed / detached).
  nsExec::Exec 'taskkill /F /T /IM construct.exe'
  nsExec::Exec 'taskkill /F /IM construct-brain.exe'
  ; Give Windows a moment to release the file handles before extraction.
  Sleep 700
!macroend
