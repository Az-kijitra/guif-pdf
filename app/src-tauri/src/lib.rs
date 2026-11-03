use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
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

fn get_settings_path() -> PathBuf {
    if let Some(config_dir) = dirs::config_dir() {
        let dir = config_dir.join("dev.guif.pdf");
        let _ = fs::create_dir_all(&dir);
        dir.join("settings.json")
    } else {
        PathBuf::from("settings.json")
    }
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
        let _ = fs::write(path, json);
    }
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

#[tauri::command]
fn get_launch_target(state: State<'_, AppState>) -> LaunchTarget {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let settings = state.settings.lock().unwrap();

    for arg in args {
        if arg.starts_with('-') {
            continue;
        }
        let path = PathBuf::from(&arg);
        if path.is_file() {
            let abs = fs::canonicalize(&path).unwrap_or(path.clone());
            let file_str = clean_windows_path(&abs);
            let dir_str = abs
                .parent()
                .map(clean_windows_path)
                .unwrap_or_else(|| default_browse_dir(&settings));
            return LaunchTarget {
                initial_file: Some(file_str),
                initial_dir: dir_str,
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
        initial_dir: default_browse_dir(&settings),
    }
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

    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    let mut entries = dirs;
    entries.extend(files);

    FolderListing {
        current_dir,
        parent_dir,
        entries,
        error: None,
    }
}

#[tauri::command]
fn read_pdf_base64(state: State<'_, AppState>, path: String) -> Result<PdfFilePayload, String> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err(format!("PDFファイルが見つかりません: {}", path));
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
    let parent = original_path
        .parent()
        .unwrap_or_else(|| Path::new("."));
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

#[tauri::command]
fn write_pdf_base64(
    path: String,
    base64_data: String,
    allow_overwrite: bool,
) -> Result<SaveResult, String> {
    let target = PathBuf::from(&path);
    if target.exists() && !allow_overwrite {
        return Err(format!(
            "同名のファイルが既に存在します: {}（上書きを許可するか、別のファイル名を指定してください）",
            path
        ));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("保存先フォルダーの作成に失敗しました: {}", e))?;
    }
    let bytes = BASE64
        .decode(base64_data.trim())
        .map_err(|e| format!("PDFデータのデコードに失敗しました: {}", e))?;

    fs::write(&target, &bytes)
        .map_err(|e| format!("PDFファイルの書き込みに失敗しました: {}", e))?;

    let abs = fs::canonicalize(&target).unwrap_or(target);
    Ok(SaveResult {
        saved_path: clean_windows_path(&abs),
        size_bytes: bytes.len() as u64,
    })
}

#[tauri::command]
fn write_multiple_pdfs_base64(
    files: Vec<BatchPdfOutput>,
    allow_overwrite: bool,
) -> Result<Vec<String>, String> {
    if files.is_empty() {
        return Err("出力対象のファイルがありません。".to_string());
    }

    if !allow_overwrite {
        for item in &files {
            let p = Path::new(&item.path);
            if p.exists() {
                return Err(format!(
                    "出力先に既存のファイルが存在します: {}（「既存ファイルの上書きを許可」にチェックを入れるか、接頭辞を変更してください）",
                    item.path
                ));
            }
        }
    }

    let mut saved_paths = Vec::with_capacity(files.len());
    for item in files {
        let target = PathBuf::from(&item.path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("フォルダー作成失敗 ({}): {}", item.path, e))?;
        }
        let bytes = BASE64
            .decode(item.base64_data.trim())
            .map_err(|e| format!("PDFデータのデコード失敗 ({}): {}", item.path, e))?;
        fs::write(&target, &bytes)
            .map_err(|e| format!("ファイル書き込み失敗 ({}): {}", item.path, e))?;
        let abs = fs::canonicalize(&target).unwrap_or(target);
        saved_paths.push(clean_windows_path(&abs));
    }

    Ok(saved_paths)
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
    let mut in_theme_section = false;
    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            in_theme_section = line == "[theme]";
            continue;
        }
        if in_theme_section {
            if let Some((k, v)) = line.split_once('=') {
                let key = k.trim();
                if matches!(key, "preset" | "name" | "theme") {
                    let val = v
                        .split('#')
                        .next()
                        .unwrap_or("")
                        .trim()
                        .trim_matches('"')
                        .trim_matches('\'');
                    if !val.is_empty() {
                        return Some(normalize_preset_name(val));
                    }
                }
            }
        }
    }
    None
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
}
