//! Resolve `.space` bundles to a readable runtime directory.
//!
//! Published spaces are installed as single `.space` files (ZIP containers).
//! The renderer still reads manifest/app/style/resources through Tauri FS, so
//! this module extracts bundles into a profile-local cache and returns that
//! directory. Legacy/dev unpacked `.space` directories are accepted unchanged.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Cursor, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const CACHE_DIR: &str = "space-cache";
// Native space tools must run as real files (you can't exec from inside a ZIP),
// so we materialize ONLY the `tools/` and `lib/` trees here — never the whole
// bundle. The renderer reads everything else from the ZIP in memory.
const TOOLS_CACHE_DIR: &str = "space-tools-cache";
const MARKER_FILE: &str = ".source";

fn validate_space_id(space_id: &str) -> Result<(), String> {
    if space_id.is_empty() {
        return Err("space_id required".into());
    }
    if space_id.contains('/') || space_id.contains('\\') || space_id.contains("..") {
        return Err(format!("invalid space_id: {}", space_id));
    }
    Ok(())
}

fn installed_bundle_path(space_id: &str) -> Result<PathBuf, String> {
    validate_space_id(space_id)?;
    let profile_dir = crate::config::get_profile_data_dir()?;
    Ok(PathBuf::from(profile_dir)
        .join("spaces")
        .join(format!("{}.space", space_id)))
}

fn cache_dir_for(space_id: &str) -> Result<PathBuf, String> {
    validate_space_id(space_id)?;
    let profile_dir = crate::config::get_profile_data_dir()?;
    Ok(PathBuf::from(profile_dir)
        .join(CACHE_DIR)
        .join(format!("{}.space", space_id)))
}

fn source_marker(source: &Path) -> Result<String, String> {
    let meta =
        fs::metadata(source).map_err(|e| format!("stat failed: {}: {}", source.display(), e))?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    Ok(format!(
        "{}\n{}\n{}\n",
        source.display(),
        meta.len(),
        modified
    ))
}

fn is_cache_current(source: &Path, cache_dir: &Path) -> bool {
    let marker = match source_marker(source) {
        Ok(marker) => marker,
        Err(_) => return false,
    };
    let marker_path = cache_dir.join(MARKER_FILE);
    let manifest_path = cache_dir.join("manifest.json");
    manifest_path.is_file()
        && fs::read_to_string(marker_path)
            .map(|current| current == marker)
            .unwrap_or(false)
}

fn ensure_safe_zip_path(path: &Path) -> Result<(), String> {
    if path.is_absolute() {
        return Err(format!("absolute zip path rejected: {}", path.display()));
    }
    for component in path.components() {
        match component {
            Component::Normal(_) => {}
            Component::CurDir => {}
            _ => return Err(format!("unsafe zip path rejected: {}", path.display())),
        }
    }
    Ok(())
}

fn unpack_zip(source: &Path, cache_dir: &Path) -> Result<(), String> {
    let file =
        File::open(source).map_err(|e| format!("open failed: {}: {}", source.display(), e))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("invalid .space zip {}: {}", source.display(), e))?;

    fs::remove_dir_all(cache_dir).ok();
    fs::create_dir_all(cache_dir)
        .map_err(|e| format!("create cache failed: {}: {}", cache_dir.display(), e))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("zip entry {} failed: {}", i, e))?;
        let Some(enclosed) = entry.enclosed_name().map(PathBuf::from) else {
            return Err(format!("unsafe zip path rejected: {}", entry.name()));
        };
        ensure_safe_zip_path(&enclosed)?;

        let out_path = cache_dir.join(&enclosed);
        if entry.is_dir() {
            fs::create_dir_all(&out_path)
                .map_err(|e| format!("create dir failed: {}: {}", out_path.display(), e))?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("create dir failed: {}: {}", parent.display(), e))?;
        }
        let mut out_file = File::create(&out_path)
            .map_err(|e| format!("create file failed: {}: {}", out_path.display(), e))?;
        io::copy(&mut entry, &mut out_file)
            .map_err(|e| format!("extract failed: {}: {}", out_path.display(), e))?;

        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&out_path, fs::Permissions::from_mode(mode))
                .map_err(|e| format!("chmod failed: {}: {}", out_path.display(), e))?;
        }
    }

    let marker = source_marker(source)?;
    fs::write(cache_dir.join(MARKER_FILE), marker)
        .map_err(|e| format!("write cache marker failed: {}", e))?;

    Ok(())
}

fn zip_entry_name(base_dir: &Path, path: &Path) -> Result<String, String> {
    let rel = path
        .strip_prefix(base_dir)
        .map_err(|e| format!("strip prefix failed: {}", e))?;
    ensure_safe_zip_path(rel)?;
    let name = rel
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    if name.is_empty() {
        return Err("empty zip entry rejected".into());
    }
    Ok(name)
}

fn file_options(meta: &fs::Metadata) -> SimpleFileOptions {
    let mut options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        options = options.unix_permissions(meta.permissions().mode());
    }
    options
}

fn write_zip_dir(
    writer: &mut ZipWriter<File>,
    base_dir: &Path,
    current_dir: &Path,
) -> Result<(), String> {
    let mut entries = fs::read_dir(current_dir)
        .map_err(|e| format!("read dir failed: {}: {}", current_dir.display(), e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("read dir entry failed: {}", e))?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let path = entry.path();
        let meta = fs::symlink_metadata(&path)
            .map_err(|e| format!("stat failed: {}: {}", path.display(), e))?;
        let file_type = meta.file_type();
        if file_type.is_symlink() {
            return Err(format!(
                "symlink rejected in space bundle: {}",
                path.display()
            ));
        }

        if file_type.is_dir() {
            let mut name = zip_entry_name(base_dir, &path)?;
            name.push('/');
            writer
                .add_directory(name, file_options(&meta))
                .map_err(|e| format!("zip add directory failed: {}", e))?;
            write_zip_dir(writer, base_dir, &path)?;
            continue;
        }

        if !file_type.is_file() {
            return Err(format!("unsupported bundle entry: {}", path.display()));
        }

        let name = zip_entry_name(base_dir, &path)?;
        writer
            .start_file(name, file_options(&meta))
            .map_err(|e| format!("zip start file failed: {}", e))?;

        let mut input =
            File::open(&path).map_err(|e| format!("open failed: {}: {}", path.display(), e))?;
        let mut buf = [0_u8; 64 * 1024];
        loop {
            let n = input
                .read(&mut buf)
                .map_err(|e| format!("read failed: {}: {}", path.display(), e))?;
            if n == 0 {
                break;
            }
            writer
                .write_all(&buf[..n])
                .map_err(|e| format!("zip write failed: {}", e))?;
        }
    }

    Ok(())
}

fn pack_dir_to_installed_space(space_id: &str, source_dir: &Path) -> Result<PathBuf, String> {
    validate_space_id(space_id)?;
    if !source_dir.is_dir() {
        return Err(format!(
            "source is not a directory: {}",
            source_dir.display()
        ));
    }
    let manifest_path = source_dir.join("manifest.json");
    if !manifest_path.is_file() {
        return Err(format!(
            "space bundle source missing manifest.json: {}",
            source_dir.display()
        ));
    }

    let dest = installed_bundle_path(space_id)?;
    let parent = dest
        .parent()
        .ok_or_else(|| format!("invalid destination: {}", dest.display()))?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("create spaces dir failed: {}: {}", parent.display(), e))?;

    let temp = parent.join(format!(".{}.space-pack", space_id));
    if temp.exists() {
        fs::remove_file(&temp)
            .or_else(|_| fs::remove_dir_all(&temp))
            .map_err(|e| format!("remove temp bundle failed: {}: {}", temp.display(), e))?;
    }

    let file = File::create(&temp)
        .map_err(|e| format!("create bundle failed: {}: {}", temp.display(), e))?;
    let mut writer = ZipWriter::new(file);
    write_zip_dir(&mut writer, source_dir, source_dir)?;
    writer
        .finish()
        .map_err(|e| format!("finish zip failed: {}", e))?;

    if dest.is_dir() {
        fs::remove_dir_all(&dest)
            .map_err(|e| format!("remove old space dir failed: {}: {}", dest.display(), e))?;
    } else if dest.exists() {
        fs::remove_file(&dest)
            .map_err(|e| format!("remove old space file failed: {}: {}", dest.display(), e))?;
    }
    fs::rename(&temp, &dest)
        .map_err(|e| format!("install bundle failed: {}: {}", dest.display(), e))?;

    if let Ok(cache_dir) = cache_dir_for(space_id) {
        fs::remove_dir_all(cache_dir).ok();
    }

    Ok(dest)
}

// ─── In-memory ZIP reading (space:// + zip IPC commands) ────────────────────
//
// Published `.space` bundles are ZIPs. The renderer can't read inside a ZIP
// through plugin-fs, so instead of extracting to disk we read entries straight
// out of the archive here: text/metadata over IPC (`space_zip_*` commands) and
// binary assets over the `space://localhost/<id>/<entry>` URI scheme. The raw
// file bytes are cached per (path, mtime) so repeated asset requests during a
// single space load don't re-read the file; the ZIP central directory is cheap
// to re-parse from the cached bytes on each call.

fn archive_cache() -> &'static Mutex<HashMap<PathBuf, (SystemTime, Arc<Vec<u8>>)>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, (SystemTime, Arc<Vec<u8>>)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn load_archive_bytes(zip_path: &Path) -> Result<Arc<Vec<u8>>, String> {
    let meta =
        fs::metadata(zip_path).map_err(|e| format!("stat failed: {}: {}", zip_path.display(), e))?;
    let mtime = meta.modified().unwrap_or(UNIX_EPOCH);

    if let Ok(cache) = archive_cache().lock() {
        if let Some((cached_mtime, bytes)) = cache.get(zip_path) {
            if *cached_mtime == mtime {
                return Ok(bytes.clone());
            }
        }
    }

    let bytes = fs::read(zip_path).map_err(|e| format!("read failed: {}: {}", zip_path.display(), e))?;
    let arc = Arc::new(bytes);
    if let Ok(mut cache) = archive_cache().lock() {
        // Bound memory — bundles are small, but don't grow unbounded across
        // many spaces / re-installs.
        if cache.len() >= 32 {
            cache.clear();
        }
        cache.insert(zip_path.to_path_buf(), (mtime, arc.clone()));
    }
    Ok(arc)
}

/// Normalize a requested entry path: strip leading slash, normalize separators,
/// and reject traversal (`..`, absolute paths).
fn normalize_entry(entry: &str) -> Result<String, String> {
    let trimmed = entry.trim_start_matches('/');
    let as_path = PathBuf::from(trimmed);
    ensure_safe_zip_path(&as_path)?;
    Ok(trimmed.replace('\\', "/"))
}

fn open_archive(space_id: &str) -> Result<(PathBuf, Arc<Vec<u8>>), String> {
    validate_space_id(space_id)?;
    let zip_path = installed_bundle_path(space_id)?;
    if !zip_path.is_file() {
        return Err(format!(
            "space '{}' is not installed at {}",
            space_id,
            zip_path.display()
        ));
    }
    let bytes = load_archive_bytes(&zip_path)?;
    Ok((zip_path, bytes))
}

fn read_zip_entry_bytes(space_id: &str, entry: &str) -> Result<Vec<u8>, String> {
    let name = normalize_entry(entry)?;
    let (_, bytes) = open_archive(space_id)?;
    let slice: &[u8] = &bytes;
    let mut archive = ZipArchive::new(Cursor::new(slice))
        .map_err(|e| format!("invalid .space zip for '{}': {}", space_id, e))?;
    // Resolve the stored name once (some packers prefix entries with "./").
    // Done before taking the entry handle to avoid a double mutable borrow.
    let actual = if archive.by_name(&name).is_ok() {
        name.clone()
    } else {
        format!("./{}", name)
    };
    let mut file = archive
        .by_name(&actual)
        .map_err(|_| format!("entry not found: {}", name))?;
    let mut buf = Vec::with_capacity(file.size() as usize);
    file.read_to_end(&mut buf)
        .map_err(|e| format!("read entry failed: {}: {}", name, e))?;
    Ok(buf)
}

fn list_zip_entries(space_id: &str) -> Result<Vec<String>, String> {
    let (_, bytes) = open_archive(space_id)?;
    let slice: &[u8] = &bytes;
    let mut archive = ZipArchive::new(Cursor::new(slice))
        .map_err(|e| format!("invalid .space zip for '{}': {}", space_id, e))?;
    let mut names = Vec::with_capacity(archive.len());
    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| format!("zip entry {} failed: {}", i, e))?;
        if entry.is_dir() {
            continue;
        }
        if let Some(name) = entry.enclosed_name() {
            names.push(name.to_string_lossy().replace('\\', "/"));
        }
    }
    Ok(names)
}

/// MIME type for a bundle entry, by extension. Small static map — no extra
/// crate, deterministic, covers what space bundles actually ship.
fn mime_for(entry: &str) -> &'static str {
    let ext = entry.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "js" | "mjs" | "cjs" => "text/javascript",
        "css" => "text/css",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "html" | "htm" => "text/html",
        "txt" | "md" => "text/plain",
        _ => "application/octet-stream",
    }
}

/// Parse a `space://localhost/<spaceId>/<entry...>` path into (spaceId, entry).
/// Returns None for malformed locators.
fn parse_space_locator(path: &str) -> Option<(String, String)> {
    let decoded = urlencoding::decode(path).ok()?.into_owned();
    let trimmed = decoded.trim_start_matches('/');
    let mut parts = trimmed.splitn(2, '/');
    let space_id = parts.next()?.to_string();
    let entry = parts.next().unwrap_or("").to_string();
    if space_id.is_empty() || entry.is_empty() {
        return None;
    }
    Some((space_id, entry))
}

fn space_not_found() -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(tauri::http::StatusCode::NOT_FOUND)
        .body(Vec::new())
        .expect("static 404 response is always valid")
}

/// `space://` URI scheme handler. Serves binary assets (CSS-referenced images,
/// fonts, etc.) straight from the installed ZIP for the active profile. Never
/// panics — any failure becomes a 404 so a bad request can't wedge the scheme.
pub(crate) fn serve_space_request(
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{header, Response, StatusCode};

    let Some((space_id, entry)) = parse_space_locator(request.uri().path()) else {
        return space_not_found();
    };

    match read_zip_entry_bytes(&space_id, &entry) {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime_for(&entry))
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::CACHE_CONTROL, "no-cache")
            .body(bytes)
            .unwrap_or_else(|_| space_not_found()),
        Err(_) => space_not_found(),
    }
}

// ─── ZIP entry IPC commands ─────────────────────────────────────────────────

#[tauri::command]
pub fn space_zip_list(space_id: String) -> Result<Vec<String>, String> {
    list_zip_entries(&space_id)
}

#[tauri::command]
pub fn space_zip_read_text(space_id: String, entry: String) -> Result<String, String> {
    let bytes = read_zip_entry_bytes(&space_id, &entry)?;
    String::from_utf8(bytes).map_err(|e| format!("entry '{}' is not UTF-8: {}", entry, e))
}

#[tauri::command]
pub fn space_zip_read_bytes(space_id: String, entry: String) -> Result<Vec<u8>, String> {
    read_zip_entry_bytes(&space_id, &entry)
}

#[tauri::command]
pub fn space_zip_exists(space_id: String, entry: String) -> Result<bool, String> {
    let name = match normalize_entry(&entry) {
        Ok(n) => n,
        Err(_) => return Ok(false),
    };
    let (_, bytes) = match open_archive(&space_id) {
        Ok(v) => v,
        Err(_) => return Ok(false),
    };
    let slice: &[u8] = &bytes;
    let mut archive = ZipArchive::new(Cursor::new(slice))
        .map_err(|e| format!("invalid .space zip for '{}': {}", space_id, e))?;
    Ok(archive.by_name(&name).is_ok() || archive.by_name(&format!("./{}", name)).is_ok())
}

#[tauri::command]
pub fn space_zip_read_manifest(space_id: String) -> Result<String, String> {
    let bytes = read_zip_entry_bytes(&space_id, "manifest.json")?;
    String::from_utf8(bytes).map_err(|e| format!("manifest.json is not UTF-8: {}", e))
}

/// Cheap install-time validation: the bundle has a manifest and a resolvable
/// top-level `*.iife.js` entry. Used by the marketplace after copying a
/// downloaded `.space` into place.
#[tauri::command]
pub fn space_bundle_validate(space_id: String) -> Result<bool, String> {
    let entries = list_zip_entries(&space_id)?;
    let has_manifest = entries.iter().any(|e| e == "manifest.json");
    let has_js = entries
        .iter()
        .any(|e| !e.contains('/') && e.ends_with(".iife.js"));
    Ok(has_manifest && has_js)
}

pub(crate) fn resolve_space_bundle(
    space_id: &str,
    bundle_path: Option<&Path>,
) -> Result<PathBuf, String> {
    validate_space_id(space_id)?;

    let source = match bundle_path {
        Some(path) => path.to_path_buf(),
        None => installed_bundle_path(space_id)?,
    };

    if source.is_dir() {
        return Ok(source);
    }
    if !source.is_file() {
        return Err(format!(
            "space '{}' is not installed at {}",
            space_id,
            source.display()
        ));
    }

    let cache_dir = cache_dir_for(space_id)?;
    if !is_cache_current(&source, &cache_dir) {
        unpack_zip(&source, &cache_dir)?;
    }
    Ok(cache_dir)
}

fn tools_cache_dir_for(space_id: &str) -> Result<PathBuf, String> {
    validate_space_id(space_id)?;
    let profile_dir = crate::config::get_profile_data_dir()?;
    Ok(PathBuf::from(profile_dir)
        .join(TOOLS_CACHE_DIR)
        .join(format!("{}.space", space_id)))
}

fn is_tools_cache_current(source: &Path, cache_dir: &Path) -> bool {
    let marker = match source_marker(source) {
        Ok(marker) => marker,
        Err(_) => return false,
    };
    cache_dir.is_dir()
        && fs::read_to_string(cache_dir.join(MARKER_FILE))
            .map(|current| current == marker)
            .unwrap_or(false)
}

/// Extract only the `tools/` and `lib/` trees from the installed `.space` ZIP
/// to a small on-disk cache, preserving exec permissions. Used solely by the
/// native-tool runner (`space_binary.rs`) — the renderer never touches this.
/// Returns the cache dir (which contains `tools/` and `lib/`). An unpacked
/// (dev-linked) space is returned as-is.
fn unpack_tool_dirs(source: &Path, cache_dir: &Path) -> Result<(), String> {
    let file =
        File::open(source).map_err(|e| format!("open failed: {}: {}", source.display(), e))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("invalid .space zip {}: {}", source.display(), e))?;

    fs::remove_dir_all(cache_dir).ok();
    fs::create_dir_all(cache_dir)
        .map_err(|e| format!("create tools cache failed: {}: {}", cache_dir.display(), e))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("zip entry {} failed: {}", i, e))?;
        let Some(enclosed) = entry.enclosed_name().map(PathBuf::from) else {
            return Err(format!("unsafe zip path rejected: {}", entry.name()));
        };
        // Only the native tool/lib trees — skip the rest of the bundle.
        let top = enclosed
            .components()
            .next()
            .and_then(|c| c.as_os_str().to_str());
        if !matches!(top, Some("tools") | Some("lib")) {
            continue;
        }
        ensure_safe_zip_path(&enclosed)?;

        let out_path = cache_dir.join(&enclosed);
        if entry.is_dir() {
            fs::create_dir_all(&out_path)
                .map_err(|e| format!("create dir failed: {}: {}", out_path.display(), e))?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("create dir failed: {}: {}", parent.display(), e))?;
        }
        let mut out_file = File::create(&out_path)
            .map_err(|e| format!("create file failed: {}: {}", out_path.display(), e))?;
        io::copy(&mut entry, &mut out_file)
            .map_err(|e| format!("extract failed: {}: {}", out_path.display(), e))?;

        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&out_path, fs::Permissions::from_mode(mode))
                .map_err(|e| format!("chmod failed: {}: {}", out_path.display(), e))?;
        }
    }

    let marker = source_marker(source)?;
    fs::write(cache_dir.join(MARKER_FILE), marker)
        .map_err(|e| format!("write tools cache marker failed: {}", e))?;
    Ok(())
}

/// Materialize the native tool trees for a space and return the directory that
/// contains them. For a dev-linked unpacked space the bundle dir already has
/// real files, so it's returned unchanged.
pub(crate) fn materialize_tool_dirs(space_id: &str) -> Result<PathBuf, String> {
    validate_space_id(space_id)?;
    let installed = installed_bundle_path(space_id)?;

    if installed.is_dir() {
        return Ok(installed);
    }
    if !installed.is_file() {
        return Err(format!(
            "space '{}' is not installed at {}",
            space_id,
            installed.display()
        ));
    }

    let cache_dir = tools_cache_dir_for(space_id)?;
    if !is_tools_cache_current(&installed, &cache_dir) {
        unpack_tool_dirs(&installed, &cache_dir)?;
    }
    Ok(cache_dir)
}

#[tauri::command]
pub fn space_bundle_resolve(
    space_id: String,
    bundle_path: Option<String>,
) -> Result<String, String> {
    let path = bundle_path.as_deref().map(Path::new);
    resolve_space_bundle(&space_id, path).map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn space_bundle_pack(space_id: String, source_dir: String) -> Result<String, String> {
    pack_dir_to_installed_space(&space_id, Path::new(&source_dir))
        .map(|path| path.to_string_lossy().into_owned())
}

/// Best-effort removal of pre-migration extraction caches across all profiles.
/// The renderer now reads installed spaces straight from the ZIP, so the old
/// full-extraction `space-cache/` (and the even older dotted `.space-cache/`)
/// are dead weight. Safe to wipe — anything still needed (a loose-ZIP dev
/// preview) re-extracts on demand.
pub fn cleanup_stale_caches() {
    let base = match crate::config::construct_data_dir() {
        Ok(base) => base,
        Err(_) => return,
    };
    let Ok(entries) = fs::read_dir(base.join("profiles")) else {
        return;
    };
    for entry in entries.flatten() {
        let profile_dir = entry.path();
        if !profile_dir.is_dir() {
            continue;
        }
        for stale in [CACHE_DIR, ".space-cache"] {
            let path = profile_dir.join(stale);
            if path.exists() {
                let _ = fs::remove_dir_all(&path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_locator_splits_id_and_entry() {
        assert_eq!(
            parse_space_locator("/weather/space-weather.iife.js"),
            Some(("weather".into(), "space-weather.iife.js".into()))
        );
        // Nested asset path stays intact as the entry.
        assert_eq!(
            parse_space_locator("/weather/assets/logo.png"),
            Some(("weather".into(), "assets/logo.png".into()))
        );
        // Percent-encoded segments are decoded.
        assert_eq!(
            parse_space_locator("/my%20space/a%20b.css"),
            Some(("my space".into(), "a b.css".into()))
        );
    }

    #[test]
    fn parse_locator_rejects_malformed() {
        assert_eq!(parse_space_locator("/"), None);
        assert_eq!(parse_space_locator("/weather"), None); // no entry
        assert_eq!(parse_space_locator("/weather/"), None); // empty entry
        assert_eq!(parse_space_locator(""), None);
    }

    #[test]
    fn normalize_entry_rejects_traversal() {
        assert!(normalize_entry("../secret").is_err());
        assert!(normalize_entry("a/../../b").is_err());
        assert!(normalize_entry("/abs/path").is_ok()); // leading slash stripped → relative
        assert_eq!(normalize_entry("manifest.json").unwrap(), "manifest.json");
        assert_eq!(normalize_entry("/style.css").unwrap(), "style.css");
        assert_eq!(normalize_entry("assets\\x.png").unwrap(), "assets/x.png");
    }

    #[test]
    fn mime_mapping_covers_bundle_assets() {
        assert_eq!(mime_for("app.iife.js"), "text/javascript");
        assert_eq!(mime_for("style.css"), "text/css");
        assert_eq!(mime_for("manifest.json"), "application/json");
        assert_eq!(mime_for("icon.SVG"), "image/svg+xml"); // case-insensitive
        assert_eq!(mime_for("font.woff2"), "font/woff2");
        assert_eq!(mime_for("noext"), "application/octet-stream");
    }
}
