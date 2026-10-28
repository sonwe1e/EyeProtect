//! Serde mirror of `src/shared/types.ts` plus the sanitizers the main process
//! applies on every ingress (settings load/save, task IPC input, persistence).
//!
//! Serialization must stay camelCase so the unchanged React renderer can talk
//! to this backend through the Tauri bridge without any payload adaptation.

use chrono::{Datelike, Local, TimeZone, Timelike};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

pub const TASK_STALE_WRITE_MESSAGE: &str =
  "写入冲突：任务已被其他操作更新，请基于最新内容重试";
pub const TASK_TITLE_MAX: usize = 120;
pub const TASK_NOTES_MAX: usize = 2000;
pub const TASK_TAGS_MAX: usize = 10;
pub const PROJECT_NAME_MAX: usize = 60;
pub const PROJECT_GOAL_MAX: usize = 240;
pub const TODO_TEXT_MAX: usize = 60;

// ── Calendar (civil-time arithmetic; mirrors shared/calendar.ts) ─────────────

/// Local calendar day rendered as `YYYY-MM-DD`.
pub fn local_date_key(timestamp: u64) -> String {
  let local = Local.timestamp_millis_opt(timestamp as i64).single().unwrap_or_else(Local::now);
  format!("{:04}-{:02}-{:02}", local.year(), local.month(), local.day())
}

/// The instant of wall-clock minute `minutes_of_day` (0–1439) on the local
/// calendar day containing `timestamp`. DST-safe via civil reconstruction.
pub fn local_date_at_minutes(timestamp: u64, minutes_of_day: u32) -> u64 {
  let local = Local.timestamp_millis_opt(timestamp as i64).single().unwrap_or_else(Local::now);
  let via = local
    .with_hour((minutes_of_day / 60).min(23))
    .and_then(|d| d.with_minute((minutes_of_day % 60).min(59)))
    .and_then(|d| d.with_second(0))
    .and_then(|d| d.with_nanosecond(0));
  match via {
    Some(at) => at.timestamp_millis().max(0) as u64,
    None => timestamp,
  }
}

/// Milliseconds until the next local midnight (DST-safe).
pub fn ms_until_next_local_midnight(now: u64) -> u64 {
  let local = Local.timestamp_millis_opt(now as i64).single().unwrap_or_else(Local::now);
  let tomorrow = (local + chrono::Duration::days(1))
    .with_hour(0)
    .and_then(|d| d.with_minute(0))
    .and_then(|d| d.with_second(0))
    .and_then(|d| d.with_nanosecond(0));
  match tomorrow {
    Some(t) => (t.timestamp_millis() - local.timestamp_millis()).max(0) as u64,
    None => 86_400_000,
  }
}

/// Add `days` calendar days keeping local wall-clock time.
pub fn add_local_days(timestamp: u64, days: i64) -> u64 {
  let local = Local.timestamp_millis_opt(timestamp as i64).single().unwrap_or_else(Local::now);
  (local + chrono::Duration::days(days)).timestamp_millis().max(0) as u64
}

/// Strict civil-date key check (mirrors `isLocalDateKey`).
pub fn is_local_date_key(value: &str) -> bool {
  let bytes = value.as_bytes();
  if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
    return false;
  }
  let digit = |b: u8| b.is_ascii_digit();
  if !(digit(bytes[0]) && digit(bytes[1]) && digit(bytes[2]) && digit(bytes[3])
    && digit(bytes[5]) && digit(bytes[6]) && digit(bytes[8]) && digit(bytes[9]))
  {
    return false;
  }
  let year: i32 = value[0..4].parse().unwrap_or(0);
  let month: u32 = value[5..7].parse().unwrap_or(0);
  let day: u32 = value[8..10].parse().unwrap_or(0);
  chrono::NaiveDate::from_ymd_opt(year, month, day)
    .map(|date| date.format("%Y-%m-%d").to_string() == value)
    .unwrap_or(false)
}

// ── Settings ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetPosition {
  pub x: i64,
  pub y: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
  pub eye_enabled: bool,
  pub walk_enabled: bool,
  pub eye_rest_seconds: u64,
  pub walk_rest_seconds: u64,
  pub pomodoro_minutes: u64,
  pub pomodoro_break_minutes: u64,
  pub eye_interval_minutes: u64,
  pub walk_interval_minutes: u64,
  pub snooze_minutes: u64,
  pub natural_break_minutes: u64,
  pub daily_capacity_minutes: u64,
  pub work_start_minutes: u64,
  pub work_end_minutes: u64,
  pub reminder_mode: String,
  pub pre_alert_seconds: u64,
  pub start_with_windows: bool,
  pub todo_bubble_enabled: bool,
  pub todo_bubble_task_ids: Vec<String>,
  pub pet_appearance: String,
  pub pet_companion: String,
  pub rest_reading_scale: f64,
  pub pet_outfit: String,
  pub pet_scale: f64,
  pub pet_motion: bool,
  pub pet_position: Option<PetPosition>,
  pub pet_positions_by_layout: HashMap<String, PetPosition>,
  pub dim_desktop: bool,
  pub history_enabled: bool,
  pub history_retention_days: u64,
  pub adaptive_enabled: bool,
  pub quiet_hours_enabled: bool,
  pub quiet_hours_start_minutes: u64,
  pub quiet_hours_end_minutes: u64,
  pub foreground_detection_enabled: bool,
  pub quiet_app_whitelist: Vec<String>,
  pub sound_enabled: bool,
  pub sound_volume: f64,
  pub fullscreen_dnd_enabled: bool,
  pub hotkeys_enabled: bool,
  pub theme: String,
  pub density: String,
  pub alarms: Vec<Value>,
  pub todos: Vec<Value>,
  pub active_task_id: Option<String>,
  pub hydration_enabled: bool,
  pub hydration_goal_cups: u64,
}

impl Default for Settings {
  fn default() -> Self {
    // Mirrors DEFAULT_SETTINGS in shared/types.ts.
    Settings {
      eye_enabled: true,
      walk_enabled: true,
      eye_rest_seconds: 30,
      walk_rest_seconds: 60,
      pomodoro_minutes: 25,
      pomodoro_break_minutes: 5,
      eye_interval_minutes: 20,
      walk_interval_minutes: 60,
      snooze_minutes: 5,
      natural_break_minutes: 5,
      daily_capacity_minutes: 360,
      work_start_minutes: 7 * 60,
      work_end_minutes: 21 * 60,
      reminder_mode: "focused".into(),
      pre_alert_seconds: 0,
      start_with_windows: false,
      todo_bubble_enabled: true,
      todo_bubble_task_ids: Vec::new(),
      pet_appearance: "cat".into(),
      pet_companion: "fighter".into(),
      rest_reading_scale: 1.0,
      pet_outfit: "classic".into(),
      pet_scale: 1.0,
      pet_motion: true,
      pet_position: None,
      pet_positions_by_layout: HashMap::new(),
      dim_desktop: true,
      history_enabled: true,
      history_retention_days: 30,
      adaptive_enabled: false,
      quiet_hours_enabled: false,
      quiet_hours_start_minutes: 22 * 60,
      quiet_hours_end_minutes: 8 * 60,
      foreground_detection_enabled: false,
      quiet_app_whitelist: Vec::new(),
      sound_enabled: true,
      sound_volume: 0.6,
      fullscreen_dnd_enabled: false,
      hotkeys_enabled: true,
      theme: "system".into(),
      density: "comfortable".into(),
      alarms: Vec::new(),
      todos: Vec::new(),
      active_task_id: None,
      hydration_enabled: true,
      hydration_goal_cups: 8,
    }
  }
}

fn clamp_u64(value: Option<&Value>, fallback: u64, min: u64, max: u64) -> u64 {
  match value.and_then(Value::as_f64) {
    Some(number) if number.is_finite() => ((number.round() as i64).clamp(min as i64, max as i64)) as u64,
    _ => fallback,
  }
}

fn clamp_f64(value: Option<&Value>, fallback: f64, min: f64, max: f64) -> f64 {
  match value.and_then(Value::as_f64) {
    Some(number) if number.is_finite() => number.clamp(min, max),
    _ => fallback,
  }
}

fn bool_or(value: Option<&Value>, fallback: bool) -> bool {
  value.and_then(Value::as_bool).unwrap_or(fallback)
}

fn normalize_position(value: Option<&Value>) -> Option<PetPosition> {
  let obj = value?.as_object()?;
  let x = obj.get("x").and_then(Value::as_f64)?;
  let y = obj.get("y").and_then(Value::as_f64)?;
  if !x.is_finite() || !y.is_finite() {
    return None;
  }
  Some(PetPosition { x: x.round() as i64, y: y.round() as i64 })
}

fn sanitize_pet_positions_by_layout(value: Option<&Value>) -> HashMap<String, PetPosition> {
  let mut entries: Vec<(String, PetPosition)> = Vec::new();
  if let Some(map) = value.and_then(Value::as_object) {
    for (raw_key, raw_position) in map {
      let key: String = raw_key.trim().chars().take(240).collect();
      if let Some(position) = normalize_position(Some(raw_position)) {
        if !key.is_empty() {
          entries.push((key, position));
        }
      }
    }
  }
  let trimmed = if entries.len() > 20 { entries[entries.len() - 20..].to_vec() } else { entries };
  trimmed.into_iter().collect()
}

fn sanitize_quiet_app_whitelist(value: Option<&Value>) -> Vec<String> {
  let list = match value.and_then(Value::as_array) {
    Some(list) => list,
    None => return Vec::new(),
  };
  let mut seen = std::collections::HashSet::new();
  let mut result = Vec::new();
  for entry in list {
    let Some(text) = entry.as_str() else { continue };
    // Executable names only: strip any path and the .exe suffix.
    let name = text.trim();
    let base = name.rsplit(['\\', '/']).next().unwrap_or(name);
    let lowered = base.trim_end_matches(".exe").to_lowercase();
    let lowered: String = lowered.chars().take(80).collect();
    if !lowered.is_empty() && seen.insert(lowered.clone()) {
      result.push(lowered);
    }
    if result.len() >= 20 {
      break;
    }
  }
  result
}

fn sanitize_todo_bubble_task_ids(value: Option<&Value>) -> Vec<String> {
  let list = match value.and_then(Value::as_array) {
    Some(list) => list,
    None => return Vec::new(),
  };
  let mut seen = std::collections::HashSet::new();
  let mut result = Vec::new();
  for entry in list {
    if let Some(id) = entry.as_str() {
      if !id.trim().is_empty() && seen.insert(id.to_string()) {
        result.push(id.to_string());
      }
    }
  }
  result
}

/// Field-by-field repair of any partial settings object (mirrors
/// `sanitizeSettings` in src/main/settings.ts).
pub fn sanitize_settings(value: &Value) -> Settings {
  let obj = value.as_object().cloned().unwrap_or_default();
  let get = |key: &str| obj.get(key);

  let default = Settings::default();
  let mut work_start = clamp_u64(get("workStartMinutes"), default.work_start_minutes, 0, 23 * 60 + 59);
  let mut work_end = clamp_u64(get("workEndMinutes"), default.work_end_minutes, 1, 24 * 60);
  if work_start >= work_end {
    work_start = default.work_start_minutes;
    work_end = default.work_end_minutes;
  }

  Settings {
    eye_enabled: get("eyeEnabled").and_then(Value::as_bool).unwrap_or(true),
    walk_enabled: get("walkEnabled").and_then(Value::as_bool).unwrap_or(true),
    eye_rest_seconds: clamp_u64(get("eyeRestSeconds"), default.eye_rest_seconds, 5, 600),
    walk_rest_seconds: clamp_u64(get("walkRestSeconds"), default.walk_rest_seconds, 10, 1800),
    pomodoro_minutes: clamp_u64(get("pomodoroMinutes"), default.pomodoro_minutes, 1, 180),
    pomodoro_break_minutes: clamp_u64(get("pomodoroBreakMinutes"), default.pomodoro_break_minutes, 1, 60),
    eye_interval_minutes: clamp_u64(get("eyeIntervalMinutes"), default.eye_interval_minutes, 1, 240),
    walk_interval_minutes: clamp_u64(get("walkIntervalMinutes"), default.walk_interval_minutes, 1, 240),
    snooze_minutes: clamp_u64(get("snoozeMinutes"), default.snooze_minutes, 1, 60),
    natural_break_minutes: clamp_u64(get("naturalBreakMinutes"), default.natural_break_minutes, 1, 30),
    daily_capacity_minutes: clamp_u64(get("dailyCapacityMinutes"), default.daily_capacity_minutes, 60, 960),
    work_start_minutes: work_start,
    work_end_minutes: work_end,
    reminder_mode: match get("reminderMode").and_then(Value::as_str) {
      Some(mode) if ["gentle", "guided", "focused"].contains(&mode) => mode.to_string(),
      _ => default.reminder_mode,
    },
    pre_alert_seconds: clamp_u64(get("preAlertSeconds"), default.pre_alert_seconds, 0, 120),
    start_with_windows: bool_or(get("startWithWindows"), default.start_with_windows),
    todo_bubble_enabled: bool_or(get("todoBubbleEnabled"), default.todo_bubble_enabled),
    todo_bubble_task_ids: sanitize_todo_bubble_task_ids(get("todoBubbleTaskIds")),
    pet_appearance: match get("petAppearance").and_then(Value::as_str) {
      Some(animal) if animal == "cat" => animal.to_string(),
      _ => "cat".into(),
    },
    pet_companion: match get("petCompanion").and_then(Value::as_str) {
      Some(companion) if ["fighter", "otter", "penguin", "pixel", "custom"].contains(&companion) => {
        companion.to_string()
      }
      _ => default.pet_companion,
    },
    rest_reading_scale: clamp_f64(get("restReadingScale"), default.rest_reading_scale, 0.9, 1.5),
    pet_outfit: match get("petOutfit").and_then(Value::as_str) {
      Some(outfit) if ["classic", "coffee", "explorer", "stargazer"].contains(&outfit) => outfit.to_string(),
      _ => default.pet_outfit,
    },
    pet_scale: clamp_f64(get("petScale"), default.pet_scale, 0.5, 1.8),
    pet_motion: bool_or(get("petMotion"), default.pet_motion),
    pet_position: normalize_position(get("petPosition")),
    pet_positions_by_layout: sanitize_pet_positions_by_layout(get("petPositionsByLayout")),
    dim_desktop: bool_or(get("dimDesktop"), default.dim_desktop),
    history_enabled: bool_or(get("historyEnabled"), default.history_enabled),
    history_retention_days: match get("historyRetentionDays") {
      Some(Value::Number(number)) if number.as_u64() == Some(90) => 90,
      _ => default.history_retention_days,
    },
    adaptive_enabled: bool_or(get("adaptiveEnabled"), default.adaptive_enabled),
    quiet_hours_enabled: bool_or(get("quietHoursEnabled"), default.quiet_hours_enabled),
    quiet_hours_start_minutes: clamp_u64(get("quietHoursStartMinutes"), default.quiet_hours_start_minutes, 0, 24 * 60 - 1),
    quiet_hours_end_minutes: clamp_u64(get("quietHoursEndMinutes"), default.quiet_hours_end_minutes, 0, 24 * 60 - 1),
    foreground_detection_enabled: bool_or(get("foregroundDetectionEnabled"), default.foreground_detection_enabled),
    quiet_app_whitelist: sanitize_quiet_app_whitelist(get("quietAppWhitelist")),
    sound_enabled: bool_or(get("soundEnabled"), default.sound_enabled),
    sound_volume: clamp_f64(get("soundVolume"), default.sound_volume, 0.0, 1.0),
    fullscreen_dnd_enabled: bool_or(get("fullscreenDndEnabled"), default.fullscreen_dnd_enabled),
    hotkeys_enabled: bool_or(get("hotkeysEnabled"), default.hotkeys_enabled),
    theme: match get("theme").and_then(Value::as_str) {
      Some(theme) if ["system", "light", "dark"].contains(&theme) => theme.to_string(),
      _ => default.theme,
    },
    density: match get("density").and_then(Value::as_str) {
      Some(density) if ["comfortable", "compact"].contains(&density) => density.to_string(),
      _ => default.density,
    },
    alarms: Vec::new(),
    todos: Vec::new(),
    active_task_id: match get("activeTaskId") {
      Some(Value::String(id)) if !id.is_empty() => Some(id.clone()),
      _ => None,
    },
    hydration_enabled: bool_or(get("hydrationEnabled"), default.hydration_enabled),
    hydration_goal_cups: clamp_u64(get("hydrationGoalCups"), default.hydration_goal_cups, 1, 20),
  }
}

// ── Tasks / projects ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
  pub id: String,
  pub title: String,
  pub notes: Option<String>,
  pub status: String,
  pub priority: String,
  pub project_id: Option<String>,
  pub parent_id: Option<String>,
  pub tags: Vec<String>,
  pub planned_at: Option<u64>,
  pub due_at: Option<u64>,
  pub due_date: Option<String>,
  pub reminder_at: Option<u64>,
  /// Fresh Tauri store never writes recurrence; kept as raw JSON so a future
  /// migration can round-trip the legacy shape untouched.
  #[serde(default)]
  pub recurrence: Option<Value>,
  pub context: String,
  pub remind_on_break: bool,
  pub estimate_minutes: Option<u64>,
  pub section_id: Option<String>,
  pub sort_order: i64,
  pub created_at: u64,
  pub updated_at: u64,
  pub completed_at: Option<u64>,
  pub revision: u64,
}

impl Task {
  pub fn is_root(&self) -> bool {
    self.parent_id.is_none()
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
  pub id: String,
  pub name: String,
  pub goal: Option<String>,
  pub view_mode: String,
  pub color: Option<String>,
  pub parent_id: Option<String>,
  pub status: String,
  pub sort_order: i64,
  pub created_at: u64,
  pub updated_at: u64,
}

/// Only active and onHold lists accept editing (projectPolicy.ts).
pub fn is_project_writable(project: Option<&Project>) -> bool {
  matches!(project.map(|p| p.status.as_str()), Some("active") | Some("onHold"))
}

fn normalize_timestamp(value: Option<&Value>, fallback: Option<u64>) -> Option<u64> {
  match value {
    None | Some(Value::Null) => fallback,
    Some(v) => v
      .as_f64()
      .filter(|n| n.is_finite() && *n > 0.0)
      .map(|n| n as u64)
      .or(fallback),
  }
}

fn sanitize_tag_list(value: Option<&Value>) -> Vec<String> {
  let list = match value.and_then(Value::as_array) {
    Some(list) => list,
    None => return Vec::new(),
  };
  let mut seen = std::collections::HashSet::new();
  let mut result = Vec::new();
  for entry in list {
    let Some(text) = entry.as_str() else { continue };
    let tag: String = text.trim().chars().take(24).collect();
    if !tag.is_empty() && seen.insert(tag.clone()) {
      result.push(tag);
    }
    if result.len() >= TASK_TAGS_MAX {
      break;
    }
  }
  result
}

fn sanitize_project_color(value: Option<&Value>) -> Option<String> {
  let color = value?.as_str()?.trim();
  let valid = color.len() == 4 || color.len() == 7;
  let hex = valid
    && color.starts_with('#')
    && color[1..].chars().all(|c| c.is_ascii_hexdigit());
  if hex { Some(color.to_string()) } else { None }
}

/// Coerce arbitrary JSON into a Task, or reject (mirrors `sanitizeTask`).
pub fn sanitize_task(value: &Value, now: u64) -> Option<Task> {
  let obj = value.as_object()?;
  let id = obj.get("id").and_then(Value::as_str)?;
  if id.is_empty() {
    return None;
  }
  let title_raw = obj.get("title").and_then(Value::as_str)?;
  let title: String = title_raw.trim().chars().take(TASK_TITLE_MAX).collect();
  if title.is_empty() {
    return None;
  }
  let created_at = normalize_timestamp(obj.get("createdAt"), Some(now)).unwrap_or(now);
  let updated_at = normalize_timestamp(obj.get("updatedAt"), Some(created_at)).unwrap_or(created_at);
  let status = match obj.get("status").and_then(Value::as_str) {
    Some("done") | Some("archived") => obj.get("status").and_then(Value::as_str).unwrap().to_string(),
    Some("inbox") | Some("active") => "open".to_string(),
    _ => "open".to_string(),
  };
  let completed_at = if status == "done" {
    normalize_timestamp(obj.get("completedAt"), Some(updated_at))
  } else {
    None
  };
  let priority = match obj.get("priority").and_then(Value::as_str) {
    Some(p) if p == "important" || p == "urgent" => p.to_string(),
    _ => "normal".to_string(),
  };
  let notes = obj.get("notes").and_then(Value::as_str).map(|n| {
    let trimmed: String = n.trim().chars().take(TASK_NOTES_MAX).collect();
    trimmed
  });
  let due_date = obj
    .get("dueDate")
    .and_then(Value::as_str)
    .filter(|key| is_local_date_key(key))
    .map(str::to_string);
  let estimate_minutes = obj
    .get("estimateMinutes")
    .and_then(Value::as_f64)
    .filter(|n| n.is_finite() && *n > 0.0)
    .map(|n| n.round() as u64);
  let context = match obj.get("context").and_then(Value::as_str) {
    Some(c) if c == "away" || c == "any" => c.to_string(),
    _ => "desk".to_string(),
  };
  let remind_on_break = obj.get("remindOnBreak").and_then(Value::as_bool) == Some(true) && context != "desk";
  Some(Task {
    id: id.to_string(),
    title,
    notes,
    status,
    priority,
    project_id: obj.get("projectId").and_then(Value::as_str).filter(|v| !v.is_empty()).map(str::to_string),
    parent_id: obj.get("parentId").and_then(Value::as_str).filter(|v| !v.is_empty()).map(str::to_string),
    tags: sanitize_tag_list(obj.get("tags")),
    planned_at: normalize_timestamp(obj.get("plannedAt"), None),
    due_at: normalize_timestamp(obj.get("dueAt"), None),
    due_date,
    reminder_at: normalize_timestamp(obj.get("reminderAt"), None),
    recurrence: match obj.get("recurrence") {
      Some(Value::Null) | None => None,
      Some(value @ Value::Object(_)) => Some(value.clone()),
      Some(_) => None,
    },
    context,
    remind_on_break,
    estimate_minutes,
    section_id: obj.get("sectionId").and_then(Value::as_str).filter(|v| !v.is_empty()).map(str::to_string),
    sort_order: obj.get("sortOrder").and_then(Value::as_f64).filter(|n| n.is_finite()).map(|n| n.round() as i64).unwrap_or(0),
    created_at,
    updated_at,
    completed_at,
    revision: obj.get("revision").and_then(Value::as_u64).unwrap_or(1),
  })
}

/// Coerce arbitrary JSON into a Project, or reject (mirrors `sanitizeProject`).
pub fn sanitize_project(value: &Value, now: u64) -> Option<Project> {
  let obj = value.as_object()?;
  let id = obj.get("id").and_then(Value::as_str)?;
  if id.is_empty() {
    return None;
  }
  let name_raw = obj.get("name").and_then(Value::as_str)?;
  let name: String = name_raw.trim().chars().take(PROJECT_NAME_MAX).collect();
  if name.is_empty() {
    return None;
  }
  let created_at = normalize_timestamp(obj.get("createdAt"), Some(now)).unwrap_or(now);
  let updated_at = normalize_timestamp(obj.get("updatedAt"), Some(created_at)).unwrap_or(created_at);
  let goal = obj
    .get("goal")
    .and_then(Value::as_str)
    .map(|g| g.trim().chars().take(PROJECT_GOAL_MAX).collect::<String>())
    .filter(|g| !g.is_empty());
  Some(Project {
    id: id.to_string(),
    name,
    goal,
    view_mode: if obj.get("viewMode").and_then(Value::as_str) == Some("board") { "board".into() } else { "list".into() },
    color: sanitize_project_color(obj.get("color")),
    parent_id: obj.get("parentId").and_then(Value::as_str).filter(|v| !v.is_empty()).map(str::to_string),
    status: match obj.get("status").and_then(Value::as_str) {
      Some(status) if ["active", "onHold", "completed", "archived"].contains(&status) => status.to_string(),
      _ => "active".to_string(),
    },
    sort_order: obj.get("sortOrder").and_then(Value::as_f64).filter(|n| n.is_finite()).map(|n| n.round() as i64).unwrap_or(0),
    created_at,
    updated_at,
  })
}

// ── Queue helpers (shared/simpleTasks.ts) ────────────────────────────────────

pub fn is_simple_list(project: &Project) -> bool {
  project.status == "active" || project.status == "onHold"
}

fn is_queue_list(project_id: Option<&str>, projects: &[Project]) -> bool {
  match project_id {
    None => true,
    Some(id) => projects
      .iter()
      .any(|project| project.id == id && is_simple_list(project)),
  }
}

pub fn is_current_task(task: &Task, projects: &[Project]) -> bool {
  task.parent_id.is_none()
    && task.status != "archived"
    && is_queue_list(task.project_id.as_deref(), projects)
}

/// Manual order with the two deterministic fallbacks (sortOrder → createdAt → id).
pub fn by_queue_order(left: &Task, right: &Task) -> std::cmp::Ordering {
  left
    .sort_order
    .cmp(&right.sort_order)
    .then(left.created_at.cmp(&right.created_at))
    .then(left.id.cmp(&right.id))
}

pub fn order_simple_queue(tasks: &mut Vec<Task>) {
  tasks.sort_by(by_queue_order);
  // Open tasks first; completed/archived sink to the tail in manual order.
  let mut open: Vec<Task> = Vec::new();
  let mut done: Vec<Task> = Vec::new();
  for task in tasks.drain(..) {
    if task.status == "open" {
      open.push(task);
    } else {
      done.push(task);
    }
  }
  tasks.extend(open);
  tasks.extend(done);
}

/// Depth-first steps of one root (shared/simpleTasks.ts `taskSteps`).
pub fn task_steps<'a>(root_id: &str, tasks: &'a [Task]) -> Vec<&'a Task> {
  let mut result: Vec<&Task> = Vec::new();
  let mut seen: std::collections::HashSet<String> = [root_id.to_string()].into_iter().collect();
  fn visit<'a>(id: &str, tasks: &'a [Task], seen: &mut std::collections::HashSet<String>, result: &mut Vec<&'a Task>) {
    let mut children: Vec<&Task> = tasks.iter().filter(|task| task.parent_id.as_deref() == Some(id)).collect();
    children.sort_by(|a, b| a.sort_order.cmp(&b.sort_order).then(a.created_at.cmp(&b.created_at)));
    for child in children {
      if seen.contains(&child.id) {
        continue;
      }
      seen.insert(child.id.clone());
      result.push(child);
      visit(&child.id.clone(), tasks, seen, result);
    }
  }
  visit(root_id, tasks, &mut seen, &mut result);
  result
}

// ── Reminder / pomodoro / hydration payloads ─────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakTaskRef {
  pub id: String,
  pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveReminder {
  #[serde(skip_serializing_if = "Option::is_none")]
  pub rest_started_at: Option<u64>,
  pub id: String,
  pub kind: String,
  pub kinds: Vec<String>,
  pub started_at: u64,
  pub scheduled_at: u64,
  pub unlock_at: u64,
  pub snooze_allowed_at: u64,
  pub mode: String,
  pub snooze_count: u32,
  pub activity_ids: Vec<String>,
  pub break_task: Option<BreakTaskRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreAlertInfo {
  pub kind: String,
  pub fires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextDeferral {
  pub until: u64,
  pub reason: String,
  pub foreground_app: Option<String>,
  pub consecutive_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderStatus {
  pub next_eye_at: u64,
  pub next_walk_at: u64,
  pub paused_until: Option<u64>,
  pub active_reminder: Option<ActiveReminder>,
  pub pre_alert: Option<PreAlertInfo>,
  pub context_deferral: Option<ContextDeferral>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderEvent {
  pub timestamp: u64,
  pub kind: String,
  pub scheduled_at: u64,
  pub shown_at: u64,
  pub action: String,
  pub snooze_count: u32,
  pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestCompanionDay {
  pub date: String,
  pub completed: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestCompanionSummary {
  pub generated_at: u64,
  pub enabled: bool,
  pub completed: u32,
  pub message: String,
  pub days: Vec<RestCompanionDay>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroState {
  pub phase: String,
  pub running: bool,
  pub task_id: Option<String>,
  pub remaining_ms: u64,
  pub revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HydrationPrompt {
  pub id: String,
  pub phase: String,
  pub ends_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HydrationStatus {
  pub enabled: bool,
  pub goal_cups: u64,
  pub cups: u64,
  pub local_date: String,
  pub achieved: bool,
  pub prompt: Option<HydrationPrompt>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoState {
  pub operation_id: String,
  pub kind: String,
  pub task_title: String,
  pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomPetAssets {
  pub has_custom_pet: bool,
  pub idles: Vec<String>,
  pub clicks: Vec<String>,
  pub fidgets: Vec<String>,
  pub sleeps: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataActionResult {
  pub success: bool,
  pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
  pub app_version: String,
  pub is_packaged: bool,
  pub data_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppHealth {
  pub database: String,
  pub scheduler: String,
  pub notification: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatus {
  pub enabled: bool,
  pub registered: Vec<String>,
  pub conflicts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchNavPayload {
  pub section: String,
  pub focus_task_id: Option<String>,
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn local_date_key_roundtrip() {
    let now = Local::now().timestamp_millis() as u64;
    let key = local_date_key(now);
    assert!(is_local_date_key(&key));
    assert!(!is_local_date_key("2024-1-05"));
    assert!(!is_local_date_key("2024-13-01"));
    assert!(!is_local_date_key("2024-02-30"));
  }

  #[test]
  fn sanitize_settings_repairs_and_clamps() {
    let raw = serde_json::json!({
      "eyeIntervalMinutes": 999,
      "walkIntervalMinutes": "bad",
      "workStartMinutes": 20 * 60,
      "workEndMinutes": 8 * 60,
      "soundVolume": 3,
      "petCompanion": "otter",
      "petPositionsByLayout": { "k": { "x": 1.4, "y": 2.6 } }
    });
    let settings = sanitize_settings(&raw);
    assert_eq!(settings.eye_interval_minutes, 240);
    assert_eq!(settings.walk_interval_minutes, 60);
    // Inverted working window falls back to both defaults together.
    assert_eq!(settings.work_start_minutes, 7 * 60);
    assert_eq!(settings.work_end_minutes, 21 * 60);
    assert!((settings.sound_volume - 1.0).abs() < f64::EPSILON);
    assert_eq!(settings.pet_companion, "otter");
    assert_eq!(settings.pet_positions_by_layout["k"].x, 1);
  }

  #[test]
  fn sanitize_task_rejects_and_repairs() {
    let now = 1_700_000_000_000u64;
    assert!(sanitize_task(&serde_json::json!({ "id": "a", "title": "  " }), now).is_none());
    let task = sanitize_task(
      &serde_json::json!({
        "id": "a",
        "title": "  hi  ",
        "status": "inbox",
        "dueDate": "2024-02-30",
        "tags": ["x", "x", 3],
        "priority": "urgent"
      }),
      now,
    )
    .unwrap();
    assert_eq!(task.title, "hi");
    assert_eq!(task.status, "open");
    assert_eq!(task.due_date, None);
    assert_eq!(task.tags, vec!["x"]);
    assert_eq!(task.priority, "urgent");
  }

  #[test]
  fn queue_order_sinks_completed() {
    let mut tasks = vec![
      Task { id: "a".into(), status: "open".into(), sort_order: 10, created_at: 5, ..sample_task() },
      Task { id: "b".into(), status: "done".into(), sort_order: 1, created_at: 1, ..sample_task() },
      Task { id: "c".into(), status: "open".into(), sort_order: 1, created_at: 1, ..sample_task() },
    ];
    order_simple_queue(&mut tasks);
    let ids: Vec<&str> = tasks.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids, vec!["c", "a", "b"]);
  }

  fn sample_task() -> Task {
    Task {
      id: String::new(),
      title: "t".into(),
      notes: None,
      status: "open".into(),
      priority: "normal".into(),
      project_id: None,
      parent_id: None,
      tags: Vec::new(),
      planned_at: None,
      due_at: None,
      due_date: None,
      reminder_at: None,
      recurrence: None,
      context: "desk".into(),
      remind_on_break: false,
      estimate_minutes: None,
      section_id: None,
      sort_order: 0,
      created_at: 0,
      updated_at: 0,
      completed_at: None,
      revision: 1,
    }
  }
}
