use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const SCHEMA_VERSION: i64 = 2;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageMigrationReport {
    pub success: bool,
    pub already_complete: bool,
    pub backup_path: Option<String>,
    pub imported_keys: usize,
    pub imported_records: usize,
    pub verified_records: usize,
    pub removable_keys: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryNotice {
    pub interrupted: bool,
    pub previous_session_id: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRecord {
    pub id: String,
    pub value: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileClientRecord {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub last_seen_at: String,
    pub revoked_at: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct MobileStoredMessage {
    pub content: String,
    pub attachments: Vec<Value>,
}

#[derive(Debug, Clone)]
pub(crate) struct MobileStoredAttachment {
    pub path: PathBuf,
    pub label: String,
    pub mime_type: String,
}

fn timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .local_data_dir()
        .map_err(|error| error.to_string())?
        .join("Nebula");
    fs::create_dir_all(root.join("data")).map_err(|error| error.to_string())?;
    fs::create_dir_all(root.join("backups")).map_err(|error| error.to_string())?;
    Ok(root)
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_root(app)?.join("data").join("nebula.db"))
}

fn open(app: &AppHandle) -> Result<Connection, String> {
    let connection = Connection::open(database_path(app)?).map_err(|error| error.to_string())?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| error.to_string())?;
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS app_sessions (
           id TEXT PRIMARY KEY, started_at TEXT NOT NULL, ended_at TEXT, status TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS conversation_folders (
           id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS conversations (
           id TEXT PRIMARY KEY, title TEXT NOT NULL, project_folder TEXT, folder_id TEXT,
           pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
           FOREIGN KEY(folder_id) REFERENCES conversation_folders(id) ON DELETE SET NULL
         );
         CREATE TABLE IF NOT EXISTS messages (
           id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
           role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL,
           tool_result_json TEXT, attachments_json TEXT,
           FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
         );
         CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, ordinal);
         CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
         CREATE VIRTUAL TABLE IF NOT EXISTS conversation_search USING fts5(
           conversation_id UNINDEXED, message_id UNINDEXED, title, content
         );
         CREATE TABLE IF NOT EXISTS documents (
           namespace TEXT NOT NULL, id TEXT NOT NULL, value_json TEXT NOT NULL,
           created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
           PRIMARY KEY(namespace, id)
         );
         CREATE INDEX IF NOT EXISTS idx_documents_namespace ON documents(namespace, updated_at DESC);"
    ).map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS mobile_clients (
           id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
           created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT
         );
         CREATE INDEX IF NOT EXISTS idx_mobile_clients_token ON mobile_clients(token_hash);
         CREATE TABLE IF NOT EXISTS mobile_audit (
           id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT, event TEXT NOT NULL,
           detail TEXT, created_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_mobile_audit_created ON mobile_audit(created_at DESC);",
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
            params![SCHEMA_VERSION, timestamp()],
        )
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

pub(crate) fn mobile_create_client(
    app: &AppHandle,
    id: &str,
    name: &str,
    token_hash: &str,
) -> Result<MobileClientRecord, String> {
    let connection = open(app)?;
    let now = timestamp();
    connection.execute(
        "INSERT INTO mobile_clients(id,name,token_hash,created_at,last_seen_at) VALUES (?1,?2,?3,?4,?4)",
        params![id, name, token_hash, now],
    ).map_err(|error| error.to_string())?;
    mobile_audit(app, Some(id), "paired", Some(name))?;
    Ok(MobileClientRecord {
        id: id.into(),
        name: name.into(),
        created_at: now.clone(),
        last_seen_at: now,
        revoked_at: None,
    })
}

pub(crate) fn mobile_find_client(
    app: &AppHandle,
    token_hash: &str,
) -> Result<Option<MobileClientRecord>, String> {
    let connection = open(app)?;
    connection.query_row(
        "SELECT id,name,created_at,last_seen_at,revoked_at FROM mobile_clients WHERE token_hash=?1 AND revoked_at IS NULL",
        params![token_hash],
        |row| Ok(MobileClientRecord {
            id: row.get(0)?, name: row.get(1)?, created_at: row.get(2)?,
            last_seen_at: row.get(3)?, revoked_at: row.get(4)?,
        }),
    ).optional().map_err(|error| error.to_string())
}

pub(crate) fn mobile_touch_client(app: &AppHandle, id: &str) -> Result<(), String> {
    open(app)?
        .execute(
            "UPDATE mobile_clients SET last_seen_at=?1 WHERE id=?2",
            params![timestamp(), id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn mobile_list_clients(app: &AppHandle) -> Result<Vec<MobileClientRecord>, String> {
    let connection = open(app)?;
    let mut statement = connection.prepare(
        "SELECT id,name,created_at,last_seen_at,revoked_at FROM mobile_clients ORDER BY created_at DESC"
    ).map_err(|error| error.to_string())?;
    let clients = statement
        .query_map([], |row| {
            Ok(MobileClientRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                last_seen_at: row.get(3)?,
                revoked_at: row.get(4)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(clients)
}

pub(crate) fn mobile_revoke_client(app: &AppHandle, id: &str) -> Result<(), String> {
    open(app)?
        .execute(
            "UPDATE mobile_clients SET revoked_at=?1 WHERE id=?2 AND revoked_at IS NULL",
            params![timestamp(), id],
        )
        .map_err(|error| error.to_string())?;
    mobile_audit(app, Some(id), "revoked", None)
}

pub(crate) fn mobile_audit(
    app: &AppHandle,
    client_id: Option<&str>,
    event: &str,
    detail: Option<&str>,
) -> Result<(), String> {
    let clean_detail = detail.map(|value| value.chars().take(300).collect::<String>());
    open(app)?
        .execute(
            "INSERT INTO mobile_audit(client_id,event,detail,created_at) VALUES (?1,?2,?3,?4)",
            params![client_id, event, clean_detail, timestamp()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn mobile_create_conversation(
    app: &AppHandle,
    id: &str,
    title: &str,
) -> Result<Value, String> {
    let mut connection = open(app)?;
    let tx = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let now = timestamp();
    let message_id = format!("mobile-boot-{id}");
    tx.execute(
        "INSERT INTO conversations(id,title,pinned,created_at,updated_at) VALUES (?1,?2,0,?3,?3)",
        params![id, title, now],
    )
    .map_err(|error| error.to_string())?;
    let greeting =
        "Nebula online. Your phone is connected securely to the assistant running on your PC.";
    tx.execute(
        "INSERT INTO messages(id,conversation_id,ordinal,role,content,created_at) VALUES (?1,?2,0,'assistant',?3,?4)",
        params![message_id, id, greeting, now],
    ).map_err(|error| error.to_string())?;
    tx.execute(
        "INSERT INTO conversation_search(conversation_id,message_id,title,content) VALUES (?1,?2,?3,?4)",
        params![id, message_id, title, greeting],
    ).map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(
        json!({"id":id,"title":title,"projectFolder":Value::Null,"folderId":Value::Null,"pinned":false,"createdAt":now,"updatedAt":now,"messages":[{"id":message_id,"role":"assistant","content":greeting,"createdAt":now}]}),
    )
}

pub(crate) fn mobile_update_conversation(
    app: &AppHandle,
    id: &str,
    title: Option<&str>,
    pinned: Option<bool>,
) -> Result<Value, String> {
    let mut connection = open(app)?;
    let tx = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let existing = tx
        .query_row(
            "SELECT title,pinned,created_at FROM conversations WHERE id=?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)? != 0,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Conversation not found.".to_string())?;
    let clean_title = title
        .map(|value| {
            value
                .chars()
                .filter(|ch| !ch.is_control())
                .take(96)
                .collect::<String>()
        })
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or(existing.0);
    let next_pinned = pinned.unwrap_or(existing.1);
    let updated_at = timestamp();
    tx.execute(
        "UPDATE conversations SET title=?2,pinned=?3,updated_at=?4 WHERE id=?1",
        params![id, clean_title, next_pinned as i64, updated_at],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE conversation_search SET title=?2 WHERE conversation_id=?1",
        params![id, clean_title],
    )
    .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(json!({
        "id": id, "title": clean_title, "pinned": next_pinned,
        "createdAt": existing.2, "updatedAt": updated_at
    }))
}

pub(crate) fn mobile_delete_conversation(app: &AppHandle, id: &str) -> Result<String, String> {
    let mut connection = open(app)?;
    let tx = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM conversations WHERE id=?1)",
            params![id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !exists {
        return Err("Conversation not found.".into());
    }
    tx.execute(
        "DELETE FROM conversation_search WHERE conversation_id=?1",
        params![id],
    )
    .map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM conversations WHERE id=?1", params![id])
        .map_err(|error| error.to_string())?;
    let next_id = tx
        .query_row(
            "SELECT id FROM conversations ORDER BY pinned DESC,updated_at DESC LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or_default();
    let active_id = tx
        .query_row(
            "SELECT value FROM app_meta WHERE key='conversation_active_id'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or_default();
    if active_id == id || active_id.is_empty() {
        tx.execute(
            "INSERT INTO app_meta(key,value) VALUES ('conversation_active_id',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![next_id],
        )
        .map_err(|error| error.to_string())?;
    }
    tx.commit().map_err(|error| error.to_string())?;
    Ok(next_id)
}

pub(crate) fn mobile_get_user_message(
    app: &AppHandle,
    conversation_id: &str,
    message_id: &str,
) -> Result<Option<MobileStoredMessage>, String> {
    open(app)?
        .query_row(
            "SELECT content,attachments_json FROM messages WHERE id=?1 AND conversation_id=?2 AND role='user'",
            params![message_id, conversation_id],
            |row| {
                let attachments: Option<String> = row.get(1)?;
                Ok(MobileStoredMessage {
                    content: row.get(0)?,
                    attachments: attachments
                        .and_then(|value| serde_json::from_str::<Vec<Value>>(&value).ok())
                        .unwrap_or_default(),
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
}

pub(crate) fn mobile_find_attachment(
    app: &AppHandle,
    id: &str,
) -> Result<Option<MobileStoredAttachment>, String> {
    let connection = open(app)?;
    let mut statement = connection
        .prepare("SELECT attachments_json FROM messages WHERE attachments_json IS NOT NULL")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    for row in rows {
        let raw = row.map_err(|error| error.to_string())?;
        let attachments = serde_json::from_str::<Vec<Value>>(&raw).unwrap_or_default();
        for attachment in attachments {
            if attachment.get("id").and_then(Value::as_str) != Some(id) {
                continue;
            }
            let Some(path) = attachment.get("path").and_then(Value::as_str) else {
                continue;
            };
            let detail_mime = attachment
                .get("detail")
                .and_then(Value::as_str)
                .and_then(|value| value.strip_prefix("Mobile upload - "));
            return Ok(Some(MobileStoredAttachment {
                path: PathBuf::from(path),
                label: attachment
                    .get("label")
                    .and_then(Value::as_str)
                    .unwrap_or("attachment")
                    .to_string(),
                mime_type: attachment
                    .get("mimeType")
                    .and_then(Value::as_str)
                    .or(detail_mime)
                    .unwrap_or("application/octet-stream")
                    .to_string(),
            }));
        }
    }
    Ok(None)
}

fn write_conversation_store(tx: &Transaction<'_>, store: &Value) -> Result<usize, String> {
    let folders = store
        .get("folders")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let sessions = store
        .get("sessions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    tx.execute("DELETE FROM conversation_search", [])
        .map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM messages", [])
        .map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM conversations", [])
        .map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM conversation_folders", [])
        .map_err(|error| error.to_string())?;
    let mut count = 0;
    for folder in folders {
        tx.execute(
            "INSERT INTO conversation_folders(id,name,created_at,updated_at) VALUES (?1,?2,?3,?4)",
            params![
                folder.get("id").and_then(Value::as_str).unwrap_or_default(),
                folder
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("Folder"),
                folder
                    .get("createdAt")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                folder
                    .get("updatedAt")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            ],
        )
        .map_err(|error| error.to_string())?;
        count += 1;
    }
    for session in sessions {
        let id = session
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        let title = session
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("New chat");
        tx.execute(
            "INSERT INTO conversations(id,title,project_folder,folder_id,pinned,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![
                id, title,
                session.get("projectFolder").and_then(Value::as_str),
                session.get("folderId").and_then(Value::as_str),
                session.get("pinned").and_then(Value::as_bool).unwrap_or(false) as i32,
                session.get("createdAt").and_then(Value::as_str).unwrap_or_default(),
                session.get("updatedAt").and_then(Value::as_str).unwrap_or_default(),
            ],
        ).map_err(|error| error.to_string())?;
        count += 1;
        for (ordinal, message) in session
            .get("messages")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
        {
            let message_id = message
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if message_id.is_empty() {
                continue;
            }
            let role = message
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or("assistant");
            let content = message
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or_default();
            tx.execute(
                "INSERT INTO messages(id,conversation_id,ordinal,role,content,created_at,tool_result_json,attachments_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![
                    message_id, id, ordinal as i64, role, content,
                    message.get("createdAt").and_then(Value::as_str).unwrap_or_default(),
                    message.get("toolResult").filter(|value| !value.is_null()).map(Value::to_string),
                    message.get("attachments").filter(|value| !value.is_null()).map(Value::to_string),
                ],
            ).map_err(|error| error.to_string())?;
            tx.execute(
                "INSERT INTO conversation_search(conversation_id,message_id,title,content) VALUES (?1,?2,?3,?4)",
                params![id, message_id, title, content],
            ).map_err(|error| error.to_string())?;
            count += 1;
        }
    }
    tx.execute(
        "INSERT INTO app_meta(key,value) VALUES ('conversation_active_id',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![store.get("activeId").and_then(Value::as_str).unwrap_or_default()],
    ).map_err(|error| error.to_string())?;
    Ok(count)
}

#[tauri::command]
pub fn storage_initialize(app: AppHandle) -> Result<RecoveryNotice, String> {
    let connection = open(&app)?;
    let previous: Option<String> = connection
        .query_row(
            "SELECT id FROM app_sessions WHERE status='running' ORDER BY started_at DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "UPDATE app_sessions SET status='interrupted', ended_at=?1 WHERE status='running'",
            params![timestamp()],
        )
        .map_err(|error| error.to_string())?;
    let session_id = format!("session-{}", timestamp());
    connection
        .execute(
            "INSERT INTO app_sessions(id,started_at,status) VALUES (?1,?2,'running')",
            params![session_id, timestamp()],
        )
        .map_err(|error| error.to_string())?;
    Ok(RecoveryNotice {
        interrupted: previous.is_some(),
        previous_session_id: previous,
        message: None,
    })
}

#[tauri::command]
pub fn storage_close_session(app: AppHandle) -> Result<(), String> {
    let connection = open(&app)?;
    connection
        .execute(
            "UPDATE app_sessions SET status='closed', ended_at=?1 WHERE status='running'",
            params![timestamp()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn storage_load_conversations(app: AppHandle) -> Result<Option<Value>, String> {
    let connection = open(&app)?;
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM conversations", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if count == 0 {
        return Ok(None);
    }
    let active_id: String = connection
        .query_row(
            "SELECT value FROM app_meta WHERE key='conversation_active_id'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or_default();
    let mut folder_stmt = connection.prepare("SELECT id,name,created_at,updated_at FROM conversation_folders ORDER BY updated_at DESC").map_err(|error| error.to_string())?;
    let folders = folder_stmt.query_map([], |row| Ok(json!({"id":row.get::<_,String>(0)?,"name":row.get::<_,String>(1)?,"createdAt":row.get::<_,String>(2)?,"updatedAt":row.get::<_,String>(3)?}))).map_err(|error| error.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|error| error.to_string())?;
    let mut session_stmt = connection.prepare("SELECT id,title,project_folder,folder_id,pinned,created_at,updated_at FROM conversations ORDER BY pinned DESC, updated_at DESC LIMIT 48").map_err(|error| error.to_string())?;
    let sessions_raw = session_stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, i64>(4)? != 0,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let mut sessions = Vec::new();
    for (id, title, project_folder, folder_id, pinned, created_at, updated_at) in sessions_raw {
        let mut message_stmt = connection.prepare("SELECT id,role,content,created_at,tool_result_json,attachments_json FROM messages WHERE conversation_id=?1 ORDER BY ordinal ASC").map_err(|error| error.to_string())?;
        let messages = message_stmt.query_map(params![id], |row| {
            let tool: Option<String> = row.get(4)?;
            let attachments: Option<String> = row.get(5)?;
            Ok(json!({
                "id": row.get::<_,String>(0)?, "role": row.get::<_,String>(1)?, "content": row.get::<_,String>(2)?, "createdAt": row.get::<_,String>(3)?,
                "toolResult": tool.and_then(|value| serde_json::from_str::<Value>(&value).ok()),
                "attachments": attachments.and_then(|value| serde_json::from_str::<Value>(&value).ok())
            }))
        }).map_err(|error| error.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|error| error.to_string())?;
        sessions.push(json!({"id":id,"title":title,"projectFolder":project_folder,"folderId":folder_id,"pinned":pinned,"createdAt":created_at,"updatedAt":updated_at,"messages":messages}));
    }
    Ok(Some(
        json!({"version":2,"activeId":active_id,"sessions":sessions,"folders":folders}),
    ))
}

#[tauri::command]
pub fn storage_save_conversations(app: AppHandle, store: Value) -> Result<usize, String> {
    let mut connection = open(&app)?;
    let tx = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let count = write_conversation_store(&tx, &store)?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(count)
}

#[tauri::command]
pub fn storage_search_conversations(
    app: AppHandle,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<Value>, String> {
    let connection = open(&app)?;
    search_conversation_rows(&connection, &query, limit.unwrap_or(40).min(100))
}

fn search_conversation_rows(
    connection: &Connection,
    query: &str,
    limit: usize,
) -> Result<Vec<Value>, String> {
    let clean = query
        .split_whitespace()
        .map(|term| format!("\"{}\"*", term.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" AND ");
    if clean.is_empty() {
        return Ok(Vec::new());
    }
    let result_limit = limit.clamp(1, 100);
    let scan_limit = (result_limit * 8).min(800);
    let mut statement = connection
        .prepare(
            "SELECT conversation_search.conversation_id, c.title, c.folder_id, c.project_folder,
                snippet(conversation_search,3,'','', '...',18) AS excerpt,
                bm25(conversation_search) AS rank, c.updated_at
         FROM conversation_search
         JOIN conversations c ON c.id=conversation_search.conversation_id
         WHERE conversation_search MATCH ?1
         ORDER BY bm25(conversation_search), c.updated_at DESC
         LIMIT ?2",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement.query_map(params![clean, scan_limit as i64], |row| Ok(json!({
        "conversationId":row.get::<_,String>(0)?,"title":row.get::<_,String>(1)?,"folderId":row.get::<_,Option<String>>(2)?,"projectFolder":row.get::<_,Option<String>>(3)?,"excerpt":row.get::<_,String>(4)?,"score":-row.get::<_,f64>(5)?,"updatedAt":row.get::<_,String>(6)?
    }))).map_err(|error| error.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|error| error.to_string())?;
    let mut seen = HashSet::new();
    Ok(rows
        .into_iter()
        .filter(|result| {
            result
                .get("conversationId")
                .and_then(Value::as_str)
                .map(|id| seen.insert(id.to_string()))
                .unwrap_or(false)
        })
        .take(result_limit)
        .collect())
}

#[tauri::command]
pub fn storage_put_document(
    app: AppHandle,
    namespace: String,
    id: String,
    value: Value,
) -> Result<(), String> {
    let connection = open(&app)?;
    let now = timestamp();
    connection.execute(
        "INSERT INTO documents(namespace,id,value_json,created_at,updated_at) VALUES (?1,?2,?3,?4,?4) ON CONFLICT(namespace,id) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
        params![namespace,id,value.to_string(),now],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn storage_get_document(
    app: AppHandle,
    namespace: String,
    id: String,
) -> Result<Option<Value>, String> {
    let connection = open(&app)?;
    let raw: Option<String> = connection
        .query_row(
            "SELECT value_json FROM documents WHERE namespace=?1 AND id=?2",
            params![namespace, id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    raw.map(|value| serde_json::from_str(&value).map_err(|error| error.to_string()))
        .transpose()
}

#[tauri::command]
pub fn storage_list_documents(
    app: AppHandle,
    namespace: String,
) -> Result<Vec<DocumentRecord>, String> {
    let connection = open(&app)?;
    let mut statement = connection.prepare("SELECT id,value_json,created_at,updated_at FROM documents WHERE namespace=?1 ORDER BY updated_at DESC").map_err(|error| error.to_string())?;
    let documents = statement
        .query_map(params![namespace], |row| {
            let raw: String = row.get(1)?;
            Ok(DocumentRecord {
                id: row.get(0)?,
                value: serde_json::from_str(&raw).unwrap_or(Value::Null),
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(documents)
}

#[tauri::command]
pub fn storage_delete_document(
    app: AppHandle,
    namespace: String,
    id: String,
) -> Result<(), String> {
    open(&app)?
        .execute(
            "DELETE FROM documents WHERE namespace=?1 AND id=?2",
            params![namespace, id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn retain_backups(directory: &Path) {
    let Ok(read_dir) = fs::read_dir(directory) else {
        return;
    };
    let mut files = read_dir
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            name.starts_with("legacy-storage-")
                .then_some((name, entry.path()))
        })
        .collect::<Vec<_>>();
    files.sort_by(|left, right| right.0.cmp(&left.0));
    for (_, path) in files.into_iter().skip(3) {
        let _ = fs::remove_file(path);
    }
}

#[tauri::command]
pub fn storage_migrate_legacy(
    app: AppHandle,
    entries: Vec<LegacyEntry>,
) -> Result<StorageMigrationReport, String> {
    let mut connection = open(&app)?;
    let complete: Option<String> = connection
        .query_row(
            "SELECT value FROM app_meta WHERE key='legacy_migration_complete'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if complete.as_deref() == Some("1") {
        return Ok(StorageMigrationReport {
            success: true,
            already_complete: true,
            backup_path: None,
            imported_keys: 0,
            imported_records: 0,
            verified_records: 0,
            removable_keys: Vec::new(),
            error: None,
        });
    }
    let backup_dir = data_root(&app)?.join("backups");
    let backup_path = backup_dir.join(format!("legacy-storage-{}.json", timestamp()));
    fs::write(
        &backup_path,
        serde_json::to_vec_pretty(&entries).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let tx = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let mut imported_records = 0;
    let mut removable_keys = Vec::new();
    for entry in &entries {
        let parsed: Value = match serde_json::from_str(&entry.value) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if entry.key == "nebula-conversations-v1" {
            imported_records += write_conversation_store(&tx, &parsed)?;
        } else {
            tx.execute(
                "INSERT INTO documents(namespace,id,value_json,created_at,updated_at) VALUES ('app-state',?1,?2,?3,?3) ON CONFLICT(namespace,id) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
                params![entry.key, parsed.to_string(), timestamp()],
            ).map_err(|error| error.to_string())?;
            imported_records += 1;
        }
        removable_keys.push(entry.key.clone());
    }
    let documents: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM documents WHERE namespace='app-state'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let conversation_records: i64 = tx.query_row("SELECT (SELECT COUNT(*) FROM conversations)+(SELECT COUNT(*) FROM conversation_folders)+(SELECT COUNT(*) FROM messages)", [], |row| row.get(0)).map_err(|error| error.to_string())?;
    let verified_records = documents as usize + conversation_records as usize;
    if verified_records < imported_records {
        return Ok(StorageMigrationReport {
            success: false,
            already_complete: false,
            backup_path: Some(backup_path.to_string_lossy().to_string()),
            imported_keys: entries.len(),
            imported_records,
            verified_records,
            removable_keys: Vec::new(),
            error: Some(
                "Imported record verification failed; legacy data was left untouched.".into(),
            ),
        });
    }
    tx.execute("INSERT INTO app_meta(key,value) VALUES ('legacy_migration_complete','1') ON CONFLICT(key) DO UPDATE SET value='1'", []).map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;
    retain_backups(&backup_dir);
    Ok(StorageMigrationReport {
        success: true,
        already_complete: false,
        backup_path: Some(backup_path.to_string_lossy().to_string()),
        imported_keys: entries.len(),
        imported_records,
        verified_records,
        removable_keys,
        error: None,
    })
}

#[tauri::command]
pub fn storage_export_diagnostics(app: AppHandle, payload: Value) -> Result<String, String> {
    fn redact(value: &mut Value) {
        match value {
            Value::Object(map) => {
                for (key, child) in map.iter_mut() {
                    let lower = key.to_lowercase();
                    if lower.contains("key")
                        || lower.contains("token")
                        || lower.contains("credential")
                        || lower.contains("prompt")
                        || lower.contains("content")
                    {
                        *child = Value::String("[REDACTED]".into());
                    } else {
                        redact(child);
                    }
                }
            }
            Value::Array(values) => values.iter_mut().for_each(redact),
            _ => {}
        }
    }
    let mut safe = payload;
    redact(&mut safe);
    let path = data_root(&app)?.join(format!("nebula-diagnostics-{}.json", timestamp()));
    fs::write(
        &path,
        serde_json::to_vec_pretty(&safe).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_redaction_keys_are_case_insensitive() {
        let mut value = json!({"apiKey":"secret","nested":{"TOKEN":"secret","status":"ok"}});
        fn redact_test(value: &mut Value) {
            match value {
                Value::Object(map) => {
                    for (key, child) in map {
                        if ["key", "token", "credential", "prompt", "content"]
                            .iter()
                            .any(|term| key.to_lowercase().contains(term))
                        {
                            *child = json!("[REDACTED]");
                        } else {
                            redact_test(child);
                        }
                    }
                }
                Value::Array(items) => items.iter_mut().for_each(redact_test),
                _ => {}
            }
        }
        redact_test(&mut value);
        assert_eq!(value["apiKey"], "[REDACTED]");
        assert_eq!(value["nested"]["TOKEN"], "[REDACTED]");
        assert_eq!(value["nested"]["status"], "ok");
    }

    #[test]
    fn conversation_search_ranks_and_deduplicates_matches() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE conversations (
                   id TEXT PRIMARY KEY, title TEXT NOT NULL, project_folder TEXT, folder_id TEXT,
                   updated_at TEXT NOT NULL
                 );
                 CREATE VIRTUAL TABLE conversation_search USING fts5(
                   conversation_id UNINDEXED, message_id UNINDEXED, title, content
                 );
                 INSERT INTO conversations VALUES ('one','Nebula mobile',NULL,NULL,'2026-07-16');
                 INSERT INTO conversations VALUES ('two','Bridge notes',NULL,NULL,'2026-07-15');
                 INSERT INTO conversation_search VALUES ('one','m1','Nebula mobile','Nebula pairing works');
                 INSERT INTO conversation_search VALUES ('one','m2','Nebula mobile','Nebula streams replies');
                 INSERT INTO conversation_search VALUES ('two','m3','Bridge notes','Nebula uses a private bridge');",
            )
            .unwrap();

        let results = search_conversation_rows(&connection, "nebula", 40).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0]["conversationId"], "one");
        assert_eq!(
            results
                .iter()
                .filter(|item| item["conversationId"] == "one")
                .count(),
            1
        );
    }
}
