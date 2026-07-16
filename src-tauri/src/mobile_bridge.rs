use async_stream::stream;
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Path as AxumPath, Query, State as AxumState},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode, Uri},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, patch, post},
    Json, Router,
};
use base64::{engine::general_purpose, Engine as _};
use rand::Rng;
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    convert::Infallible,
    fs,
    net::SocketAddr,
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State as TauriState};
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use uuid::Uuid;

use crate::storage::{self, MobileClientRecord};

const BRIDGE_PORT: u16 = 47_631;
const PAIRING_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_PAIR_ATTEMPTS: usize = 5;
const MAX_RUN_BYTES: usize = 10 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES: usize = 5 * 1024 * 1024;
const MAX_ATTACHMENTS_TOTAL: usize = 8 * 1024 * 1024;

#[derive(RustEmbed)]
#[folder = "../mobile-dist/"]
struct MobileAssets;

#[derive(Clone)]
pub struct MobileBridgeState {
    inner: Arc<MobileBridgeInner>,
}

struct MobileBridgeInner {
    app: AppHandle,
    pairing: Mutex<Option<PairingCode>>,
    pair_attempts: Mutex<VecDeque<Instant>>,
    auth_failures: Mutex<VecDeque<Instant>>,
    runs: Mutex<HashMap<String, MobileRun>>,
    runtime_status: Mutex<Value>,
    mobile_control: Mutex<Value>,
    mobile_models: Mutex<Value>,
    control_revision: Mutex<u64>,
    listening: Mutex<bool>,
    last_error: Mutex<Option<String>>,
}

struct PairingCode {
    value: String,
    expires_at: Instant,
}

struct MobileRun {
    client_id: String,
    sender: broadcast::Sender<Value>,
    history: VecDeque<Value>,
    pending_approvals: HashMap<String, bool>,
    terminal: bool,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }
    fn internal() -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "Nebula could not complete that mobile request.",
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({"error":{"code":self.code,"message":self.message}})),
        )
            .into_response()
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileBridgeSnapshot {
    listening: bool,
    port: u16,
    tailscale_online: bool,
    serve_enabled: bool,
    install_url: Option<String>,
    last_error: Option<String>,
    paired_clients: Vec<MobileClientRecord>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingCodeResult {
    code: String,
    expires_at_ms: u128,
    install_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairRequest {
    code: String,
    device_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairResponse {
    token: String,
    client: MobileClientRecord,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateConversationRequest {
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateConversationRequest {
    title: Option<String>,
    pinned: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunRequest {
    conversation_id: Option<String>,
    content: String,
    attachments: Option<Vec<MobileAttachment>>,
    mode: Option<String>,
    source_message_id: Option<String>,
    intent_mode: Option<String>,
    include_project_context: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileAttachment {
    name: String,
    mime_type: String,
    data_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalDecision {
    run_id: String,
    approved: bool,
    confirmation: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileControlPatch {
    revision: u64,
    change: Value,
}

#[derive(Debug, Deserialize)]
struct SearchQuery {
    q: Option<String>,
    limit: Option<usize>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RemoteRunPayload {
    run_id: String,
    client_id: String,
    conversation_id: Option<String>,
    content: String,
    attachments: Vec<Value>,
    mode: String,
    source_message_id: Option<String>,
    intent_mode: String,
    include_project_context: bool,
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn hash_token(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

fn clean_device_name(value: Option<String>) -> String {
    let clean = value
        .unwrap_or_else(|| "iPhone".into())
        .chars()
        .filter(|ch| !ch.is_control())
        .take(48)
        .collect::<String>()
        .trim()
        .to_string();
    if clean.is_empty() {
        "iPhone".into()
    } else {
        clean
    }
}

fn valid_run_mode(value: &str) -> bool {
    matches!(value, "new" | "retry" | "regenerate")
}

fn valid_intent_mode(value: &str) -> bool {
    matches!(
        value,
        "auto"
            | "web_search"
            | "deep_research"
            | "deep_thinking"
            | "project_search"
            | "guided_learning"
            | "personal_intelligence"
    )
}

fn validate_mobile_control_change(
    value: Value,
) -> Result<serde_json::Map<String, Value>, ApiError> {
    let object = value.as_object().ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_settings",
            "Settings changes must be an object.",
        )
    })?;
    let mut clean = serde_json::Map::new();
    for (key, value) in object {
        let valid = match key.as_str() {
            "modelMode" => value
                .as_str()
                .is_some_and(|item| matches!(item, "auto" | "fast" | "code" | "review")),
            "singleModelEnabled"
            | "autoLoadModels"
            | "keepDailyModelWarm"
            | "warmModelWhileTyping"
            | "backgroundPreloadCodeModel"
            | "enableAutomaticReviewPass"
            | "contextInjectionEnabled"
            | "autoWebSearch" => value.is_boolean(),
            "singleModel" | "dailyModel" | "codeModel" | "reviewModel" => value
                .as_str()
                .is_some_and(|item| item.len() <= 240 && !item.chars().any(char::is_control)),
            "temperature" => value
                .as_f64()
                .is_some_and(|item| (0.0..=1.5).contains(&item)),
            "maxTokens" => value
                .as_u64()
                .is_some_and(|item| (256..=16_384).contains(&item)),
            "contextBudgetChars" => value
                .as_u64()
                .is_some_and(|item| (4_000..=64_000).contains(&item)),
            "maxAutoFetchPages" => value.as_u64().is_some_and(|item| (1..=8).contains(&item)),
            "memoryReviewMode" => value
                .as_str()
                .is_some_and(|item| matches!(item, "suggest" | "auto" | "manual")),
            "actionMode" => value
                .as_str()
                .is_some_and(|item| matches!(item, "fast" | "guarded" | "strict")),
            _ => {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "setting_not_allowed",
                    format!("Mobile cannot change {key}."),
                ))
            }
        };
        if !valid {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "invalid_setting_value",
                format!("The value for {key} is invalid."),
            ));
        }
        clean.insert(key.clone(), value.clone());
    }
    if clean.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "empty_update",
            "Choose a setting to change.",
        ));
    }
    Ok(clean)
}

fn mobile_control_snapshot(state: &MobileBridgeState) -> Result<Value, ApiError> {
    let revision = *state
        .inner
        .control_revision
        .lock()
        .map_err(|_| ApiError::internal())?;
    let control = state
        .inner
        .mobile_control
        .lock()
        .map_err(|_| ApiError::internal())?
        .clone();
    let mut object = control.as_object().cloned().unwrap_or_default();
    object.insert("revision".into(), json!(revision));
    Ok(Value::Object(object))
}

fn attachment_path_allowed(root: &std::path::Path, path: &std::path::Path) -> bool {
    path.starts_with(root)
}

fn authorize(
    state: &MobileBridgeState,
    headers: &HeaderMap,
) -> Result<MobileClientRecord, ApiError> {
    {
        let mut failures = state
            .inner
            .auth_failures
            .lock()
            .map_err(|_| ApiError::internal())?;
        let cutoff = Instant::now() - Duration::from_secs(5 * 60);
        while failures.front().is_some_and(|failure| *failure < cutoff) {
            failures.pop_front();
        }
        if failures.len() >= 20 {
            return Err(ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "auth_rate_limited",
                "Too many invalid requests. Wait a few minutes and try again.",
            ));
        }
    }
    let supplied = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| value.len() >= 32 && value.len() <= 256);
    let client = supplied
        .map(hash_token)
        .map(|token_hash| storage::mobile_find_client(&state.inner.app, &token_hash))
        .transpose()
        .map_err(|_| ApiError::internal())?
        .flatten();
    let Some(client) = client else {
        state
            .inner
            .auth_failures
            .lock()
            .map_err(|_| ApiError::internal())?
            .push_back(Instant::now());
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Pair this device with Nebula on your PC.",
        ));
    };
    storage::mobile_touch_client(&state.inner.app, &client.id).map_err(|_| ApiError::internal())?;
    Ok(client)
}

fn mobile_safe_store(mut store: Value) -> Value {
    let Some(sessions) = store.get_mut("sessions").and_then(Value::as_array_mut) else {
        return store;
    };
    for session in sessions {
        if let Some(object) = session.as_object_mut() {
            object.remove("projectFolder");
            if let Some(messages) = object.get_mut("messages").and_then(Value::as_array_mut) {
                messages.retain(|message| {
                    matches!(
                        message.get("role").and_then(Value::as_str),
                        Some("user" | "assistant")
                    )
                });
                for message in messages {
                    if let Some(message_object) = message.as_object_mut() {
                        message_object.remove("toolResult");
                        if let Some(attachments) = message_object
                            .get_mut("attachments")
                            .and_then(Value::as_array_mut)
                        {
                            for attachment in attachments {
                                if let Some(attachment_object) = attachment.as_object_mut() {
                                    attachment_object.remove("path");
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    store
}

fn tailscale_snapshot() -> (bool, bool, Option<String>) {
    let status = Command::new("tailscale")
        .args(["status", "--json"])
        .output();
    let Ok(status) = status else {
        return (false, false, None);
    };
    let parsed = serde_json::from_slice::<Value>(&status.stdout).unwrap_or(Value::Null);
    let online = parsed.get("BackendState").and_then(Value::as_str) == Some("Running")
        && parsed
            .pointer("/Self/Online")
            .and_then(Value::as_bool)
            .unwrap_or(false);
    let dns = parsed
        .pointer("/Self/DNSName")
        .and_then(Value::as_str)
        .map(|value| value.trim_end_matches('.').to_string())
        .filter(|value| !value.is_empty());
    let serve = Command::new("tailscale")
        .args(["serve", "status", "--json"])
        .output()
        .ok()
        .and_then(|output| serde_json::from_slice::<Value>(&output.stdout).ok())
        .map(|value| {
            value
                .as_object()
                .map(|map| !map.is_empty())
                .unwrap_or(false)
        })
        .unwrap_or(false);
    (online, serve, dns.map(|name| format!("https://{name}")))
}

fn snapshot(state: &MobileBridgeState) -> Result<MobileBridgeSnapshot, String> {
    let (tailscale_online, serve_enabled, install_url) = tailscale_snapshot();
    Ok(MobileBridgeSnapshot {
        listening: *state
            .inner
            .listening
            .lock()
            .map_err(|_| "Bridge state lock failed.")?,
        port: BRIDGE_PORT,
        tailscale_online,
        serve_enabled,
        install_url,
        last_error: state
            .inner
            .last_error
            .lock()
            .map_err(|_| "Bridge state lock failed.")?
            .clone(),
        paired_clients: storage::mobile_list_clients(&state.inner.app)?,
    })
}

fn publish(state: &MobileBridgeState, run_id: &str, mut event: Value) -> Result<(), String> {
    if let Some(object) = event.as_object_mut() {
        object
            .entry("runId")
            .or_insert_with(|| Value::String(run_id.to_string()));
        object
            .entry("createdAt")
            .or_insert_with(|| Value::String(now_ms().to_string()));
    }
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let terminal = matches!(event_type, "completed" | "cancelled" | "error");
    let mut runs = state
        .inner
        .runs
        .lock()
        .map_err(|_| "Run state lock failed.")?;
    let run = runs
        .get_mut(run_id)
        .ok_or_else(|| "Mobile run no longer exists.".to_string())?;
    if run.terminal {
        return Ok(());
    }
    if event_type == "approval_required" {
        if let Some(approval) = event.get("approval") {
            if let Some(id) = approval.get("id").and_then(Value::as_str) {
                run.pending_approvals.insert(
                    id.to_string(),
                    approval
                        .get("requiresTypedConfirm")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                );
            }
        }
    } else if event_type == "approval_resolved" {
        if let Some(id) = event.get("approvalId").and_then(Value::as_str) {
            run.pending_approvals.remove(id);
        }
    }
    run.history.push_back(event.clone());
    while run.history.len() > 300 {
        run.history.pop_front();
    }
    if terminal {
        run.terminal = true;
    }
    let _ = run.sender.send(event);
    Ok(())
}

fn uploads_root(app: &AppHandle) -> Result<PathBuf, ApiError> {
    let root = app
        .path()
        .local_data_dir()
        .map_err(|_| ApiError::internal())?
        .join("Nebula")
        .join("mobile-uploads");
    fs::create_dir_all(&root).map_err(|_| ApiError::internal())?;
    Ok(root)
}

fn store_attachments(
    app: &AppHandle,
    attachments: Vec<MobileAttachment>,
) -> Result<Vec<Value>, ApiError> {
    if attachments.len() > 6 {
        return Err(ApiError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "too_many_attachments",
            "Attach at most six files per message.",
        ));
    }
    let mut total = 0usize;
    let mut stored = Vec::new();
    let root = uploads_root(app)?;
    for attachment in attachments {
        let bytes = general_purpose::STANDARD
            .decode(attachment.data_base64.as_bytes())
            .map_err(|_| {
                ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "invalid_attachment",
                    "An attachment could not be decoded.",
                )
            })?;
        if bytes.len() > MAX_ATTACHMENT_BYTES {
            return Err(ApiError::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "attachment_too_large",
                "Each attachment must be 5 MB or smaller.",
            ));
        }
        total += bytes.len();
        if total > MAX_ATTACHMENTS_TOTAL {
            return Err(ApiError::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "attachments_too_large",
                "Attachments must total 8 MB or less.",
            ));
        }
        let clean_name = attachment
            .name
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                    ch
                } else {
                    '_'
                }
            })
            .take(96)
            .collect::<String>();
        let name = if clean_name.trim_matches('.').is_empty() {
            "attachment"
        } else {
            &clean_name
        };
        let path = root.join(format!("{}-{name}", Uuid::new_v4()));
        fs::write(&path, bytes).map_err(|_| ApiError::internal())?;
        stored.push(json!({
            "id": Uuid::new_v4().to_string(), "kind": "file", "label": name,
            "path": path.to_string_lossy(), "mimeType": attachment.mime_type.chars().take(64).collect::<String>(),
            "detail": format!("Mobile upload - {}", attachment.mime_type.chars().take(64).collect::<String>())
        }));
    }
    Ok(stored)
}

async fn pair(
    AxumState(state): AxumState<MobileBridgeState>,
    Json(request): Json<PairRequest>,
) -> Result<Json<PairResponse>, ApiError> {
    {
        let mut attempts = state
            .inner
            .pair_attempts
            .lock()
            .map_err(|_| ApiError::internal())?;
        let cutoff = Instant::now() - Duration::from_secs(15 * 60);
        while attempts.front().is_some_and(|attempt| *attempt < cutoff) {
            attempts.pop_front();
        }
        if attempts.len() >= MAX_PAIR_ATTEMPTS {
            return Err(ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "pairing_rate_limited",
                "Too many pairing attempts. Generate a new code on your PC.",
            ));
        }
        attempts.push_back(Instant::now());
    }
    let valid = {
        let mut pairing = state
            .inner
            .pairing
            .lock()
            .map_err(|_| ApiError::internal())?;
        match pairing.as_ref() {
            Some(pairing_code)
                if pairing_code.expires_at > Instant::now()
                    && pairing_code.value == request.code.trim() =>
            {
                *pairing = None;
                true
            }
            _ => false,
        }
    };
    if !valid {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "invalid_pairing_code",
            "That pairing code is invalid or expired.",
        ));
    }
    let mut random = [0u8; 32];
    rand::rng().fill(&mut random);
    let token = general_purpose::URL_SAFE_NO_PAD.encode(random);
    let id = Uuid::new_v4().to_string();
    let name = clean_device_name(request.device_name);
    let client = storage::mobile_create_client(&state.inner.app, &id, &name, &hash_token(&token))
        .map_err(|_| ApiError::internal())?;
    Ok(Json(PairResponse { token, client }))
}

async fn api_status(
    AxumState(state): AxumState<MobileBridgeState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let client = authorize(&state, &headers)?;
    let runtime = state
        .inner
        .runtime_status
        .lock()
        .map_err(|_| ApiError::internal())?
        .clone();
    Ok(Json(
        json!({"ok":true,"client":{"id":client.id,"name":client.name},"runtime":runtime,"bridge":{"port":BRIDGE_PORT}}),
    ))
}

async fn mobile_control_settings(
    AxumState(state): AxumState<MobileBridgeState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    authorize(&state, &headers)?;
    let snapshot = mobile_control_snapshot(&state)?;
    if snapshot.as_object().is_none_or(|value| value.len() <= 1) {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "settings_unavailable",
            "Nebula Desktop has not published its settings yet.",
        ));
    }
    Ok(Json(snapshot))
}

async fn update_mobile_control_settings(
    AxumState(state): AxumState<MobileBridgeState>,
    headers: HeaderMap,
    Json(request): Json<MobileControlPatch>,
) -> Result<Json<Value>, ApiError> {
    let client = authorize(&state, &headers)?;
    let change = validate_mobile_control_change(request.change)?;
    let next_revision = {
        let mut revision = state
            .inner
            .control_revision
            .lock()
            .map_err(|_| ApiError::internal())?;
        if request.revision != *revision {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "settings_changed",
                "PC settings changed. Refresh and try again.",
            ));
        }
        let mut current = state
            .inner
            .mobile_control
            .lock()
            .map_err(|_| ApiError::internal())?;
        let current_object = current.as_object_mut().ok_or_else(ApiError::internal)?;
        for (key, value) in &change {
            current_object.insert(key.clone(), value.clone());
        }
        *revision += 1;
        *revision
    };
    state
        .inner
        .app
        .emit(
            "nebula-mobile-settings-change",
            json!({
                "clientId": client.id,
                "revision": next_revision,
                "change": change,
            }),
        )
        .map_err(|_| ApiError::internal())?;
    let _ = storage::mobile_audit(&state.inner.app, Some(&client.id), "settings_updated", None);
    Ok(Json(mobile_control_snapshot(&state)?))
}

async fn mobile_models(
    AxumState(state): AxumState<MobileBridgeState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    authorize(&state, &headers)?;
    Ok(Json(
        state
            .inner
            .mobile_models
            .lock()
            .map_err(|_| ApiError::internal())?
            .clone(),
    ))
}

async fn mobile_diagnostics(
    AxumState(state): AxumState<MobileBridgeState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    authorize(&state, &headers)?;
    let runtime = state
        .inner
        .runtime_status
        .lock()
        .map_err(|_| ApiError::internal())?
        .clone();
    Ok(Json(json!({
        "service": runtime.get("service").and_then(Value::as_str).unwrap_or("unknown"),
        "agentStatus": runtime.get("agentStatus").and_then(Value::as_str).unwrap_or("unknown"),
        "activeModel": runtime.get("model").and_then(Value::as_str).unwrap_or("Nebula unified"),
        "activeRunSource": runtime.get("activeRunSource").cloned().unwrap_or(Value::Null),
        "memoryReady": runtime.get("memoryReady").and_then(Value::as_bool).unwrap_or(false),
        "bridgeLatencyMs": 0,
        "generatedAt": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs().to_string(),
    })))
}

async fn conversations(
    AxumState(state): AxumState<MobileBridgeState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    authorize(&state, &headers)?;
    let store = storage::storage_load_conversations(state.inner.app.clone())
        .map_err(|_| ApiError::internal())?;
    Ok(Json(mobile_safe_store(store.unwrap_or_else(
        || json!({"version":2,"activeId":"","sessions":[],"folders":[]}),
    ))))
}

async fn create_conversation(
    AxumState(state): AxumState<MobileBridgeState>,
    headers: HeaderMap,
    Json(request): Json<CreateConversationRequest>,
) -> Result<Json<Value>, ApiError> {
    let client = authorize(&state, &headers)?;
    let id = Uuid::new_v4().to_string();
    let title = request
        .title
        .unwrap_or_else(|| "New chat".into())
        .chars()
        .take(96)
        .collect::<String>();
    let conversation = storage::mobile_create_conversation(&state.inner.app, &id, title.trim())
        .map_err(|_| ApiError::internal())?;
    let _ = storage::mobile_audit(
        &state.inner.app,
        Some(&client.id),
        "conversation_created",
        Some(&id),
    );
    let _ = state.inner.app.emit(
        "nebula-mobile-conversations-changed",
        json!({"conversationId":id}),
    );
    Ok(Json(conversation))
}

async fn update_conversation(
    AxumState(state): AxumState<MobileBridgeState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(request): Json<UpdateConversationRequest>,
) -> Result<Json<Value>, ApiError> {
    let client = authorize(&state, &headers)?;
    if request.title.is_none() && request.pinned.is_none() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "empty_update",
            "Choose a chat change first.",
        ));
    }
    let updated = storage::mobile_update_conversation(
        &state.inner.app,
        &id,
        request.title.as_deref(),
        request.pinned,
    )
    .map_err(|error| {
        if error == "Conversation not found." {
            ApiError::new(StatusCode::NOT_FOUND, "conversation_not_found", error)
        } else {
            ApiError::internal()
        }
    })?;
    let _ = storage::mobile_audit(
        &state.inner.app,
        Some(&client.id),
        "conversation_updated",
        Some(&id),
    );
    let _ = state.inner.app.emit(
        "nebula-mobile-conversations-changed",
        json!({"conversationId":id}),
    );
    Ok(Json(updated))
}

async fn delete_conversation(
    AxumState(state): AxumState<MobileBridgeState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Value>, ApiError> {
    let client = authorize(&state, &headers)?;
    let active_id =
        storage::mobile_delete_conversation(&state.inner.app, &id).map_err(|error| {
            if error == "Conversation not found." {
                ApiError::new(StatusCode::NOT_FOUND, "conversation_not_found", error)
            } else {
                ApiError::internal()
            }
        })?;
    let _ = storage::mobile_audit(
        &state.inner.app,
        Some(&client.id),
        "conversation_deleted",
        Some(&id),
    );
    let _ = state.inner.app.emit(
        "nebula-mobile-conversations-changed",
        json!({"conversationId":id,"deleted":true}),
    );
    Ok(Json(json!({"ok":true,"activeId":active_id})))
}

async fn attachment_preview(
    AxumState(state): AxumState<MobileBridgeState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Result<Response, ApiError> {
    authorize(&state, &headers)?;
    let stored = storage::mobile_find_attachment(&state.inner.app, &id)
        .map_err(|_| ApiError::internal())?
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "attachment_not_found",
                "That attachment is no longer available.",
            )
        })?;
    if !matches!(
        stored.mime_type.as_str(),
        "image/png" | "image/jpeg" | "image/webp" | "image/gif"
    ) {
        return Err(ApiError::new(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "preview_unsupported",
            "Only image attachments can be previewed inline.",
        ));
    }
    let root = uploads_root(&state.inner.app).map_err(|_| ApiError::internal())?;
    let root = root.canonicalize().map_err(|_| ApiError::internal())?;
    let path = stored.path.canonicalize().map_err(|_| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "attachment_not_found",
            "That attachment is no longer available.",
        )
    })?;
    if !attachment_path_allowed(&root, &path) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "attachment_blocked",
            "That attachment path is not available to mobile clients.",
        ));
    }
    let bytes = fs::read(path).map_err(|_| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "attachment_not_found",
            "That attachment is no longer available.",
        )
    })?;
    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&stored.mime_type)
            .unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    response.headers_mut().insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    let disposition = format!(
        "inline; filename=\"{}\"",
        stored.label.replace(['\"', '\\'], "_")
    );
    if let Ok(value) = HeaderValue::from_str(&disposition) {
        response
            .headers_mut()
            .insert(header::CONTENT_DISPOSITION, value);
    }
    Ok(response)
}

async fn conversation_messages(
    AxumState(state): AxumState<MobileBridgeState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Value>, ApiError> {
    authorize(&state, &headers)?;
    let store = storage::storage_load_conversations(state.inner.app.clone())
        .map_err(|_| ApiError::internal())?
        .unwrap_or(Value::Null);
    let session = store
        .get("sessions")
        .and_then(Value::as_array)
        .and_then(|sessions| {
            sessions
                .iter()
                .find(|session| session.get("id").and_then(Value::as_str) == Some(id.as_str()))
        })
        .cloned()
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "conversation_not_found",
                "That conversation is no longer available.",
            )
        })?;
    Ok(Json(
        mobile_safe_store(json!({"sessions":[session]}))
            .get("sessions")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .cloned()
            .unwrap_or(Value::Null),
    ))
}

async fn search_conversations(
    AxumState(state): AxumState<MobileBridgeState>,
    headers: HeaderMap,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Value>, ApiError> {
    authorize(&state, &headers)?;
    let q = query.q.unwrap_or_default();
    if q.trim().is_empty() {
        return Ok(Json(json!([])));
    }
    let mut results =
        storage::storage_search_conversations(state.inner.app.clone(), q, query.limit)
            .map_err(|_| ApiError::internal())?;
    for result in &mut results {
        if let Some(object) = result.as_object_mut() {
            object.remove("projectFolder");
        }
    }
    Ok(Json(Value::Array(results)))
}

async fn start_run(
    AxumState(state): AxumState<MobileBridgeState>,
    headers: HeaderMap,
    Json(request): Json<RunRequest>,
) -> Result<Json<Value>, ApiError> {
    let client = authorize(&state, &headers)?;
    let mode = request.mode.as_deref().unwrap_or("new");
    if !valid_run_mode(mode) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_run_mode",
            "That run mode is not supported.",
        ));
    }
    let intent_mode = request.intent_mode.as_deref().unwrap_or("auto");
    if !valid_intent_mode(intent_mode) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_intent_mode",
            "That assistant mode is not supported.",
        ));
    }
    let mut content = request.content.trim().to_string();
    let mut reused_attachments = Vec::new();
    if mode != "new" {
        let conversation_id = request.conversation_id.as_deref().ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "missing_conversation",
                "Choose a conversation before retrying.",
            )
        })?;
        let source_message_id = request.source_message_id.as_deref().ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "missing_source_message",
                "Choose the original message before retrying.",
            )
        })?;
        let source =
            storage::mobile_get_user_message(&state.inner.app, conversation_id, source_message_id)
                .map_err(|_| ApiError::internal())?
                .ok_or_else(|| {
                    ApiError::new(
                        StatusCode::NOT_FOUND,
                        "source_message_not_found",
                        "The original user message is no longer available.",
                    )
                })?;
        content = source.content;
        reused_attachments = source.attachments;
    }
    let content = content.trim();
    if content.is_empty() || content.chars().count() > 30_000 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_message",
            "Enter a message up to 30,000 characters.",
        ));
    }
    {
        let runs = state.inner.runs.lock().map_err(|_| ApiError::internal())?;
        if runs.values().any(|run| !run.terminal) {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "agent_busy",
                "Nebula is already working on another request.",
            ));
        }
    }
    let attachments = if mode == "new" {
        store_attachments(&state.inner.app, request.attachments.unwrap_or_default())?
    } else {
        reused_attachments
    };
    let run_id = Uuid::new_v4().to_string();
    let (sender, _) = broadcast::channel(384);
    state
        .inner
        .runs
        .lock()
        .map_err(|_| ApiError::internal())?
        .insert(
            run_id.clone(),
            MobileRun {
                client_id: client.id.clone(),
                sender,
                history: VecDeque::new(),
                pending_approvals: HashMap::new(),
                terminal: false,
            },
        );
    let payload = RemoteRunPayload {
        run_id: run_id.clone(),
        client_id: client.id.clone(),
        conversation_id: request.conversation_id,
        content: content.to_string(),
        attachments,
        mode: mode.to_string(),
        source_message_id: request.source_message_id,
        intent_mode: intent_mode.to_string(),
        include_project_context: request.include_project_context.unwrap_or(false),
    };
    storage::mobile_audit(
        &state.inner.app,
        Some(&client.id),
        "run_requested",
        Some(&run_id),
    )
    .map_err(|_| ApiError::internal())?;
    state
        .inner
        .app
        .emit("nebula-mobile-run-request", payload)
        .map_err(|_| ApiError::internal())?;
    Ok(Json(json!({"runId":run_id})))
}

async fn run_events(
    AxumState(state): AxumState<MobileBridgeState>,
    headers: HeaderMap,
    AxumPath(run_id): AxumPath<String>,
) -> Result<Response, ApiError> {
    let client = authorize(&state, &headers)?;
    let (history, mut receiver) = {
        let runs = state.inner.runs.lock().map_err(|_| ApiError::internal())?;
        let run = runs.get(&run_id).ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "run_not_found",
                "That run is no longer available.",
            )
        })?;
        if run.client_id != client.id {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "forbidden",
                "That run belongs to another paired device.",
            ));
        }
        (
            run.history.iter().cloned().collect::<Vec<_>>(),
            run.sender.subscribe(),
        )
    };
    let event_stream = stream! {
        for value in history {
            let terminal = matches!(value.get("type").and_then(Value::as_str), Some("completed" | "cancelled" | "error"));
            if let Ok(event) = Event::default().event("nebula").json_data(value) { yield Ok::<Event, Infallible>(event); }
            if terminal { return; }
        }
        loop {
            match receiver.recv().await {
                Ok(value) => {
                    let terminal = matches!(value.get("type").and_then(Value::as_str), Some("completed" | "cancelled" | "error"));
                    if let Ok(event) = Event::default().event("nebula").json_data(value) { yield Ok::<Event, Infallible>(event); }
                    if terminal { break; }
                },
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    };
    Ok(Sse::new(event_stream)
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(12))
                .text("keepalive"),
        )
        .into_response())
}

async fn cancel_run(
    AxumState(state): AxumState<MobileBridgeState>,
    headers: HeaderMap,
    AxumPath(run_id): AxumPath<String>,
) -> Result<Json<Value>, ApiError> {
    let client = authorize(&state, &headers)?;
    {
        let runs = state.inner.runs.lock().map_err(|_| ApiError::internal())?;
        let run = runs.get(&run_id).ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "run_not_found",
                "That run is no longer available.",
            )
        })?;
        if run.client_id != client.id {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "forbidden",
                "That run belongs to another paired device.",
            ));
        }
        if run.terminal {
            return Ok(Json(json!({"ok":true,"alreadyFinished":true})));
        }
    }
    state
        .inner
        .app
        .emit(
            "nebula-mobile-run-cancel",
            json!({"runId":run_id,"clientId":client.id}),
        )
        .map_err(|_| ApiError::internal())?;
    Ok(Json(json!({"ok":true})))
}

async fn decide_approval(
    AxumState(state): AxumState<MobileBridgeState>,
    headers: HeaderMap,
    AxumPath(approval_id): AxumPath<String>,
    Json(decision): Json<ApprovalDecision>,
) -> Result<Json<Value>, ApiError> {
    let client = authorize(&state, &headers)?;
    let requires_typed_confirm = {
        let runs = state.inner.runs.lock().map_err(|_| ApiError::internal())?;
        let run = runs.get(&decision.run_id).ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "run_not_found",
                "That run is no longer available.",
            )
        })?;
        if run.client_id != client.id {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "forbidden",
                "That approval belongs to another paired device.",
            ));
        }
        *run.pending_approvals.get(&approval_id).ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "approval_not_found",
                "That approval is no longer waiting.",
            )
        })?
    };
    if requires_typed_confirm
        && decision.approved
        && decision.confirmation.as_deref() != Some("CONFIRM")
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_confirmation",
            "Type CONFIRM exactly for high-risk approvals.",
        ));
    }
    state.inner.app.emit("nebula-mobile-approval-decision", json!({
        "runId":decision.run_id,"approvalId":approval_id,"approved":decision.approved,"confirmation":decision.confirmation,"clientId":client.id
    })).map_err(|_| ApiError::internal())?;
    Ok(Json(json!({"ok":true})))
}

async fn static_asset(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let requested = if path.is_empty() { "index.html" } else { path };
    let asset = MobileAssets::get(requested)
        .map(|asset| (asset, requested))
        .or_else(|| {
            (!requested.starts_with("api/") && !requested.contains('.'))
                .then(|| MobileAssets::get("index.html").map(|asset| (asset, "index.html")))
                .flatten()
        });
    let Some((asset, served_path)) = asset else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mime = mime_guess::from_path(served_path).first_or_octet_stream();
    let mut response = Response::new(Body::from(asset.data.into_owned()));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.as_ref())
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response.headers_mut().insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    response.headers_mut().insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'"));
    if served_path == "index.html"
        || served_path.ends_with(".webmanifest")
        || served_path.ends_with("mobile-sw.js")
    {
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    } else {
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        );
    }
    response
}

fn router(state: MobileBridgeState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(HeaderValue::from_static("capacitor://localhost"))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);
    Router::new()
        .route("/api/v1/pair", post(pair))
        .route("/api/v1/status", get(api_status))
        .route(
            "/api/v1/settings/mobile-control",
            get(mobile_control_settings).patch(update_mobile_control_settings),
        )
        .route("/api/v1/models", get(mobile_models))
        .route("/api/v1/diagnostics/mobile", get(mobile_diagnostics))
        .route(
            "/api/v1/conversations",
            get(conversations).post(create_conversation),
        )
        .route(
            "/api/v1/conversations/{id}/messages",
            get(conversation_messages),
        )
        .route(
            "/api/v1/conversations/{id}",
            patch(update_conversation).delete(delete_conversation),
        )
        .route("/api/v1/attachments/{id}", get(attachment_preview))
        .route("/api/v1/search", get(search_conversations))
        .route("/api/v1/runs", post(start_run))
        .route("/api/v1/runs/{id}/events", get(run_events))
        .route("/api/v1/runs/{id}/cancel", post(cancel_run))
        .route("/api/v1/approvals/{id}", post(decide_approval))
        .fallback(static_asset)
        .layer(DefaultBodyLimit::max(MAX_RUN_BYTES))
        .layer(cors)
        .with_state(state)
}

pub fn start(app: AppHandle) -> MobileBridgeState {
    let state = MobileBridgeState {
        inner: Arc::new(MobileBridgeInner {
            app,
            pairing: Mutex::new(None),
            pair_attempts: Mutex::new(VecDeque::new()),
            auth_failures: Mutex::new(VecDeque::new()),
            runs: Mutex::new(HashMap::new()),
            runtime_status: Mutex::new(json!({"agentStatus":"starting","service":"checking"})),
            mobile_control: Mutex::new(json!({})),
            mobile_models: Mutex::new(json!([])),
            control_revision: Mutex::new(0),
            listening: Mutex::new(false),
            last_error: Mutex::new(None),
        }),
    };
    let server_state = state.clone();
    std::thread::Builder::new()
        .name("nebula-mobile-bridge".into())
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .worker_threads(2)
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    *server_state
                        .inner
                        .last_error
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                        Some(format!("Runtime failed: {error}"));
                    return;
                }
            };
            runtime.block_on(async move {
                let address = SocketAddr::from(([127, 0, 0, 1], BRIDGE_PORT));
                match tokio::net::TcpListener::bind(address).await {
                    Ok(listener) => {
                        *server_state
                            .inner
                            .listening
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner()) = true;
                        if let Err(error) =
                            axum::serve(listener, router(server_state.clone())).await
                        {
                            *server_state
                                .inner
                                .last_error
                                .lock()
                                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                                Some(format!("Bridge stopped: {error}"));
                        }
                    }
                    Err(error) => {
                        *server_state
                            .inner
                            .last_error
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                            Some(format!("Port {BRIDGE_PORT} unavailable: {error}"));
                    }
                }
            });
        })
        .ok();
    state
}

#[tauri::command]
pub fn mobile_bridge_status(
    state: TauriState<'_, MobileBridgeState>,
) -> Result<MobileBridgeSnapshot, String> {
    snapshot(&state)
}

#[tauri::command]
pub fn mobile_bridge_create_pairing_code(
    state: TauriState<'_, MobileBridgeState>,
) -> Result<PairingCodeResult, String> {
    create_pairing_code(&state)
}

pub fn create_pairing_code(state: &MobileBridgeState) -> Result<PairingCodeResult, String> {
    let value = format!("{:06}", rand::rng().random_range(0..1_000_000));
    let expires_at_ms = now_ms() + PAIRING_TTL.as_millis();
    *state
        .inner
        .pairing
        .lock()
        .map_err(|_| "Pairing state lock failed.")? = Some(PairingCode {
        value: value.clone(),
        expires_at: Instant::now() + PAIRING_TTL,
    });
    state
        .inner
        .pair_attempts
        .lock()
        .map_err(|_| "Pairing state lock failed.")?
        .clear();
    let (_, _, install_url) = tailscale_snapshot();
    Ok(PairingCodeResult {
        code: value,
        expires_at_ms,
        install_url,
    })
}

#[tauri::command]
pub fn mobile_bridge_revoke_client(
    app: AppHandle,
    id: String,
) -> Result<Vec<MobileClientRecord>, String> {
    storage::mobile_revoke_client(&app, &id)?;
    storage::mobile_list_clients(&app)
}

#[tauri::command]
pub fn mobile_bridge_publish_event(
    state: TauriState<'_, MobileBridgeState>,
    run_id: String,
    event: Value,
) -> Result<(), String> {
    publish(&state, &run_id, event)
}

#[tauri::command]
pub fn mobile_bridge_update_runtime_status(
    state: TauriState<'_, MobileBridgeState>,
    mut status: Value,
) -> Result<(), String> {
    if let Some(object) = status.as_object_mut() {
        if let Some(control) = object.remove("mobileControl") {
            let mut revision = state
                .inner
                .control_revision
                .lock()
                .map_err(|_| "Mobile revision lock failed.")?;
            let mut current = state
                .inner
                .mobile_control
                .lock()
                .map_err(|_| "Mobile control lock failed.")?;
            if *current != control {
                *current = control;
                *revision += 1;
            }
        }
        if let Some(models) = object.remove("models") {
            *state
                .inner
                .mobile_models
                .lock()
                .map_err(|_| "Mobile model lock failed.")? = models;
        }
    }
    *state
        .inner
        .runtime_status
        .lock()
        .map_err(|_| "Runtime state lock failed.")? = status;
    Ok(())
}

#[tauri::command]
pub async fn mobile_bridge_enable_tailscale(
    state: TauriState<'_, MobileBridgeState>,
) -> Result<MobileBridgeSnapshot, String> {
    let mut command = tokio::process::Command::new("tailscale");
    command.kill_on_drop(true).args([
        "serve",
        "--bg",
        "--yes",
        &format!("http://127.0.0.1:{BRIDGE_PORT}"),
    ]);
    let output = tokio::time::timeout(Duration::from_secs(12), command.output())
        .await
        .map_err(|_| {
            "Tailscale Serve still needs one-time tailnet authorization. Approve Serve in Tailscale, then try again."
                .to_string()
        })?
        .map_err(|error| format!("Could not start Tailscale Serve: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    snapshot(&state)
}

#[tauri::command]
pub async fn mobile_bridge_disable_tailscale(
    state: TauriState<'_, MobileBridgeState>,
) -> Result<MobileBridgeSnapshot, String> {
    let mut command = tokio::process::Command::new("tailscale");
    command
        .kill_on_drop(true)
        .args(["serve", "--https=443", "off"]);
    let output = tokio::time::timeout(Duration::from_secs(12), command.output())
        .await
        .map_err(|_| "Tailscale did not respond while disabling Serve.".to_string())?
        .map_err(|error| format!("Could not stop Tailscale Serve: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    snapshot(&state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_hash_is_stable_without_retaining_secret() {
        let hash = hash_token("a-secret-mobile-token");
        assert_eq!(hash, hash_token("a-secret-mobile-token"));
        assert!(!hash.contains("secret"));
        assert_eq!(hash.len(), 64);
    }

    #[test]
    fn device_names_are_bounded_and_clean() {
        assert_eq!(
            clean_device_name(Some("  Jonard's iPhone\n".into())),
            "Jonard's iPhone"
        );
        assert!(clean_device_name(Some("x".repeat(100))).len() <= 48);
    }

    #[test]
    fn run_modes_are_explicit_and_attachment_paths_stay_scoped() {
        assert!(valid_run_mode("new"));
        assert!(valid_run_mode("retry"));
        assert!(valid_run_mode("regenerate"));
        assert!(!valid_run_mode("replace_everything"));
        for mode in [
            "auto",
            "web_search",
            "deep_research",
            "deep_thinking",
            "project_search",
            "guided_learning",
            "personal_intelligence",
        ] {
            assert!(valid_intent_mode(mode));
        }
        assert!(!valid_intent_mode("unrestricted_computer_control"));
        let root = std::path::Path::new("C:/Nebula/mobile-uploads");
        assert!(attachment_path_allowed(
            root,
            std::path::Path::new("C:/Nebula/mobile-uploads/image.png")
        ));
        assert!(!attachment_path_allowed(
            root,
            std::path::Path::new("C:/Windows/secret.png")
        ));
    }

    #[test]
    fn mobile_store_redacts_attachment_paths_but_keeps_preview_metadata() {
        let safe = mobile_safe_store(
            json!({"sessions":[{"messages":[{"role":"user","attachments":[{"id":"a","path":"C:/private.png","mimeType":"image/png"}]}]}]}),
        );
        let attachment = &safe["sessions"][0]["messages"][0]["attachments"][0];
        assert!(attachment.get("path").is_none());
        assert_eq!(attachment["mimeType"], "image/png");
    }

    #[test]
    fn mobile_settings_allowlist_accepts_safe_controls() {
        let clean = validate_mobile_control_change(json!({
            "modelMode":"code",
            "dailyModel":"nebula-qwen",
            "temperature":0.25,
            "contextBudgetChars":18000,
            "autoWebSearch":true,
            "actionMode":"guarded"
        }))
        .expect("safe settings should validate");
        assert_eq!(clean.get("modelMode"), Some(&json!("code")));
        assert_eq!(clean.get("actionMode"), Some(&json!("guarded")));
    }

    #[test]
    fn mobile_settings_never_accept_credentials_or_risky_tool_enablement() {
        for key in [
            "openRouterApiKey",
            "nineRouterApiKey",
            "endpoint",
            "projectFolder",
            "riskyToolsEnabled",
        ] {
            let mut candidate = serde_json::Map::new();
            candidate.insert(key.into(), Value::Bool(true));
            let error = validate_mobile_control_change(Value::Object(candidate))
                .expect_err("sensitive setting must be rejected");
            assert_eq!(error.code, "setting_not_allowed");
        }
    }

    #[test]
    fn mobile_settings_reject_invalid_ranges_and_enums() {
        assert!(validate_mobile_control_change(json!({"temperature":4})).is_err());
        assert!(validate_mobile_control_change(json!({"maxTokens":1})).is_err());
        assert!(validate_mobile_control_change(json!({"actionMode":"unrestricted"})).is_err());
    }

    #[tokio::test]
    async fn spa_fallback_is_served_as_uncached_html() {
        let response = static_asset(Uri::from_static("/conversation/example")).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/html"
        );
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-cache"
        );
    }
}
