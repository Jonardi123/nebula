use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use std::collections::{HashSet, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

mod mobile_bridge;
mod storage;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<FileNode>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSearchResult {
    path: String,
    line: usize,
    text: String,
    match_count: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CommandOutput {
    code: Option<i32>,
    stdout: String,
    stderr: String,
    job_id: Option<String>,
    truncated: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CommandEvent {
    job_id: String,
    #[serde(rename = "type")]
    event_type: String,
    stream: Option<String>,
    data: Option<String>,
    code: Option<i32>,
    created_at: String,
    truncated: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CommandJobState {
    id: String,
    command: String,
    cwd: String,
    pid: u32,
    status: String,
    started_at: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InstalledAppRecord {
    id: String,
    name: String,
    path: String,
    source: String,
    aliases: Vec<String>,
}

#[derive(Serialize)]
struct MemorySearchResult {
    file: String,
    line: usize,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenCaptureResult {
    path: String,
    width: u32,
    height: u32,
    created_at: String,
}

#[derive(Serialize, Clone)]
struct LauncherIndexItem {
    id: String,
    label: String,
    description: String,
    kind: String,
    value: String,
}

const MAX_TREE_DEPTH: usize = 3;
const MAX_CHILDREN: usize = 200;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_COMMAND_OUTPUT_BYTES: usize = 128 * 1024;
const MAX_FETCH_BYTES: u64 = 2 * 1024 * 1024;
const MAX_AVATAR_BYTES: u64 = 8 * 1024 * 1024;
const MAX_PROJECT_SEARCH_FILE_BYTES: u64 = 1024 * 1024;
const MAX_PROJECT_SEARCH_FILES: usize = 2500;
static RUNNING_COMMAND_PID: Mutex<Option<u32>> = Mutex::new(None);
static RUNNING_COMMAND_META: Mutex<Option<CommandJobState>> = Mutex::new(None);
static CANCELLED_COMMAND_PID: Mutex<Option<u32>> = Mutex::new(None);

fn unix_timestamp_ms() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

fn command_is_permanently_blocked(command: &str) -> bool {
    let normalized = command.to_lowercase();
    let compact = normalized.split_whitespace().collect::<Vec<_>>().join(" ");
    compact.contains("diskpart")
        || compact.starts_with("format ")
        || compact.contains("set-mppreference") && compact.contains("disable")
        || compact.contains("disablerealtimemonitoring")
        || compact.contains("mimikatz")
        || compact.contains("procdump") && compact.contains("lsass")
        || compact.contains("password dump")
        || compact.contains("credential dump")
        || compact.contains("del c:\\windows")
        || compact.contains("remove-item c:\\windows")
        || compact.contains("rmdir /s c:\\")
        || compact.contains("invoke-webrequest") && compact.contains("invoke-expression")
        || compact.contains("curl ") && (compact.contains("| powershell") || compact.contains("| pwsh") || compact.contains("| cmd"))
        || (compact.contains("powershell") || compact.contains("pwsh") || compact.contains("start-process")) && compact.contains("windowstyle hidden")
        || (compact.contains("wscript.exe") || compact.contains("cscript.exe")) && compact.contains("/b")
}

fn supertonic_synthesize_blocking(text: String, voice: String, speed: f64) -> Result<String, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("There is no text to speak.".into());
    }
    if trimmed.chars().count() > 1_200 {
        return Err("Supertonic replies are limited to 1,200 characters.".into());
    }
    let allowed_voices = ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"];
    if !allowed_voices.contains(&voice.as_str()) {
        return Err("Unknown Supertonic voice.".into());
    }

    let local_app_data = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "Windows local application data is unavailable.".to_string())?;
    let python = local_app_data
        .join("Nebula")
        .join("runtimes")
        .join("supertonic")
        .join("Scripts")
        .join("python.exe");
    if !python.is_file() {
        return Err("Supertonic is not installed. Choose Nebula Neural or a Windows voice instead.".into());
    }

    let output_path = std::env::temp_dir().join(format!("nebula-supertonic-{}.wav", uuid::Uuid::new_v4()));
    let script = "from supertonic import TTS; import sys; t=TTS(auto_download=True); w,_=t.synthesize(sys.argv[1],t.get_voice_style(sys.argv[2]),total_steps=8,speed=float(sys.argv[3]),lang='en'); t.save_audio(w,sys.argv[4])";
    let speed_arg = speed.clamp(0.7, 1.3).to_string();
    let output_arg = output_path.to_string_lossy().to_string();
    let mut child = Command::new(&python)
        .args([
            "-c",
            script,
            trimmed,
            &voice,
            &speed_arg,
            &output_arg,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Supertonic could not start: {error}"))?;

    let started = std::time::Instant::now();
    let timed_out = loop {
        if child.try_wait().map_err(|error| error.to_string())?.is_some() {
            break false;
        }
        if started.elapsed() >= Duration::from_secs(180) {
            let _ = child.kill();
            break true;
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let output = child.wait_with_output().map_err(|error| error.to_string())?;
    if timed_out {
        let _ = fs::remove_file(&output_path);
        return Err("Supertonic took too long to generate speech.".into());
    }
    if !output.status.success() {
        let details = truncate_bytes(&output.stderr, 2_000);
        let _ = fs::remove_file(&output_path);
        return Err(if details.trim().is_empty() {
            "Supertonic could not generate speech.".into()
        } else {
            format!("Supertonic could not generate speech: {details}")
        });
    }

    let audio = fs::read(&output_path).map_err(|error| format!("Supertonic audio could not be read: {error}"))?;
    let _ = fs::remove_file(&output_path);
    Ok(general_purpose::STANDARD.encode(audio))
}

#[tauri::command]
async fn supertonic_synthesize(text: String, voice: String, speed: f64) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || supertonic_synthesize_blocking(text, voice, speed))
        .await
        .map_err(|error| error.to_string())?
}

fn memory_path(memory_folder: &str, file: &str) -> Result<PathBuf, String> {
    let allowed = [
        "user.md",
        "projects.md",
        "web_learnings.md",
        "pc_fixes.md",
        "lessons_learned.md",
        "commands.md",
        "preferences.md",
    ];

    if !allowed.contains(&file) {
        return Err("Memory file is not allowed.".into());
    }

    Ok(resolve_local_path(memory_folder).join(file))
}

fn resolve_local_path(path: &str) -> PathBuf {
    let input = PathBuf::from(path);
    if input.is_absolute() {
        return input;
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(input)
}

fn validate_user_path(path: &Path, write: bool) -> Result<PathBuf, String> {
    let target = if path.is_absolute() {
        path.to_path_buf()
    } else {
        resolve_local_path(&path.to_string_lossy())
    };

    let check_path = if write {
        target.parent().unwrap_or(&target)
    } else {
        target.as_path()
    };

    let canonical = check_path
        .canonicalize()
        .map_err(|error| format!("Path is unavailable: {}", error))?;
    let lower = canonical.to_string_lossy().to_lowercase();

    #[cfg(target_os = "windows")]
    {
        let blocked = [
            "c:\\windows",
            "c:\\program files",
            "c:\\program files (x86)",
            "c:\\programdata\\microsoft",
        ];
        if blocked.iter().any(|prefix| lower.starts_with(prefix)) {
            return Err("Blocked protected system path.".into());
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let blocked = [
            "/bin", "/boot", "/dev", "/etc", "/lib", "/proc", "/root", "/sbin", "/sys", "/usr",
        ];
        if blocked
            .iter()
            .any(|prefix| lower == *prefix || lower.starts_with(&format!("{}/", prefix)))
        {
            return Err("Blocked protected system path.".into());
        }
    }

    Ok(target)
}

fn truncate_bytes(bytes: &[u8], max: usize) -> String {
    let mut text = String::from_utf8_lossy(&bytes[..bytes.len().min(max)]).to_string();
    if bytes.len() > max {
        text.push_str("\n...[truncated]");
    }
    text
}

fn is_safe_fetch_url(url: &reqwest::Url) -> bool {
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return false;
    }

    let Some(host) = url.host_str().map(|host| host.to_lowercase()) else {
        return false;
    };

    if host == "localhost" || host == "0.0.0.0" || host == "::1" || host.ends_with(".local") {
        return false;
    }

    if host.starts_with("127.")
        || host.starts_with("10.")
        || host.starts_with("192.168.")
        || host.starts_with("169.254.")
    {
        return false;
    }

    if host.starts_with("172.")
        && host
            .split('.')
            .nth(1)
            .and_then(|part| part.parse::<u8>().ok())
            .map(|octet| (16..=31).contains(&octet))
            .unwrap_or(false)
    {
        return false;
    }

    let path = url.path().to_lowercase();
    ![
        ".exe", ".msi", ".bat", ".cmd", ".ps1", ".zip", ".7z", ".rar", ".tar", ".gz", ".dmg",
        ".pkg",
    ]
    .iter()
    .any(|suffix| path.ends_with(suffix))
}

fn build_tree(path: &Path, depth: usize) -> Result<Vec<FileNode>, String> {
    if depth > MAX_TREE_DEPTH {
        return Ok(vec![]);
    }

    let mut entries: Vec<_> = fs::read_dir(path)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .take(MAX_CHILDREN)
        .collect();

    entries.sort_by_key(|entry| entry.path());

    let mut nodes = Vec::new();
    for entry in entries {
        let path = entry.path();
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let is_dir = metadata.is_dir();
        let name = entry.file_name().to_string_lossy().to_string();

        if name == "node_modules" || name == ".git" || name == "target" || name == "dist" {
            continue;
        }

        nodes.push(FileNode {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir,
            children: if is_dir {
                Some(build_tree(&path, depth + 1)?)
            } else {
                None
            },
        });
    }

    Ok(nodes)
}

#[tauri::command]
fn pick_project_folder() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn list_files(path: String) -> Result<Vec<FileNode>, String> {
    let target = validate_user_path(Path::new(&path), false)?;
    build_tree(&target, 0)
}

fn should_skip_project_search_dir(name: &str) -> bool {
    matches!(
        name.to_lowercase().as_str(),
        ".git"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | "coverage"
            | ".next"
            | ".turbo"
            | ".cache"
    )
}

fn is_searchable_project_file(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    if matches!(
        name.to_lowercase().as_str(),
        "readme" | "license" | "dockerfile" | "makefile"
    ) {
        return true;
    }
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_lowercase()
            .as_str(),
        "ts" | "tsx"
            | "js"
            | "jsx"
            | "mjs"
            | "cjs"
            | "rs"
            | "py"
            | "json"
            | "md"
            | "txt"
            | "css"
            | "html"
            | "htm"
            | "yml"
            | "yaml"
            | "toml"
            | "xml"
            | "sh"
            | "ps1"
            | "bat"
            | "cmd"
            | "java"
            | "cs"
            | "go"
            | "cpp"
            | "c"
            | "h"
            | "hpp"
            | "sql"
    )
}

fn compact_search_line(line: &str) -> String {
    let compact = line.trim().replace('\t', "    ");
    if compact.chars().count() > 360 {
        format!("{}...", compact.chars().take(357).collect::<String>())
    } else {
        compact
    }
}

#[tauri::command]
fn search_project_files(
    path: String,
    query: String,
    max_results: Option<usize>,
) -> Result<Vec<ProjectSearchResult>, String> {
    let root = validate_user_path(Path::new(&path), false)?;
    if !root.is_dir() {
        return Err("Project search requires a folder.".into());
    }
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let max_results = max_results.unwrap_or(80).clamp(1, 200);
    let mut folders = VecDeque::from([root]);
    let mut results = Vec::new();
    let mut files_scanned = 0usize;

    while let Some(folder) = folders.pop_front() {
        if files_scanned >= MAX_PROJECT_SEARCH_FILES || results.len() >= max_results {
            break;
        }
        let entries = match fs::read_dir(&folder) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.filter_map(Result::ok) {
            if files_scanned >= MAX_PROJECT_SEARCH_FILES || results.len() >= max_results {
                break;
            }
            let entry_path = entry.path();
            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            if metadata.is_dir() {
                if !should_skip_project_search_dir(&entry.file_name().to_string_lossy()) {
                    folders.push_back(entry_path);
                }
                continue;
            }
            if !metadata.is_file()
                || metadata.len() > MAX_PROJECT_SEARCH_FILE_BYTES
                || !is_searchable_project_file(&entry_path)
            {
                continue;
            }
            files_scanned += 1;
            let content = match fs::read_to_string(&entry_path) {
                Ok(content) => content,
                Err(_) => continue,
            };
            for (index, line) in content.lines().enumerate() {
                let normalized = line.to_lowercase();
                let match_count = normalized.matches(&needle).count();
                if match_count == 0 {
                    continue;
                }
                results.push(ProjectSearchResult {
                    path: entry_path.to_string_lossy().to_string(),
                    line: index + 1,
                    text: compact_search_line(line),
                    match_count,
                });
                if results.len() >= max_results {
                    break;
                }
            }
        }
    }

    Ok(results)
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    let target = validate_user_path(Path::new(&path), false)?;
    fs::read_to_string(target).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_avatar_image(path: String) -> Result<String, String> {
    let target = validate_user_path(Path::new(&path), false)?;
    let metadata = fs::metadata(&target).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Avatar path is not a file.".into());
    }
    if metadata.len() > MAX_AVATAR_BYTES {
        return Err("Avatar image is too large. Please use an image under 8 MB.".into());
    }

    let extension = target
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        _ => return Err("Unsupported avatar image type. Use PNG, JPG, WEBP, GIF, or BMP.".into()),
    };

    let bytes = fs::read(target).map_err(|error| error.to_string())?;
    Ok(format!(
        "data:{};base64,{}",
        mime,
        general_purpose::STANDARD.encode(bytes)
    ))
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    let target = validate_user_path(Path::new(&path), true)?;
    fs::write(target, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn create_file(path: String, content: String) -> Result<(), String> {
    let target = validate_user_path(Path::new(&path), true)?;
    if target.exists() {
        return Err("File already exists.".into());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(target, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn append_file(path: String, content: String) -> Result<(), String> {
    use std::io::Write;
    let target = validate_user_path(Path::new(&path), true)?;
    let mut file = fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(target)
        .map_err(|error| error.to_string())?;
    file.write_all(content.as_bytes())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn ensure_memory(memory_folder: String, files: Vec<String>) -> Result<(), String> {
    fs::create_dir_all(resolve_local_path(&memory_folder)).map_err(|error| error.to_string())?;
    for file in files {
        let path = memory_path(&memory_folder, &file)?;
        if !path.exists() {
            fs::write(path, format!("# {}\n", file)).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn read_memory(memory_folder: String, file: String) -> Result<String, String> {
    fs::read_to_string(memory_path(&memory_folder, &file)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn append_memory(memory_folder: String, file: String, content: String) -> Result<(), String> {
    append_file(
        memory_path(&memory_folder, &file)?
            .to_string_lossy()
            .to_string(),
        content,
    )
}

#[tauri::command]
fn write_memory(memory_folder: String, file: String, content: String) -> Result<(), String> {
    fs::write(memory_path(&memory_folder, &file)?, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn search_memory(memory_folder: String, query: String) -> Result<Vec<MemorySearchResult>, String> {
    let mut results = Vec::new();
    let query_lower = query.to_lowercase();
    for entry in
        fs::read_dir(resolve_local_path(&memory_folder)).map_err(|error| error.to_string())?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let file = entry.file_name().to_string_lossy().to_string();
        if !file.ends_with(".md") {
            continue;
        }
        let content = fs::read_to_string(entry.path()).unwrap_or_default();
        for (index, line) in content.lines().enumerate() {
            if line.to_lowercase().contains(&query_lower) {
                results.push(MemorySearchResult {
                    file: file.clone(),
                    line: index + 1,
                    text: line.to_string(),
                });
            }
        }
    }
    Ok(results.into_iter().take(40).collect())
}

fn run_command_blocking(command: String, cwd: String) -> Result<CommandOutput, String> {
    if command.trim().is_empty() {
        return Err("Command is empty.".into());
    }
    if command_is_permanently_blocked(&command) {
        return Err("Command blocked by Nebula's permanent catastrophic-action guard.".into());
    }

    let working_dir = if cwd.is_empty() {
        PathBuf::from(".")
    } else {
        PathBuf::from(&cwd)
    };
    if !working_dir.exists() {
        return Err(format!(
            "Working directory does not exist: {}",
            working_dir.to_string_lossy()
        ));
    }

    {
        let guard = RUNNING_COMMAND_PID
            .lock()
            .map_err(|_| "Command runner state is unavailable.".to_string())?;
        if guard.is_some() {
            return Err(
                "A command is already running. Stop it before starting another command.".into(),
            );
        }
    }

    let mut command_builder = if cfg!(target_os = "windows") {
        let mut builder = Command::new("cmd");
        builder.args(["/C", &command]);
        builder
    } else {
        let mut builder = Command::new("sh");
        builder.args(["-c", &command]);
        builder
    };

    let mut child = command_builder
        .current_dir(&working_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    let pid = child.id();

    {
        let mut guard = RUNNING_COMMAND_PID
            .lock()
            .map_err(|_| "Command runner state is unavailable.".to_string())?;
        *guard = Some(pid);
    }

    let started = std::time::Instant::now();
    let timed_out = loop {
        if child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            break false;
        }
        if started.elapsed() >= COMMAND_TIMEOUT {
            let _ = child.kill();
            break true;
        }
        std::thread::sleep(Duration::from_millis(120));
    };

    let output_result = child.wait_with_output();

    {
        let mut guard = RUNNING_COMMAND_PID
            .lock()
            .map_err(|_| "Command runner state is unavailable.".to_string())?;
        if *guard == Some(pid) {
            *guard = None;
        }
    }

    let output = output_result.map_err(|error| error.to_string())?;
    let mut stderr = truncate_bytes(&output.stderr, MAX_COMMAND_OUTPUT_BYTES);
    if timed_out {
        if !stderr.is_empty() {
            stderr.push('\n');
        }
        stderr.push_str("Command timed out after 90 seconds.");
    }

    Ok(CommandOutput {
        code: output.status.code(),
        stdout: truncate_bytes(&output.stdout, MAX_COMMAND_OUTPUT_BYTES),
        stderr,
        job_id: None,
        truncated: output.stdout.len() > MAX_COMMAND_OUTPUT_BYTES || output.stderr.len() > MAX_COMMAND_OUTPUT_BYTES,
    })
}

#[tauri::command]
async fn run_command(command: String, cwd: String) -> Result<CommandOutput, String> {
    tauri::async_runtime::spawn_blocking(move || run_command_blocking(command, cwd))
        .await
        .map_err(|error| error.to_string())?
}

fn append_command_output(target: &Arc<Mutex<String>>, line: &str, truncated: &Arc<Mutex<bool>>) {
    if let Ok(mut output) = target.lock() {
        if output.len() >= MAX_COMMAND_OUTPUT_BYTES {
            if let Ok(mut flag) = truncated.lock() { *flag = true; }
            return;
        }
        let remaining = MAX_COMMAND_OUTPUT_BYTES - output.len();
        if line.len() > remaining {
            let boundary = line
                .char_indices()
                .map(|(index, _)| index)
                .take_while(|index| *index <= remaining)
                .last()
                .unwrap_or(0);
            output.push_str(&line[..boundary]);
            if let Ok(mut flag) = truncated.lock() { *flag = true; }
        } else {
            output.push_str(line);
        }
    }
}

fn emit_command_event(app: &AppHandle, event: CommandEvent) {
    let _ = app.emit("nebula-command-event", event);
}

#[tauri::command]
fn start_command(app: AppHandle, job_id: String, command: String, cwd: String) -> Result<CommandJobState, String> {
    if job_id.trim().is_empty() || command.trim().is_empty() {
        return Err("Command job id and command are required.".into());
    }
    if command_is_permanently_blocked(&command) {
        return Err("Command blocked by Nebula's permanent catastrophic-action guard.".into());
    }
    let working_dir = if cwd.trim().is_empty() { PathBuf::from(".") } else { PathBuf::from(&cwd) };
    if !working_dir.exists() {
        return Err(format!("Working directory does not exist: {}", working_dir.to_string_lossy()));
    }
    {
        let guard = RUNNING_COMMAND_PID.lock().map_err(|_| "Command runner state is unavailable.".to_string())?;
        if guard.is_some() {
            return Err("A command is already running. Stop it before starting another command.".into());
        }
    }

    let mut command_builder = if cfg!(target_os = "windows") {
        let mut builder = Command::new("cmd");
        builder.args(["/C", &command]);
        builder
    } else {
        let mut builder = Command::new("sh");
        builder.args(["-c", &command]);
        builder
    };
    let mut child = command_builder
        .current_dir(&working_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Command could not start: {error}"))?;
    let pid = child.id();
    let started_at = unix_timestamp_ms();
    let state = CommandJobState {
        id: job_id.clone(),
        command: command.clone(),
        cwd: working_dir.to_string_lossy().to_string(),
        pid,
        status: "running".into(),
        started_at: started_at.clone(),
    };
    *RUNNING_COMMAND_PID.lock().map_err(|_| "Command runner state is unavailable.".to_string())? = Some(pid);
    *RUNNING_COMMAND_META.lock().map_err(|_| "Command runner state is unavailable.".to_string())? = Some(state.clone());
    *CANCELLED_COMMAND_PID.lock().map_err(|_| "Command runner state is unavailable.".to_string())? = None;

    emit_command_event(&app, CommandEvent {
        job_id: job_id.clone(), event_type: "started".into(), stream: Some("system".into()),
        data: Some(format!("{command}\n")), code: None, created_at: started_at, truncated: false,
    });

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_text = Arc::new(Mutex::new(String::new()));
    let stderr_text = Arc::new(Mutex::new(String::new()));
    let truncated = Arc::new(Mutex::new(false));

    let spawn_reader = |reader: Option<std::process::ChildStdout>, stream: &'static str, target: Arc<Mutex<String>>| {
        let app = app.clone();
        let job_id = job_id.clone();
        let truncated = truncated.clone();
        reader.map(|pipe| std::thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                let line = format!("{line}\n");
                append_command_output(&target, &line, &truncated);
                emit_command_event(&app, CommandEvent {
                    job_id: job_id.clone(), event_type: "output".into(), stream: Some(stream.into()),
                    data: Some(line), code: None, created_at: unix_timestamp_ms(),
                    truncated: truncated.lock().map(|value| *value).unwrap_or(false),
                });
            }
        }))
    };
    let stdout_thread = spawn_reader(stdout, "stdout", stdout_text.clone());
    let stderr_thread = stderr.map(|pipe| {
        let app = app.clone();
        let job_id = job_id.clone();
        let target = stderr_text.clone();
        let truncated = truncated.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                let line = format!("{line}\n");
                append_command_output(&target, &line, &truncated);
                emit_command_event(&app, CommandEvent {
                    job_id: job_id.clone(), event_type: "output".into(), stream: Some("stderr".into()),
                    data: Some(line), code: None, created_at: unix_timestamp_ms(),
                    truncated: truncated.lock().map(|value| *value).unwrap_or(false),
                });
            }
        })
    });

    let worker_app = app.clone();
    let worker_job_id = job_id.clone();
    std::thread::spawn(move || {
        let started = std::time::Instant::now();
        let (status, code) = loop {
            match child.try_wait() {
                Ok(Some(status)) => break ("completed", status.code()),
                Ok(None) if started.elapsed() >= COMMAND_TIMEOUT => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break ("timed_out", None);
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(_) => break ("error", None),
            }
        };
        if let Some(thread) = stdout_thread { let _ = thread.join(); }
        if let Some(thread) = stderr_thread { let _ = thread.join(); }
        let cancelled = CANCELLED_COMMAND_PID.lock().map(|value| *value == Some(pid)).unwrap_or(false);
        let final_type = if cancelled { "cancelled" } else { status };
        let out = stdout_text.lock().map(|value| value.clone()).unwrap_or_default();
        let err = stderr_text.lock().map(|value| value.clone()).unwrap_or_default();
        let was_truncated = truncated.lock().map(|value| *value).unwrap_or(false);
        emit_command_event(&worker_app, CommandEvent {
            job_id: worker_job_id,
            event_type: final_type.into(),
            stream: Some("system".into()),
            data: Some(serde_json::json!({"stdout":out,"stderr":err}).to_string()),
            code,
            created_at: unix_timestamp_ms(),
            truncated: was_truncated,
        });
        if let Ok(mut value) = RUNNING_COMMAND_PID.lock() { if *value == Some(pid) { *value = None; } }
        if let Ok(mut value) = RUNNING_COMMAND_META.lock() { if value.as_ref().is_some_and(|item| item.pid == pid) { *value = None; } }
        if let Ok(mut value) = CANCELLED_COMMAND_PID.lock() { if *value == Some(pid) { *value = None; } }
    });

    Ok(state)
}

#[tauri::command]
fn command_health() -> Result<Option<CommandJobState>, String> {
    RUNNING_COMMAND_META.lock().map(|value| value.clone()).map_err(|_| "Command runner state is unavailable.".to_string())
}

#[tauri::command]
fn stop_running_command() -> Result<(), String> {
    let pid = {
        let guard = RUNNING_COMMAND_PID
            .lock()
            .map_err(|_| "Command runner state is unavailable.".to_string())?;
        *guard
    };

    let Some(pid) = pid else {
        return Ok(());
    };
    if let Ok(mut cancelled) = CANCELLED_COMMAND_PID.lock() { *cancelled = Some(pid); }

    let output = if cfg!(target_os = "windows") {
        Command::new("taskkill.exe")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output()
            .map_err(|error| error.to_string())?
    } else {
        Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output()
            .map_err(|error| error.to_string())?
    };

    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !message.is_empty() {
            return Err(message);
        }
    }

    Ok(())
}

#[tauri::command]
fn get_system_info() -> Result<String, String> {
    Ok(format!(
        "OS: {}\nArchitecture: {}\nCurrent dir: {}",
        std::env::consts::OS,
        std::env::consts::ARCH,
        std::env::current_dir()
            .map_err(|error| error.to_string())?
            .to_string_lossy()
    ))
}

#[tauri::command]
fn get_resource_snapshot() -> Result<String, String> {
    let script = r#"
$nebulaPid = __PID__
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average
$gpu = Get-CimInstance Win32_VideoController | Select-Object -First 1
$systemDrive = $env:SystemDrive
$disk = if ($systemDrive) { Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$systemDrive'" -ErrorAction SilentlyContinue } else { $null }
$proc = Get-Process -Id $nebulaPid -ErrorAction SilentlyContinue
$vram = $null
if ($gpu -and $gpu.AdapterRAM) {
  $vram = [math]::Round([double]$gpu.AdapterRAM / 1MB, 0)
}
[pscustomobject]@{
  checkedAt = (Get-Date).ToString("o")
  cpuLoadPercent = if ($cpu -and $null -ne $cpu.Average) { [math]::Round([double]$cpu.Average, 0) } else { $null }
  ramTotalMb = [math]::Round([double]$os.TotalVisibleMemorySize / 1024, 0)
  ramAvailableMb = [math]::Round([double]$os.FreePhysicalMemory / 1024, 0)
  processWorkingSetMb = if ($proc) { [math]::Round([double]$proc.WorkingSet64 / 1MB, 1) } else { $null }
  systemDrive = $systemDrive
  systemDriveTotalMb = if ($disk) { [math]::Round([double]$disk.Size / 1MB, 0) } else { $null }
  systemDriveFreeMb = if ($disk) { [math]::Round([double]$disk.FreeSpace / 1MB, 0) } else { $null }
  gpuName = if ($gpu) { $gpu.Name } else { $null }
  vramTotalMb = $vram
  vramNote = "Windows WMI AdapterRAM can under-report some GPUs; use AMD Adrenalin/GPU-Z for the final VRAM truth."
} | ConvertTo-Json -Compress
"#
    .replace("__PID__", &std::process::id().to_string());

    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
fn capture_screen() -> Result<ScreenCaptureResult, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let path = std::env::temp_dir().join(format!("nebula-screen-{}.png", timestamp));
    let path_for_script = path.to_string_lossy().replace('\'', "''");
    let script = format!(
        r#"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save('{path}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
Write-Output "$($bounds.Width)x$($bounds.Height)"
"#,
        path = path_for_script
    );

    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let dimensions = stdout
        .lines()
        .find_map(|line| line.trim().split_once('x'))
        .ok_or_else(|| "Screen capture succeeded but dimensions were not reported.".to_string())?;
    let width = dimensions
        .0
        .trim()
        .parse::<u32>()
        .map_err(|error| error.to_string())?;
    let height = dimensions
        .1
        .trim()
        .parse::<u32>()
        .map_err(|error| error.to_string())?;

    Ok(ScreenCaptureResult {
        path: path.to_string_lossy().to_string(),
        width,
        height,
        created_at: timestamp.to_string(),
    })
}

#[tauri::command]
fn sleep_pc() -> Result<(), String> {
    Command::new("rundll32.exe")
        .args(["powrprof.dll,SetSuspendState", "0,1,0"])
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_installed_apps() -> Result<Vec<InstalledAppRecord>, String> {
    let mut apps = vec![
        InstalledAppRecord { id: "built-in:notepad".into(), name: "Notepad".into(), path: "notepad.exe".into(), source: "built_in".into(), aliases: vec!["notepad".into(), "text editor".into()] },
        InstalledAppRecord { id: "built-in:calculator".into(), name: "Calculator".into(), path: "calc.exe".into(), source: "built_in".into(), aliases: vec!["calculator".into(), "calc".into()] },
        InstalledAppRecord { id: "built-in:explorer".into(), name: "File Explorer".into(), path: "explorer.exe".into(), source: "built_in".into(), aliases: vec!["explorer".into(), "file explorer".into(), "files".into()] },
        InstalledAppRecord { id: "built-in:cmd".into(), name: "Command Prompt".into(), path: "cmd.exe".into(), source: "built_in".into(), aliases: vec!["cmd".into(), "command prompt".into()] },
        InstalledAppRecord { id: "built-in:powershell".into(), name: "PowerShell".into(), path: "powershell.exe".into(), source: "built_in".into(), aliases: vec!["powershell".into(), "terminal".into()] },
        InstalledAppRecord { id: "built-in:settings".into(), name: "Windows Settings".into(), path: "ms-settings:".into(), source: "built_in".into(), aliases: vec!["settings".into(), "windows settings".into()] },
    ];

    let mut roots = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        roots.push(PathBuf::from(appdata).join("Microsoft").join("Windows").join("Start Menu").join("Programs"));
    }
    if let Ok(program_data) = std::env::var("PROGRAMDATA") {
        roots.push(PathBuf::from(program_data).join("Microsoft").join("Windows").join("Start Menu").join("Programs"));
    }

    fn collect_start_menu(path: &Path, apps: &mut Vec<InstalledAppRecord>, depth: usize) {
        if depth > 5 || apps.len() >= 1200 { return; }
        let Ok(entries) = fs::read_dir(path) else { return; };
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_dir() {
                collect_start_menu(&path, apps, depth + 1);
                continue;
            }
            let extension = path.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase();
            if extension != "lnk" && extension != "exe" { continue; }
            let Some(name) = path.file_stem().and_then(|value| value.to_str()).map(str::trim).filter(|value| !value.is_empty()) else { continue; };
            let lower = name.to_ascii_lowercase();
            if lower.contains("uninstall") || lower.contains("readme") { continue; }
            apps.push(InstalledAppRecord {
                id: format!("start-menu:{}", path.to_string_lossy()),
                name: name.to_string(),
                path: path.to_string_lossy().to_string(),
                source: "start_menu".into(),
                aliases: vec![lower],
            });
        }
    }
    for root in roots { collect_start_menu(&root, &mut apps, 0); }

    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        let lm_studio = PathBuf::from(local_appdata).join("Programs").join("LM Studio").join("LM Studio.exe");
        if lm_studio.is_file() {
            apps.push(InstalledAppRecord { id: "detected:lm-studio".into(), name: "LM Studio".into(), path: lm_studio.to_string_lossy().to_string(), source: "built_in".into(), aliases: vec!["lm studio".into(), "lmstudio".into()] });
        }
    }

    let mut seen = HashSet::new();
    apps.retain(|app| seen.insert(format!("{}|{}", app.name.to_ascii_lowercase(), app.path.to_ascii_lowercase())));
    apps.sort_by(|left, right| left.name.to_ascii_lowercase().cmp(&right.name.to_ascii_lowercase()));
    Ok(apps)
}

fn launch_installed_app(app: &InstalledAppRecord) -> Result<(), String> {
    if app.path == "ms-settings:" {
        return Command::new("explorer.exe").arg(&app.path).spawn().map(|_| ()).map_err(|error| error.to_string());
    }
    let path = PathBuf::from(&app.path);
    if path.extension().and_then(|value| value.to_str()).is_some_and(|value| value.eq_ignore_ascii_case("lnk")) {
        return Command::new("explorer.exe").arg(&app.path).spawn().map(|_| ()).map_err(|error| error.to_string());
    }
    Command::new(&app.path).spawn().map(|_| ()).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_app(app: String) -> Result<(), String> {
    let query = app.trim().to_ascii_lowercase();
    if query.is_empty() { return Err("App name is empty.".into()); }
    let apps = list_installed_apps()?;
    let mut exact = apps.iter().filter(|candidate| {
        candidate.name.eq_ignore_ascii_case(&query) || candidate.aliases.iter().any(|alias| alias.eq_ignore_ascii_case(&query))
    }).collect::<Vec<_>>();
    if exact.is_empty() {
        exact = apps.iter().filter(|candidate| candidate.name.to_ascii_lowercase().contains(&query)).collect();
    }
    if exact.len() > 1 {
        let names = exact.iter().take(6).map(|candidate| candidate.name.as_str()).collect::<Vec<_>>().join(", ");
        return Err(format!("More than one installed app matches '{app}': {names}. Use a more specific name."));
    }
    if let Some(found) = exact.first() { return launch_installed_app(found); }

    let explicit = PathBuf::from(app.trim());
    let extension = explicit.extension().and_then(|value| value.to_str()).unwrap_or_default();
    if explicit.is_file() && ["exe", "lnk"].iter().any(|allowed| extension.eq_ignore_ascii_case(allowed)) {
        return launch_installed_app(&InstalledAppRecord { id: "explicit".into(), name: explicit.file_stem().unwrap_or_default().to_string_lossy().to_string(), path: explicit.to_string_lossy().to_string(), source: "custom".into(), aliases: vec![] });
    }
    Err(format!("Nebula could not find an installed app matching '{app}'."))
}

#[tauri::command]
  fn open_known_app(app: String) -> Result<(), String> {
      open_app(app)
  }

  #[tauri::command]
  fn open_windows_settings() -> Result<(), String> {
      Command::new("explorer.exe")
          .arg("ms-settings:")
          .spawn()
          .map_err(|error| format!("Could not open Windows Settings: {error}"))?;
      Ok(())
  }

#[tauri::command]
fn open_voice_privacy_settings(kind: String) -> Result<(), String> {
    let uri = match kind.as_str() {
        "microphone" => "ms-settings:privacy-microphone",
        "speech" => "ms-settings:privacy-speechtyping",
        _ => return Err("Unknown voice privacy settings page.".into()),
    };

    Command::new("explorer.exe")
        .arg(uri)
        .spawn()
        .map_err(|error| format!("Could not open Windows voice settings: {error}"))?;
    Ok(())
}

#[tauri::command]
fn open_path_in_explorer(path: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    if target.is_file() {
        Command::new("explorer.exe")
            .arg(format!("/select,{}", target.to_string_lossy()))
            .spawn()
            .map_err(|error| error.to_string())?;
    } else {
        Command::new("explorer.exe")
            .arg(target.to_string_lossy().to_string())
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn show_tray_notification(title: String, body: String) -> Result<(), String> {
    println!("Nebula notification: {} - {}", title, body);
    Ok(())
}

fn lmstudio_api_base(endpoint: &str) -> String {
    let endpoint = endpoint.trim().trim_end_matches('/');

    for suffix in ["/v1/chat/completions", "/v1/responses", "/v1"] {
        if let Some(base) = endpoint.strip_suffix(suffix) {
            return format!("{}/api/v1", base.trim_end_matches('/'));
        }
    }

    if endpoint.ends_with("/api/v1") {
        endpoint.to_string()
    } else {
        format!("{}/api/v1", endpoint)
    }
}

#[tauri::command]
fn lmstudio_list_models(endpoint: String) -> Result<String, String> {
    let url = format!("{}/models", lmstudio_api_base(&endpoint));
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| error.to_string())?
        .get(url)
        .send()
        .map_err(|error| error.to_string())?
        .text()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn lmstudio_load_model(
    endpoint: String,
    model: String,
    context_length: Option<u32>,
) -> Result<String, String> {
    let url = format!("{}/models/load", lmstudio_api_base(&endpoint));
    let body = serde_json::json!({
        "model": model,
        "context_length": context_length.unwrap_or(4096),
        "parallel": 1,
        "flash_attention": true,
        "offload_kv_cache_to_gpu": true,
        "echo_load_config": true
    });
    let response = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| error.to_string())?
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body.to_string())
        .send()
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Err(format!("LM Studio load failed: {}", response.status()));
    }

    response.text().map_err(|error| error.to_string())
}

#[tauri::command]
async fn lmstudio_chat_completion(
    endpoint: String,
    body: String,
    timeout_secs: Option<u64>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let parsed_body: serde_json::Value = serde_json::from_str(&body)
            .map_err(|error| format!("Invalid LM Studio request JSON: {}", error))?;
        let timeout = timeout_secs.unwrap_or(120).clamp(5, 300);
        let response = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(timeout))
            .build()
            .map_err(|error| error.to_string())?
            .post(endpoint)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(parsed_body.to_string())
            .send()
            .map_err(|error| format!("LM Studio connection failed: {}", error))?;

        let status = response.status();
        let text = response.text().map_err(|error| error.to_string())?;
        if !status.is_success() {
            return Err(format!("LM Studio request failed: {} - {}", status, text));
        }

        Ok(text)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn collect_launcher_items(
    path: &Path,
    depth: usize,
    items: &mut Vec<LauncherIndexItem>,
) -> Result<(), String> {
    if depth > 3 || items.len() >= 300 {
        return Ok(());
    }

    for entry in fs::read_dir(path)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
    {
        if items.len() >= 300 {
            break;
        }
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "node_modules" || name == ".git" || name == "target" || name == "dist" {
            continue;
        }
        if entry_path.is_dir() {
            collect_launcher_items(&entry_path, depth + 1, items)?;
        } else {
            items.push(LauncherIndexItem {
                id: format!("file:{}", entry_path.to_string_lossy()),
                label: name,
                description: entry_path.to_string_lossy().to_string(),
                kind: "file".into(),
                value: entry_path.to_string_lossy().to_string(),
            });
        }
    }

    Ok(())
}

#[tauri::command]
fn launcher_index_folder(path: String) -> Result<Vec<LauncherIndexItem>, String> {
    let mut items = Vec::new();
    collect_launcher_items(Path::new(&path), 0, &mut items)?;
    Ok(items)
}

#[tauri::command]
fn launcher_search(query: String, folders: Vec<String>) -> Result<Vec<LauncherIndexItem>, String> {
    let needle = query.to_lowercase();
    let mut items = Vec::new();
    for folder in folders {
        let _ = collect_launcher_items(Path::new(&folder), 0, &mut items);
    }
    Ok(items
        .into_iter()
        .filter(|item| {
            item.label.to_lowercase().contains(&needle)
                || item.description.to_lowercase().contains(&needle)
        })
        .take(80)
        .collect())
}

#[tauri::command]
fn web_fetch_text(url: String) -> Result<String, String> {
    let mut current_url = reqwest::Url::parse(&url).map_err(|error| error.to_string())?;
    if !is_safe_fetch_url(&current_url) {
        return Err(
            "Blocked private, local, non-http(s), credentialed, or downloadable URL.".into(),
        );
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Nebula/0.1 safe-web-fetch")
        .build()
        .map_err(|error| error.to_string())?;

    for _ in 0..5 {
        let response = client
            .get(current_url.clone())
            .header(
                reqwest::header::ACCEPT,
                "text/html,text/plain;q=0.9,application/json;q=0.7,application/xml;q=0.6",
            )
            .send()
            .map_err(|error| error.to_string())?;

        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "Redirect missing Location header.".to_string())?;
            current_url = current_url
                .join(location)
                .map_err(|error| error.to_string())?;
            if !is_safe_fetch_url(&current_url) {
                return Err("Blocked redirect to private, local, non-http(s), credentialed, or downloadable URL.".into());
            }
            continue;
        }

        let status = response.status();
        if !status.is_success() {
            return Err(format!("Fetch failed: {}", status));
        }

        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_lowercase();

        if !content_type.contains("text")
            && !content_type.contains("html")
            && !content_type.contains("json")
            && !content_type.contains("xml")
        {
            return Err(format!("Blocked non-text content type: {}", content_type));
        }

        let mut body = String::new();
        response
            .take(MAX_FETCH_BYTES)
            .read_to_string(&mut body)
            .map_err(|error| error.to_string())?;
        return Ok(body);
    }

    Err("Too many redirects.".into())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn pairing_output_path(args: &[String]) -> Option<PathBuf> {
    let index = args.iter().position(|arg| arg == "--pairing-output")?;
    let path = PathBuf::from(args.get(index + 1)?);
    let file_name = path.file_name()?.to_str()?;
    if path.parent()? != std::env::temp_dir()
        || !file_name.starts_with("nebula-mobile-pairing-")
        || path.extension().and_then(|value| value.to_str()) != Some("json")
    {
        return None;
    }
    Some(path)
}

fn handle_mobile_pairing_cli(app: &AppHandle, args: &[String]) -> bool {
    if !args
        .iter()
        .any(|arg| arg == "--generate-mobile-pairing-code")
    {
        return false;
    }
    let Some(output_path) = pairing_output_path(args) else {
        return true;
    };
    let payload = app
        .try_state::<mobile_bridge::MobileBridgeState>()
        .ok_or_else(|| "Nebula's mobile bridge is not ready.".to_string())
        .and_then(|state| mobile_bridge::create_pairing_code(&state))
        .and_then(|result| serde_json::to_vec(&result).map_err(|error| error.to_string()));
    let bytes = payload.unwrap_or_else(|error| {
        serde_json::to_vec(&serde_json::json!({ "error": error }))
            .unwrap_or_else(|_| b"{\"error\":\"Could not create pairing code.\"}".to_vec())
    });
    let _ = fs::write(output_path, bytes);
    true
}

#[cfg(test)]
mod command_policy_tests {
    use super::*;

    #[test]
    fn permanent_guard_blocks_catastrophic_and_hidden_commands() {
        let blocked = [
            "format C: /q",
            "diskpart /s wipe.txt",
            "del C:\\Windows\\System32",
            "powershell -WindowStyle Hidden -Command whoami",
            "wscript.exe /b payload.vbs",
            "procdump -ma lsass.exe",
        ];

        for command in blocked {
            assert!(
                command_is_permanently_blocked(command),
                "expected permanent block for {command}"
            );
        }
    }

    #[test]
    fn permanent_guard_keeps_normal_project_commands_available() {
        for command in ["git status", "npm test", "cargo check", "dir src"] {
            assert!(
                !command_is_permanently_blocked(command),
                "unexpected permanent block for {command}"
            );
        }
    }

    #[test]
    fn command_output_cap_preserves_utf8_boundaries() {
        let output = Arc::new(Mutex::new("x".repeat(MAX_COMMAND_OUTPUT_BYTES - 2)));
        let truncated = Arc::new(Mutex::new(false));

        append_command_output(&output, "\u{2603}\n", &truncated);

        let value = output.lock().expect("output lock");
        assert!(value.is_char_boundary(value.len()));
        assert!(value.len() <= MAX_COMMAND_OUTPUT_BYTES);
        assert!(*truncated.lock().expect("truncated lock"));
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if handle_mobile_pairing_cli(app, &args) {
                return;
            }
            show_main_window(app);
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let mobile_state = mobile_bridge::start(app.handle().clone());
            app.manage(mobile_state);

            let open_i = MenuItem::with_id(app, "open", "Open Nebula", true, None::<&str>)?;
            let hide_i = MenuItem::with_id(app, "hide", "Hide to background", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit Nebula", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &hide_i, &quit_i])?;

            let mut tray = TrayIconBuilder::new()
                .tooltip("Nebula is running")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "hide" => hide_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(&tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }

            tray.build(app)?;

            if std::env::args().any(|arg| arg == "--background") {
                hide_main_window(app.handle());
            } else {
                show_main_window(app.handle());
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_project_folder,
            list_files,
            search_project_files,
            read_file,
            read_avatar_image,
            write_file,
            create_file,
            append_file,
            ensure_memory,
            read_memory,
            append_memory,
            write_memory,
            search_memory,
            run_command,
            start_command,
            command_health,
            stop_running_command,
            get_system_info,
            get_resource_snapshot,
            capture_screen,
            sleep_pc,
              open_app,
              open_known_app,
              list_installed_apps,
              open_windows_settings,
              open_voice_privacy_settings,
            supertonic_synthesize,
            open_path_in_explorer,
            show_tray_notification,
            lmstudio_list_models,
            lmstudio_load_model,
            lmstudio_chat_completion,
            launcher_index_folder,
            launcher_search,
            web_fetch_text,
            storage::storage_initialize,
            storage::storage_close_session,
            storage::storage_load_conversations,
            storage::storage_save_conversations,
            storage::storage_search_conversations,
            storage::storage_put_document,
            storage::storage_get_document,
            storage::storage_list_documents,
            storage::storage_delete_document,
            storage::storage_migrate_legacy,
            storage::storage_export_diagnostics,
            mobile_bridge::mobile_bridge_status,
            mobile_bridge::mobile_bridge_create_pairing_code,
            mobile_bridge::mobile_bridge_revoke_client,
            mobile_bridge::mobile_bridge_publish_event,
            mobile_bridge::mobile_bridge_update_runtime_status,
            mobile_bridge::mobile_bridge_enable_tailscale,
            mobile_bridge::mobile_bridge_disable_tailscale
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nebula");
}
