use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{Manager, State};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PdfResumeInfo {
    pub page: usize,
    pub zoom: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppSettings {
    pub theme: Option<String>,
    pub last_dir: Option<String>,
    #[serde(default)]
    pub resumes: HashMap<String, PdfResumeInfo>,
}

pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub settings_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaunchTarget {
    pub initial_file: Option<String>,
    pub initial_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub modified: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderListing {
    pub current_dir: String,
    pub parent_dir: Option<String>,
    pub entries: Vec<FolderEntry>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfFilePayload {
    pub file_path: String,
    pub file_name: String,
    pub dir_path: String,
    pub size_bytes: u64,
    pub base64_data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchPdfOutput {
    pub path: String,
    pub base64_data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveResult {
    pub saved_path: String,
    pub size_bytes: u64,
}

#[cfg(debug_assertions)]
const CONFIG_DIR_ENV: &str = "GUIF_PDF_CONFIG_DIR";
#[cfg(debug_assertions)]
const E2E_FS_SCOPE_ENV: &str = "GUIF_PDF_E2E_FS_SCOPE";

/// Debug-only overrides keep E2E runs away from real user data. A bad value is an error,
/// never a silent fallback to the real folder.
#[cfg(debug_assertions)]
fn parse_dir_override(
    name: &str,
    value: Option<std::ffi::OsString>,
) -> Result<Option<PathBuf>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let path = PathBuf::from(&value);
    if value.to_str().is_none_or(|v| v.trim().is_empty()) || !path.is_absolute() {
        return Err(format!("{name} must be an absolute path: {value:?}"));
    }
    Ok(Some(path))
}

#[cfg(debug_assertions)]
fn dir_override_or_exit(name: &str) -> Option<PathBuf> {
    parse_dir_override(name, std::env::var_os(name)).unwrap_or_else(|e| {
        eprintln!("{e}");
        std::process::exit(2);
    })
}

fn get_settings_path() -> PathBuf {
    #[cfg(debug_assertions)]
    if let Some(dir) = dir_override_or_exit(CONFIG_DIR_ENV) {
        let _ = fs::create_dir_all(&dir);
        eprintln!("[config] override dir: {}", dir.display());
        return dir.join("settings.json");
    }
    if let Some(config_dir) = dirs::config_dir() {
        let dir = config_dir.join("dev.guif.pdf");
        let _ = fs::create_dir_all(&dir);
        dir.join("settings.json")
    } else {
        PathBuf::from("settings.json")
    }
}

/// In an E2E run the backend refuses to write outside the test folder.
fn check_write_scope(_target: &Path) -> Result<(), String> {
    #[cfg(debug_assertions)]
    if let Some(scope) = dir_override_or_exit(E2E_FS_SCOPE_ENV) {
        let scope = fs::canonicalize(&scope).map_err(|e| format!("E2E scope: {e}"))?;
        let inside = _target
            .ancestors()
            .find_map(|a| fs::canonicalize(a).ok())
            .is_some_and(|existing| existing.starts_with(&scope));
        if !inside {
            return Err(format!(
                "E2E scope: refused to write outside {}",
                scope.display()
            ));
        }
    }
    Ok(())
}

fn load_settings(path: &Path) -> AppSettings {
    if let Ok(content) = fs::read_to_string(path) {
        if let Ok(parsed) = serde_json::from_str::<AppSettings>(&content) {
            return parsed;
        }
    }
    AppSettings::default()
}

fn persist_settings(path: &Path, settings: &AppSettings) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = replace_file_atomically(path, json.as_bytes());
    }
}

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Writes `bytes` to a new file next to `target`, flushed to disk.
fn write_temp_sibling(target: &Path, bytes: &[u8]) -> io::Result<PathBuf> {
    let parent = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let temp = parent.join(format!(
        ".guif-pdf-{}-{}.tmp",
        std::process::id(),
        TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let result = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .and_then(|mut file| {
            file.write_all(bytes)?;
            file.sync_all()
        });
    match result {
        Ok(()) => Ok(temp),
        Err(e) => {
            let _ = fs::remove_file(&temp);
            Err(e)
        }
    }
}

/// Moves a finished temp file into place. A failure leaves an existing `target` untouched.
fn commit_temp_file(temp: &Path, target: &Path, allow_overwrite: bool) -> io::Result<()> {
    if allow_overwrite {
        // Follow a link so that the rename replaces the file it points at, not the link.
        let destination = fs::canonicalize(target).unwrap_or_else(|_| target.to_path_buf());
        return fs::rename(temp, destination);
    }
    // rename() would replace a file created since the last check; a hard link cannot.
    match fs::hard_link(temp, target) {
        Ok(()) => fs::remove_file(temp),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Err(e),
        // Volumes without hard links (FAT, some network shares).
        Err(_) if target.exists() => Err(io::ErrorKind::AlreadyExists.into()),
        Err(_) => fs::rename(temp, target),
    }
}

fn replace_file_atomically(target: &Path, bytes: &[u8]) -> io::Result<()> {
    let temp = write_temp_sibling(target, bytes)?;
    commit_temp_file(&temp, target, true).inspect_err(|_| {
        let _ = fs::remove_file(&temp);
    })
}

fn has_pdf_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("pdf"))
}

fn exists_message(path: &Path) -> String {
    format!(
        "同名のファイルが既に存在します: {}（上書きを許可するか、別のファイル名を指定してください）",
        path.display()
    )
}

fn check_output_path(target: &Path) -> Result<(), String> {
    if !has_pdf_extension(target) {
        return Err(format!(
            "保存先のファイル名は .pdf で終わる必要があります: {}",
            target.display()
        ));
    }
    check_write_scope(target)
}

fn write_pdf_bytes(target: &Path, bytes: &[u8], allow_overwrite: bool) -> Result<(), String> {
    check_output_path(target)?;
    if !allow_overwrite && target.exists() {
        return Err(exists_message(target));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("保存先フォルダーの作成に失敗しました: {}", e))?;
    }
    let temp = write_temp_sibling(target, bytes)
        .map_err(|e| format!("PDFファイルの書き込みに失敗しました: {}", e))?;
    commit_temp_file(&temp, target, allow_overwrite).map_err(|e| {
        let _ = fs::remove_file(&temp);
        if e.kind() == io::ErrorKind::AlreadyExists {
            exists_message(target)
        } else {
            format!("PDFファイルの書き込みに失敗しました: {}", e)
        }
    })
}

/// All outputs are written to temp files first, so a full disk or a bad folder fails
/// before any target has changed.
fn write_pdf_batch(files: &[(PathBuf, Vec<u8>)], allow_overwrite: bool) -> Result<(), String> {
    let mut seen = std::collections::HashSet::new();
    for (target, _) in files {
        check_output_path(target)?;
        if !seen.insert(target.to_string_lossy().to_lowercase()) {
            return Err(format!("出力先が重複しています: {}", target.display()));
        }
        if !allow_overwrite && target.exists() {
            return Err(exists_message(target));
        }
    }

    let mut temps: Vec<PathBuf> = Vec::with_capacity(files.len());
    let remove_all = |temps: &[PathBuf]| {
        for temp in temps {
            let _ = fs::remove_file(temp);
        }
    };
    for (target, bytes) in files {
        let staged = target
            .parent()
            .map_or(Ok(()), fs::create_dir_all)
            .and_then(|()| write_temp_sibling(target, bytes));
        match staged {
            Ok(temp) => temps.push(temp),
            Err(e) => {
                remove_all(&temps);
                return Err(format!(
                    "ファイル書き込み失敗 ({}): {}",
                    target.display(),
                    e
                ));
            }
        }
    }
    for (i, (target, _)) in files.iter().enumerate() {
        if let Err(e) = commit_temp_file(&temps[i], target, allow_overwrite) {
            remove_all(&temps[i..]);
            return Err(format!(
                "ファイル書き込み失敗 ({}): {}（{} 個は保存済みです）",
                target.display(),
                e,
                i
            ));
        }
    }
    Ok(())
}

fn clean_windows_path(p: &Path) -> String {
    let raw = p.to_string_lossy().to_string();
    if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        stripped.to_string()
    } else {
        raw
    }
}

fn default_browse_dir(settings: &AppSettings) -> String {
    if let Some(last) = &settings.last_dir {
        let p = Path::new(last);
        if p.is_dir() {
            return clean_windows_path(p);
        }
    }
    if let Some(doc) = dirs::document_dir() {
        if doc.is_dir() {
            return clean_windows_path(&doc);
        }
    }
    if let Some(home) = dirs::home_dir() {
        if home.is_dir() {
            return clean_windows_path(&home);
        }
    }
    "C:\\".to_string()
}

/// Interprets the command line guif passes: a PDF to open, or a folder to browse.
/// Any other file only selects its folder.
fn resolve_launch_target(args: &[String], fallback_dir: impl Fn() -> String) -> LaunchTarget {
    for arg in args {
        if arg.starts_with('-') {
            continue;
        }
        let path = PathBuf::from(arg);
        if path.is_file() {
            let abs = fs::canonicalize(&path).unwrap_or(path.clone());
            let initial_dir = abs
                .parent()
                .map(clean_windows_path)
                .unwrap_or_else(&fallback_dir);
            return LaunchTarget {
                initial_file: has_pdf_extension(&abs).then(|| clean_windows_path(&abs)),
                initial_dir,
            };
        } else if path.is_dir() {
            let abs = fs::canonicalize(&path).unwrap_or(path.clone());
            return LaunchTarget {
                initial_file: None,
                initial_dir: clean_windows_path(&abs),
            };
        }
    }

    LaunchTarget {
        initial_file: None,
        initial_dir: fallback_dir(),
    }
}

#[tauri::command]
fn get_launch_target(state: State<'_, AppState>) -> LaunchTarget {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let settings = state.settings.lock().unwrap();
    resolve_launch_target(&args, || default_browse_dir(&settings))
}

#[tauri::command]
fn list_drives() -> Vec<String> {
    let mut drives = Vec::new();
    #[cfg(target_os = "windows")]
    {
        for letter in b'A'..=b'Z' {
            let root = format!("{}:\\", letter as char);
            if Path::new(&root).exists() {
                drives.push(root);
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        drives.push("/".to_string());
    }
    drives
}

#[tauri::command]
fn list_pdf_folder(state: State<'_, AppState>, path: String) -> FolderListing {
    let target = PathBuf::from(&path);
    if !target.is_dir() {
        return FolderListing {
            current_dir: path,
            parent_dir: None,
            entries: Vec::new(),
            error: Some("指定されたフォルダーが見つかりません。".to_string()),
        };
    }

    let canonical = fs::canonicalize(&target).unwrap_or(target);
    let current_dir = clean_windows_path(&canonical);
    let parent_dir = canonical.parent().map(clean_windows_path);

    {
        let mut settings = state.settings.lock().unwrap();
        settings.last_dir = Some(current_dir.clone());
        persist_settings(&state.settings_path, &settings);
    }

    let mut dirs = Vec::new();
    let mut files = Vec::new();

    match fs::read_dir(&canonical) {
        Ok(read_dir) => {
            for item in read_dir.flatten() {
                let item_path = item.path();
                let name = item.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                let metadata = match item.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                let is_dir = metadata.is_dir();
                if !is_dir {
                    let is_pdf = item_path
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.eq_ignore_ascii_case("pdf"))
                        .unwrap_or(false);
                    if !is_pdf {
                        continue;
                    }
                }
                let modified = metadata
                    .modified()
                    .ok()
                    .map(|t| {
                        let dt: DateTime<Local> = t.into();
                        dt.format("%Y-%m-%d %H:%M").to_string()
                    })
                    .unwrap_or_default();

                let entry = FolderEntry {
                    name,
                    path: clean_windows_path(&item_path),
                    is_dir,
                    size_bytes: if is_dir { 0 } else { metadata.len() },
                    modified,
                };
                if is_dir {
                    dirs.push(entry);
                } else {
                    files.push(entry);
                }
            }
        }
        Err(e) => {
            return FolderListing {
                current_dir,
                parent_dir,
                entries: Vec::new(),
                error: Some(format!("フォルダーの読み取りに失敗しました: {}", e)),
            };
        }
    }

    dirs.sort_by_key(|a| a.name.to_lowercase());
    files.sort_by_key(|a| a.name.to_lowercase());

    let mut entries = dirs;
    entries.extend(files);

    FolderListing {
        current_dir,
        parent_dir,
        entries,
        error: None,
    }
}

// Whole files pass through these commands; `async` keeps them off the UI thread.
#[tauri::command(async)]
fn read_pdf_base64(state: State<'_, AppState>, path: String) -> Result<PdfFilePayload, String> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err(format!("PDFファイルが見つかりません: {}", path));
    }
    if !has_pdf_extension(&p) {
        return Err(format!("PDFファイルではありません: {}", path));
    }
    let abs = fs::canonicalize(&p).unwrap_or(p);
    let bytes = fs::read(&abs).map_err(|e| format!("PDFの読み込みに失敗しました: {}", e))?;
    let size_bytes = bytes.len() as u64;
    let file_name = abs
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "document.pdf".to_string());
    let dir_path = abs
        .parent()
        .map(clean_windows_path)
        .unwrap_or_else(|| ".".to_string());

    {
        let mut settings = state.settings.lock().unwrap();
        settings.last_dir = Some(dir_path.clone());
        persist_settings(&state.settings_path, &settings);
    }

    Ok(PdfFilePayload {
        file_path: clean_windows_path(&abs),
        file_name,
        dir_path,
        size_bytes,
        base64_data: BASE64.encode(&bytes),
    })
}

pub fn compute_suggested_save_path(original_path: &Path, suffix: &str) -> PathBuf {
    let parent = original_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = original_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "document".to_string());

    let clean_suffix = if suffix.is_empty() {
        "_edited".to_string()
    } else if suffix.starts_with('_') || suffix.starts_with('-') {
        suffix.to_string()
    } else {
        format!("_{}", suffix)
    };

    let candidate = parent.join(format!("{}{}.pdf", stem, clean_suffix));
    if !candidate.exists() {
        return candidate;
    }

    for idx in 2..=999 {
        let numbered = parent.join(format!("{}{}_{}.pdf", stem, clean_suffix, idx));
        if !numbered.exists() {
            return numbered;
        }
    }

    candidate
}

#[tauri::command]
fn suggest_save_path(original_path: String, suffix: String) -> String {
    let p = PathBuf::from(&original_path);
    let suggested = compute_suggested_save_path(&p, &suffix);
    clean_windows_path(&suggested)
}

#[tauri::command(async)]
fn write_pdf_base64(
    path: String,
    base64_data: String,
    allow_overwrite: bool,
) -> Result<SaveResult, String> {
    let target = PathBuf::from(&path);
    let bytes = BASE64
        .decode(base64_data.trim())
        .map_err(|e| format!("PDFデータのデコードに失敗しました: {}", e))?;

    write_pdf_bytes(&target, &bytes, allow_overwrite)?;

    let abs = fs::canonicalize(&target).unwrap_or(target);
    Ok(SaveResult {
        saved_path: clean_windows_path(&abs),
        size_bytes: bytes.len() as u64,
    })
}

#[tauri::command(async)]
fn write_multiple_pdfs_base64(
    files: Vec<BatchPdfOutput>,
    allow_overwrite: bool,
) -> Result<Vec<String>, String> {
    if files.is_empty() {
        return Err("出力対象のファイルがありません。".to_string());
    }

    let mut decoded = Vec::with_capacity(files.len());
    for item in &files {
        let bytes = BASE64
            .decode(item.base64_data.trim())
            .map_err(|e| format!("PDFデータのデコード失敗 ({}): {}", item.path, e))?;
        decoded.push((PathBuf::from(&item.path), bytes));
    }

    write_pdf_batch(&decoded, allow_overwrite)?;

    Ok(decoded
        .iter()
        .map(|(target, _)| {
            clean_windows_path(&fs::canonicalize(target).unwrap_or_else(|_| target.clone()))
        })
        .collect())
}

// ----------------------------------------------------
// Resume & Theme Commands (guif aligned)
// ----------------------------------------------------

#[tauri::command]
fn save_pdf_resume(
    state: State<'_, AppState>,
    file_path: String,
    page: usize,
    zoom: f64,
) -> Result<(), String> {
    let mut settings = state.settings.lock().unwrap();
    settings
        .resumes
        .insert(file_path, PdfResumeInfo { page, zoom });
    persist_settings(&state.settings_path, &settings);
    Ok(())
}

#[tauri::command]
fn get_pdf_resume(state: State<'_, AppState>, file_path: String) -> Option<PdfResumeInfo> {
    let settings = state.settings.lock().unwrap();
    settings.resumes.get(&file_path).cloned()
}

pub fn normalize_preset_name(name: &str) -> String {
    let normalized = name
        .trim()
        .to_ascii_lowercase()
        .replace(['-', '_', ' '], "");
    match normalized.as_str() {
        "default" => "default".to_string(),
        "nord" => "nord".to_string(),
        "monokai" => "monokai".to_string(),
        "catppuccin" | "catppuccinmocha" => "catppuccin".to_string(),
        "solarized" | "solarizeddark" => "solarized".to_string(),
        "light" => "light".to_string(),
        _ => "nord".to_string(),
    }
}

pub fn parse_guif_theme_from_toml(content: &str) -> Option<String> {
    let config: toml::Table = content.parse().ok()?;
    let theme = config.get("theme")?.as_table()?;
    ["preset", "name", "theme"]
        .iter()
        .find_map(|key| theme.get(*key)?.as_str())
        .filter(|value| !value.trim().is_empty())
        .map(normalize_preset_name)
}

fn read_guif_config_preset() -> Option<String> {
    let config_dir = dirs::config_dir()?;
    let config_path = config_dir.join("dev.guif.app").join("config.toml");
    let content = fs::read_to_string(config_path).ok()?;
    parse_guif_theme_from_toml(&content)
}

#[tauri::command]
fn get_theme_setting(state: State<'_, AppState>) -> String {
    let settings = state.settings.lock().unwrap();
    if let Some(saved) = &settings.theme {
        if saved == "guif" {
            return "guif".to_string();
        }
        return normalize_preset_name(saved);
    }
    if read_guif_config_preset().is_some() {
        return "guif".to_string();
    }
    "nord".to_string()
}

#[tauri::command]
fn get_guif_theme_preset() -> String {
    read_guif_config_preset().unwrap_or_else(|| "nord".to_string())
}

#[tauri::command]
fn save_theme_setting(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    theme: String,
) -> Result<String, String> {
    let saved_value = if theme == "guif" {
        "guif".to_string()
    } else {
        normalize_preset_name(&theme)
    };

    {
        let mut settings = state.settings.lock().unwrap();
        settings.theme = Some(saved_value.clone());
        persist_settings(&state.settings_path, &settings);
    }

    let resolved = if saved_value == "guif" {
        read_guif_config_preset().unwrap_or_else(|| "nord".to_string())
    } else {
        saved_value
    };

    let win_theme = if resolved == "light" {
        tauri::Theme::Light
    } else {
        tauri::Theme::Dark
    };
    let _ = window.set_theme(Some(win_theme));

    Ok(resolved)
}

pub fn run() {
    let settings_path = get_settings_path();
    #[cfg(debug_assertions)]
    if let Some(scope) = dir_override_or_exit(E2E_FS_SCOPE_ENV) {
        eprintln!("E2E fs scope active: {}", scope.display());
    }
    let initial_settings = load_settings(&settings_path);
    let saved_theme = initial_settings
        .theme
        .clone()
        .unwrap_or_else(|| "guif".to_string());

    tauri::Builder::default()
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                if let Some(icon) = app.default_window_icon().cloned() {
                    let _ = window.set_icon(icon);
                }
                let resolved_theme = if saved_theme == "guif" {
                    read_guif_config_preset().unwrap_or_else(|| "nord".to_string())
                } else {
                    normalize_preset_name(&saved_theme)
                };
                let win_theme = if resolved_theme == "light" {
                    tauri::Theme::Light
                } else {
                    tauri::Theme::Dark
                };
                let _ = window.set_theme(Some(win_theme));
            }
            Ok(())
        })
        .manage(AppState {
            settings: Mutex::new(initial_settings),
            settings_path,
        })
        .invoke_handler(tauri::generate_handler![
            get_launch_target,
            list_drives,
            list_pdf_folder,
            read_pdf_base64,
            suggest_save_path,
            write_pdf_base64,
            write_multiple_pdfs_base64,
            save_pdf_resume,
            get_pdf_resume,
            get_theme_setting,
            get_guif_theme_preset,
            save_theme_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running guif-pdf");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_preset_name() {
        assert_eq!(normalize_preset_name("Nord"), "nord");
        assert_eq!(normalize_preset_name("Catppuccin-Mocha"), "catppuccin");
        assert_eq!(normalize_preset_name("Solarized_Dark"), "solarized");
        assert_eq!(normalize_preset_name("light"), "light");
        assert_eq!(normalize_preset_name("unknown"), "nord");
    }

    #[test]
    fn test_parse_guif_theme_from_toml() {
        let toml = r#"
# comment
[theme]
preset = "catppuccin" # comment
"#;
        assert_eq!(
            parse_guif_theme_from_toml(toml),
            Some("catppuccin".to_string())
        );
    }

    #[test]
    fn test_compute_suggested_save_path() {
        let p = Path::new("C:\\nonexistent_dir_for_test\\report.pdf");
        let suggested = compute_suggested_save_path(p, "_edited");
        assert_eq!(
            suggested,
            PathBuf::from("C:\\nonexistent_dir_for_test\\report_edited.pdf")
        );
    }

    #[test]
    fn suggested_save_path_skips_existing_files() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("report.pdf");
        fs::write(dir.path().join("report_edited.pdf"), b"x").unwrap();
        fs::write(dir.path().join("report_edited_2.pdf"), b"x").unwrap();
        assert_eq!(
            compute_suggested_save_path(&original, "edited"),
            dir.path().join("report_edited_3.pdf")
        );
    }

    fn temp_files(dir: &Path) -> Vec<String> {
        fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with(".tmp"))
            .collect()
    }

    #[test]
    fn write_refuses_existing_file_without_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("a.pdf");
        fs::write(&target, b"original").unwrap();
        let err = write_pdf_bytes(&target, b"new", false).unwrap_err();
        assert!(err.contains("既に存在"), "{err}");
        assert_eq!(fs::read(&target).unwrap(), b"original");
        assert!(temp_files(dir.path()).is_empty());
    }

    #[test]
    fn overwrite_replaces_content_and_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("a.PDF");
        fs::write(&target, b"original").unwrap();
        write_pdf_bytes(&target, b"new", true).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new");
        assert!(temp_files(dir.path()).is_empty());
    }

    #[test]
    fn failed_overwrite_keeps_the_original() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("a.pdf");
        fs::write(&target, b"original").unwrap();
        let mut perms = fs::metadata(&target).unwrap().permissions();
        perms.set_readonly(true);
        fs::set_permissions(&target, perms.clone()).unwrap();

        let result = write_pdf_bytes(&target, b"new", true);

        assert!(result.is_err());
        assert_eq!(fs::read(&target).unwrap(), b"original");
        assert!(temp_files(dir.path()).is_empty());
        #[allow(clippy::permissions_set_readonly_false)]
        perms.set_readonly(false);
        fs::set_permissions(&target, perms).unwrap();
    }

    #[test]
    fn write_rejects_non_pdf_targets() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("a.exe");
        assert!(write_pdf_bytes(&target, b"x", true).is_err());
        assert!(!target.exists());
    }

    #[test]
    fn write_creates_missing_folders() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("sub").join("a.pdf");
        write_pdf_bytes(&target, b"x", false).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"x");
    }

    #[test]
    fn batch_checks_every_target_before_writing_any() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("1.pdf");
        let existing = dir.path().join("2.pdf");
        fs::write(&existing, b"original").unwrap();
        let files = vec![
            (first.clone(), b"a".to_vec()),
            (existing.clone(), b"b".to_vec()),
        ];

        assert!(write_pdf_batch(&files, false).is_err());

        assert!(!first.exists());
        assert_eq!(fs::read(&existing).unwrap(), b"original");
    }

    #[test]
    fn batch_rejects_duplicate_targets_ignoring_case() {
        let dir = tempfile::tempdir().unwrap();
        let files = vec![
            (dir.path().join("a.pdf"), b"1".to_vec()),
            (dir.path().join("A.PDF"), b"2".to_vec()),
        ];
        assert!(write_pdf_batch(&files, true).is_err());
        assert!(temp_files(dir.path()).is_empty());
    }

    #[test]
    fn batch_writes_all_files() {
        let dir = tempfile::tempdir().unwrap();
        let files = vec![
            (dir.path().join("1.pdf"), b"a".to_vec()),
            (dir.path().join("2.pdf"), b"b".to_vec()),
        ];
        write_pdf_batch(&files, false).unwrap();
        assert_eq!(fs::read(&files[1].0).unwrap(), b"b");
        assert!(temp_files(dir.path()).is_empty());
    }

    #[test]
    fn launch_target_opens_a_pdf_with_its_folder() {
        let dir = tempfile::tempdir().unwrap();
        let pdf = dir.path().join("日本語 ファイル.pdf");
        fs::write(&pdf, b"x").unwrap();
        let target = resolve_launch_target(&[pdf.display().to_string()], || "fallback".into());
        assert!(target
            .initial_file
            .unwrap()
            .ends_with("日本語 ファイル.pdf"));
        assert_ne!(target.initial_dir, "fallback");
    }

    #[test]
    fn launch_target_browses_a_folder() {
        let dir = tempfile::tempdir().unwrap();
        let target =
            resolve_launch_target(&[dir.path().display().to_string()], || "fallback".into());
        assert!(target.initial_file.is_none());
        assert_ne!(target.initial_dir, "fallback");
    }

    #[test]
    fn launch_target_does_not_open_other_file_types() {
        let dir = tempfile::tempdir().unwrap();
        let txt = dir.path().join("a.txt");
        fs::write(&txt, b"x").unwrap();
        let target = resolve_launch_target(&[txt.display().to_string()], || "fallback".into());
        assert!(target.initial_file.is_none());
        assert_ne!(target.initial_dir, "fallback");
    }

    #[test]
    fn launch_target_ignores_flags_and_missing_paths() {
        let args = ["--flag".to_string(), "Z:\\no\\such\\file.pdf".to_string()];
        let target = resolve_launch_target(&args, || "fallback".into());
        assert!(target.initial_file.is_none());
        assert_eq!(target.initial_dir, "fallback");
    }

    #[test]
    fn dir_override_rejects_bad_values() {
        assert_eq!(parse_dir_override("X", None).unwrap(), None);
        assert!(parse_dir_override("X", Some("".into())).is_err());
        assert!(parse_dir_override("X", Some("   ".into())).is_err());
        assert!(parse_dir_override("X", Some("relative".into())).is_err());
        assert_eq!(
            parse_dir_override("X", Some("C:\\test".into())).unwrap(),
            Some(PathBuf::from("C:\\test"))
        );
    }

    #[test]
    fn theme_parser_handles_comments_on_section_lines_and_broken_toml() {
        assert_eq!(
            parse_guif_theme_from_toml("[theme] # 配色\npreset = 'light'\n"),
            Some("light".to_string())
        );
        assert_eq!(parse_guif_theme_from_toml("[theme\npreset = 'light'"), None);
        assert_eq!(parse_guif_theme_from_toml("[theme]\npreset = 1\n"), None);
        assert_eq!(parse_guif_theme_from_toml("preset = 'light'\n"), None);
    }

    // Contract with guif: its documented config.toml template must keep working here.
    #[test]
    fn guif_sample_config_is_readable_and_sets_no_theme() {
        let sample = include_str!("../test-fixtures/guif-config.sample.toml");
        assert!(sample.parse::<toml::Table>().is_ok());
        assert_eq!(parse_guif_theme_from_toml(sample), None);
        let uncommented = sample.replace(
            "# [theme]\n# preset = \"nord\"",
            "[theme]\npreset = \"monokai\"",
        );
        assert_ne!(uncommented, sample, "the sample's [theme] lines changed");
        assert_eq!(
            parse_guif_theme_from_toml(&uncommented),
            Some("monokai".to_string())
        );
    }

    // Contract with guif: the README's registration must satisfy guif's external_apps schema.
    #[test]
    fn readme_external_app_example_matches_guif_schema() {
        let readme = include_str!("../../../README.md").replace("\r\n", "\n");
        let block = readme
            .split("```toml\n")
            .nth(1)
            .and_then(|rest| rest.split("```").next())
            .expect("README has a toml block");
        let config: toml::Table = block.parse().expect("README toml block parses");
        let apps = config["external_apps"].as_array().unwrap();
        let app = apps
            .iter()
            .find(|a| a["name"].as_str().is_some_and(|n| n.contains("guif-pdf")))
            .expect("guif-pdf is registered");
        assert_eq!(
            apps.len(),
            5,
            "guif drops its 4 defaults once external_apps is written"
        );
        assert_eq!(
            app["program"].as_str().unwrap(),
            "%LOCALAPPDATA%\\guif-pdf\\guif-pdf.exe"
        );
        assert_eq!(app["args"].as_array().unwrap()[0].as_str(), Some("{dir}"));
        assert_eq!(
            app["args_for_file"].as_array().unwrap()[0].as_str(),
            Some("{path}")
        );
        assert!(app["key"].is_str());
    }
}
