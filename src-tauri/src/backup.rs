//! Backup export/import — the Tauri app's OWN JSON format (version 1).
//!
//! This is deliberately not the Electron v8 format: the Tauri side uses a
//! fresh data store (phase-1 decision), so its backup carries exactly the
//! domains it owns — settings, tasks/projects, active task, reminder history.
//! Import replaces all of them atomically with a rollback snapshot kept in
//! the data directory (mirrors the Electron import's rollback discipline).

use crate::types::{sanitize_project, sanitize_task, Project, ReminderEvent, Settings, Task};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const BACKUP_KIND: &str = "eyeprotect-tauri-backup";
pub const BACKUP_VERSION: u64 = 1;
const MAX_BACKUP_BYTES: usize = 5 * 1024 * 1024;

pub struct BackupPayload {
  pub settings: Settings,
  pub tasks: Vec<Task>,
  pub projects: Vec<Project>,
  pub active_task_id: Option<String>,
  pub reminder_history: Vec<ReminderEvent>,
  pub created_at: u64,
  pub app_version: String,
}

pub fn build_backup_text(payload: &BackupPayload) -> String {
  let value = json!({
    "kind": BACKUP_KIND,
    "version": BACKUP_VERSION,
    "createdAt": payload.created_at,
    "appVersion": payload.app_version,
    "settings": payload.settings,
    "tasks": payload.tasks,
    "projects": payload.projects,
    "activeTaskId": payload.active_task_id,
    "reminderHistory": payload.reminder_history,
  });
  format!("{}\n", serde_json::to_string_pretty(&value).unwrap_or_default())
}

pub fn domain_files(data_dir: &Path, payload: &BackupPayload) -> Result<Vec<(PathBuf, Value, bool)>, String> {
  let tasks = crate::tasks::TaskCore::from_parts(
    payload.tasks.clone(), payload.projects.clone(), payload.active_task_id.clone(),
  );
  Ok(vec![
    (data_dir.join("tasks.json"), serde_json::to_value(tasks.to_file()).map_err(|error| error.to_string())?, false),
    (data_dir.join("settings.json"), crate::state::settings_value(&payload.settings).map_err(|error| error.to_string())?, true),
    (data_dir.join("reminder-history.json"), json!({"version": 1, "events": payload.reminder_history}), true),
  ])
}

pub fn parse_backup(text: &str) -> Result<BackupPayload, String> {
  if text.len() > MAX_BACKUP_BYTES {
    return Err("备份文件超过 5 MB 安全限制".into());
  }
  let value: Value =
    serde_json::from_str(text).map_err(|_| "无法读取备份文件".to_string())?;
  if value.get("kind").and_then(Value::as_str) != Some(BACKUP_KIND) {
    return Err("不是 EyeProtect (Tauri) 的备份文件".into());
  }
  if value.get("version").and_then(Value::as_u64) != Some(BACKUP_VERSION) {
    return Err("备份版本不受支持".into());
  }
  let created_at = value.get("createdAt").and_then(Value::as_u64).unwrap_or_default();
  let app_version = value
    .get("appVersion")
    .and_then(Value::as_str)
    .unwrap_or_default()
    .to_string();
  let settings = crate::types::sanitize_settings(
    value.get("settings").unwrap_or(&Value::Null),
  );
  let now = created_at.max(1);
  let mut tasks = Vec::new();
  for entry in value.get("tasks").and_then(Value::as_array).unwrap_or(&Vec::new()) {
    if let Some(task) = sanitize_task(entry, now) {
      tasks.push(task);
    }
  }
  let mut projects = Vec::new();
  for entry in value.get("projects").and_then(Value::as_array).unwrap_or(&Vec::new()) {
    if let Some(project) = sanitize_project(entry, now) {
      projects.push(project);
    }
  }
  let active_task_id = match value.get("activeTaskId") {
    Some(Value::String(id)) if !id.is_empty() && tasks.iter().any(|t| &t.id == id) => {
      Some(id.clone())
    }
    _ => None,
  };
  let mut reminder_history = Vec::new();
  for entry in value
    .get("reminderHistory")
    .and_then(Value::as_array)
    .unwrap_or(&Vec::new())
  {
    if let Some(event) = crate::history::sanitize_event(entry) {
      reminder_history.push(event);
    }
  }
  Ok(BackupPayload { settings, tasks, projects, active_task_id, reminder_history, created_at, app_version })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn payload() -> BackupPayload {
    let task = sanitize_task(
      &serde_json::json!({ "id": "t1", "title": "备份任务", "dueDate": "2026-03-01" }),
      1_000,
    )
    .unwrap();
    let project = sanitize_project(&serde_json::json!({ "id": "p1", "name": "清单" }), 1_000).unwrap();
    let mut settings = Settings::default();
    settings.eye_interval_minutes = 33;
    BackupPayload {
      settings,
      tasks: vec![task],
      projects: vec![project],
      active_task_id: Some("t1".into()),
      reminder_history: vec![ReminderEvent {
        timestamp: 1_000,
        kind: "eye".into(),
        scheduled_at: 900,
        shown_at: 1_000,
        action: "complete".into(),
        snooze_count: 0,
        mode: "focused".into(),
      }],
      created_at: 2_000,
      app_version: "1.10.0".into(),
    }
  }

  #[test]
  fn roundtrip_preserves_domains() {
    let text = build_backup_text(&payload());
    let parsed = parse_backup(&text).unwrap();
    assert_eq!(parsed.settings.eye_interval_minutes, 33);
    assert_eq!(parsed.tasks.len(), 1);
    assert_eq!(parsed.tasks[0].title, "备份任务");
    assert_eq!(parsed.projects[0].name, "清单");
    assert_eq!(parsed.active_task_id.as_deref(), Some("t1"));
    assert_eq!(parsed.reminder_history.len(), 1);
  }

  #[test]
  fn rejects_foreign_and_oversized_files() {
    assert!(parse_backup("{\"kind\":\"other\",\"version\":1}").is_err());
    let mut text = build_backup_text(&payload());
    let huge = " ".repeat(MAX_BACKUP_BYTES + 1);
    text.push_str(&huge);
    assert!(parse_backup(&text).is_err());
  }

  #[test]
  fn sanitize_drops_invalid_rows_and_dangling_active() {
    let mut text = build_backup_text(&payload());
    let mut value: Value = serde_json::from_str(&text).unwrap();
    value["tasks"].as_array_mut().unwrap().push(json!({ "id": "bad" }));
    value["activeTaskId"] = json!("missing-task");
    text = serde_json::to_string(&value).unwrap();
    let parsed = parse_backup(&text).unwrap();
    assert_eq!(parsed.tasks.len(), 1);
    assert_eq!(parsed.active_task_id, None);
  }
}
