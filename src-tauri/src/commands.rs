//! Tauri command handlers — the bridge surface the unchanged React renderer
//! talks to (the Rust counterpart of the `handleIpc` block in
//! `src/main/index.ts`).
//!
//! Conventions shared by every command:
//! - `state: tauri::State<'_, AppState>` guards the single `Core`; mutations
//!   set the matching dirty flag(s), drop the lock, then
//!   `crate::state::publish(&app, state.inner())` turns them into window
//!   events + file writes.
//! - Stateful synchronous functions use `#[tauri::command(async)]` so waiting
//!   for Core never blocks the event thread: a window update holding Core can
//!   need that thread to answer a synchronous window query.
//! - Command parameters are snake_case; the JS side passes camelCase keys and
//!   the bridge maps them automatically.
//! - Failures are `Result<_, String>` with the exact Chinese messages of the
//!   Electron handlers.
//!
//! Borrowing note: where one call mixes `&mut core.x` with `&core.y` (or two
//! `&mut` fields), the lock guard is first reborrowed (`let core = &mut
//! *guard;`) — the guard's `Deref` is a call boundary, so field-split borrows
//! only work on a real `&mut Core`.
//!
//! Pomodoro note: `state::pomodoro_context(&core, ..)` currently cannot be
//! used from here — its context borrows the whole `Core`, which conflicts
//! with the `&mut core.pomodoro` receiver, and its `&move` closure temporary
//! does not outlive the call. The pomodoro commands below therefore build an
//! equivalent `PomodoroContext` over an owned snapshot (`PomodoroCtxParts`)
//! with the same availability rule.

use base64::Engine as _;
use serde_json::{json, Value};
use tauri::Manager as _;
use tauri_plugin_opener::OpenerExt;

// ── Settings ─────────────────────────────────────────────────────────────────

#[tauri::command(async)]
pub fn settings_get(state: tauri::State<'_, crate::state::AppState>) -> crate::types::Settings {
  state.core.lock().unwrap().settings.clone()
}

#[tauri::command(async)]
pub fn settings_save(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  patch: Value,
) -> Result<crate::types::Settings, String> {
  let now = crate::state::now_ms();
  let mut core = state.core.lock().unwrap();
  let previous = core.settings.clone();

  // Shallow merge: same-named patch fields overlay the stored value.
  let mut merged = serde_json::to_value(&previous)
    .unwrap_or_else(|_| Value::Object(serde_json::Map::new()));
  if let (Some(base), Some(overlay)) = (merged.as_object_mut(), patch.as_object()) {
    for (key, value) in overlay {
      base.insert(key.clone(), value.clone());
    }
  }
  let next = crate::types::sanitize_settings(&merged);

  let autostart_changed = next.start_with_windows != previous.start_with_windows;
  if autostart_changed {
    crate::state::set_autostart(&app, next.start_with_windows)?;
  }
  // Do not apply the change or report success until it is durable. Restore
  // the previous OS startup setting if writing the preference fails.
  if let Err(error) = state.write_settings(&next) {
    if autostart_changed {
      if let Err(restore_error) = crate::state::set_autostart(&app, previous.start_with_windows) {
        return Err(format!("无法保存设置：{}；开机启动恢复失败：{}", error, restore_error));
      }
    }
    return Err(format!("无法保存设置：{}", error));
  }

  // Domain-scoped reactions (index.ts 733–790): only the subsystems whose
  // inputs actually changed re-sync.
  let reminder_domain_changed = next.eye_enabled != previous.eye_enabled
    || next.walk_enabled != previous.walk_enabled
    || next.eye_rest_seconds != previous.eye_rest_seconds
    || next.walk_rest_seconds != previous.walk_rest_seconds
    || next.eye_interval_minutes != previous.eye_interval_minutes
    || next.walk_interval_minutes != previous.walk_interval_minutes
    || next.snooze_minutes != previous.snooze_minutes
    || next.natural_break_minutes != previous.natural_break_minutes
    || next.reminder_mode != previous.reminder_mode
    || next.pre_alert_seconds != previous.pre_alert_seconds
    || next.adaptive_enabled != previous.adaptive_enabled
    || next.history_enabled != previous.history_enabled
    || next.quiet_hours_enabled != previous.quiet_hours_enabled
    || next.quiet_hours_start_minutes != previous.quiet_hours_start_minutes
    || next.quiet_hours_end_minutes != previous.quiet_hours_end_minutes
    || next.foreground_detection_enabled != previous.foreground_detection_enabled
    || next.fullscreen_dnd_enabled != previous.fullscreen_dnd_enabled
    || next.quiet_app_whitelist != previous.quiet_app_whitelist;
  if reminder_domain_changed {
    core.scheduler.update_settings(&next, &previous, now);
    core.dirty_reminder = true;
  }
  if next.history_retention_days != previous.history_retention_days {
    core.history.apply_retention(next.history_retention_days, now);
  }
  if next.pet_scale != previous.pet_scale
    || next.pet_companion != previous.pet_companion
    || next.rest_reading_scale != previous.rest_reading_scale
    || next.dim_desktop != previous.dim_desktop
  {
    // publish → apply_reminder_status restores the pet size / re-positions
    // the alert surface.
    core.dirty_reminder = true;
  }
  let hydration_domain_changed = next.hydration_enabled != previous.hydration_enabled
    || next.hydration_goal_cups != previous.hydration_goal_cups
    || next.work_start_minutes != previous.work_start_minutes
    || next.work_end_minutes != previous.work_end_minutes
    || next.pet_motion != previous.pet_motion;
  if hydration_domain_changed {
    core.hydration.on_settings_changed(&next, now);
    core.dirty_hydration = true;
  }

  core.settings = next.clone();
  core.dirty_settings = true;
  // Scene sampling follows the foreground/fullscreen DND settings
  // (Electron: contextMonitor.configure on every settings change).
  core.context.configure_from_settings(&next);
  let hotkeys_changed = core.settings.hotkeys_enabled != previous.hotkeys_enabled;
  drop(core);
  crate::state::publish(&app, state.inner());
  if hotkeys_changed {
    crate::state::apply_global_hotkeys(&app, state.inner());
  }
  Ok(next)
}

// ── App / runtime ────────────────────────────────────────────────────────────

#[tauri::command(async)]
pub fn runtime_get(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
) -> crate::types::RuntimeInfo {
  crate::types::RuntimeInfo {
    app_version: app.package_info().version.to_string(),
    is_packaged: !cfg!(debug_assertions),
    data_dir: state.data_dir.to_string_lossy().to_string(),
  }
}

#[tauri::command]
pub fn app_health_get() -> crate::types::AppHealth {
  crate::types::AppHealth {
    database: "healthy".into(),
    scheduler: "healthy".into(),
    notification: "available".into(),
  }
}

#[tauri::command]
pub fn app_relaunch(app: tauri::AppHandle) {
  // `restart` diverges; wrap so the command keeps the `()` return type.
  app.restart();
}

// ── Reminders ────────────────────────────────────────────────────────────────

#[tauri::command(async)]
pub fn reminder_status(
  state: tauri::State<'_, crate::state::AppState>,
) -> crate::types::ReminderStatus {
  state.core.lock().unwrap().scheduler.status()
}

#[tauri::command(async)]
pub fn reminder_action(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  action: String,
  reminder_id: String,
) -> crate::types::ReminderStatus {
  let now = crate::state::now_ms();
  let mut guard = state.core.lock().unwrap();
  let core = &mut *guard;
  if !matches!(action.as_str(), "complete" | "snooze" | "skip") {
    return core.scheduler.status();
  }
  if core.scheduler.handle_action(&action, &reminder_id, &core.settings, now) {
    core.dirty_reminder = true;
  }
  let status = core.scheduler.status();
  drop(guard);
  crate::state::publish(&app, state.inner());
  status
}

#[tauri::command(async)]
pub fn reminder_pre_alert(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  action: String,
) -> crate::types::ReminderStatus {
  let now = crate::state::now_ms();
  let mut guard = state.core.lock().unwrap();
  let core = &mut *guard;
  if !matches!(action.as_str(), "start" | "snooze" | "dismiss") {
    return core.scheduler.status();
  }
  core
    .scheduler
    .pre_alert_action(&action, &core.settings, &core.tasks.tasks, now);
  core.dirty_reminder = true;
  let status = core.scheduler.status();
  drop(guard);
  crate::state::publish(&app, state.inner());
  status
}

#[tauri::command(async)]
pub fn reminder_test(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  kind: String,
) -> crate::types::ReminderStatus {
  let now = crate::state::now_ms();
  let mut guard = state.core.lock().unwrap();
  let core = &mut *guard;
  if matches!(kind.as_str(), "eye" | "walk" | "combined") {
    core
      .scheduler
      .trigger_test(&kind, &core.settings, &core.tasks.tasks, now);
    core.dirty_reminder = true;
  }
  let status = core.scheduler.status();
  drop(guard);
  crate::state::publish(&app, state.inner());
  status
}

#[tauri::command(async)]
pub fn reminder_now(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
) -> crate::types::ReminderStatus {
  let now = crate::state::now_ms();
  let mut guard = state.core.lock().unwrap();
  let core = &mut *guard;
  core
    .scheduler
    .trigger_now(&core.settings, &core.tasks.tasks, now);
  core.dirty_reminder = true;
  let status = core.scheduler.status();
  drop(guard);
  crate::state::publish(&app, state.inner());
  status
}

#[tauri::command(async)]
pub fn reminder_pause(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  minutes: f64,
) -> crate::types::ReminderStatus {
  let now = crate::state::now_ms();
  let mut core = state.core.lock().unwrap();
  let minutes =
    (if minutes.is_finite() { minutes.round().clamp(1.0, 1440.0) } else { 1.0 }) as u64;
  core.scheduler.pause(minutes, now);
  core.dirty_reminder = true;
  let status = core.scheduler.status();
  drop(core);
  crate::state::publish(&app, state.inner());
  status
}

#[tauri::command(async)]
pub fn reminder_resume(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
) -> crate::types::ReminderStatus {
  let now = crate::state::now_ms();
  let mut core = state.core.lock().unwrap();
  core.scheduler.resume(now);
  core.dirty_reminder = true;
  let status = core.scheduler.status();
  drop(core);
  crate::state::publish(&app, state.inner());
  status
}

#[tauri::command(async)]
pub fn reminder_restart(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
) -> crate::types::ReminderStatus {
  let now = crate::state::now_ms();
  let mut guard = state.core.lock().unwrap();
  let core = &mut *guard;
  core.scheduler.restart_cycle(&core.settings, now);
  core.dirty_reminder = true;
  let status = core.scheduler.status();
  drop(guard);
  crate::state::publish(&app, state.inner());
  status
}

#[tauri::command(async)]
pub fn reminder_begin_rest(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  id: String,
) -> crate::types::ReminderStatus {
  let now = crate::state::now_ms();
  let mut core = state.core.lock().unwrap();
  // begin_health_rest sets the dirty flags itself on success.
  crate::state::begin_health_rest(&mut core, &id, now);
  let status = core.scheduler.status();
  drop(core);
  crate::state::publish(&app, state.inner());
  status
}

#[tauri::command(async)]
pub fn reminder_companion(
  state: tauri::State<'_, crate::state::AppState>,
) -> crate::types::RestCompanionSummary {
  let now = crate::state::now_ms();
  let core = state.core.lock().unwrap();
  core.history.rest_companion(core.settings.history_enabled, now)
}

// ── Hydration ────────────────────────────────────────────────────────────────

#[tauri::command(async)]
pub fn hydration_get(
  state: tauri::State<'_, crate::state::AppState>,
) -> crate::types::HydrationStatus {
  let now = crate::state::now_ms();
  let mut guard = state.core.lock().unwrap();
  let core = &mut *guard;
  core.hydration.status(&core.settings, now)
}

#[tauri::command(async)]
pub fn hydration_record(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
) -> crate::types::HydrationStatus {
  let now = crate::state::now_ms();
  let mut guard = state.core.lock().unwrap();
  let core = &mut *guard;
  let status = core.hydration.record_cup(&core.settings, now);
  core.dirty_hydration = true;
  drop(guard);
  crate::state::publish(&app, state.inner());
  status
}

#[tauri::command(async)]
pub fn hydration_dismiss(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
) -> crate::types::HydrationStatus {
  let now = crate::state::now_ms();
  let mut guard = state.core.lock().unwrap();
  let core = &mut *guard;
  if core.hydration.dismiss_prompt(&core.settings).is_some() {
    core.dirty_hydration = true;
  }
  let status = core.hydration.status(&core.settings, now);
  drop(guard);
  crate::state::publish(&app, state.inner());
  status
}

// ── Pomodoro ─────────────────────────────────────────────────────────────────

/// Owned snapshot backing a `PomodoroContext` (see module docs).
struct PomodoroCtxParts {
  settings: crate::types::Settings,
  tasks: Vec<crate::types::Task>,
  projects: Vec<crate::types::Project>,
  health_break_active: bool,
}

impl PomodoroCtxParts {
  fn take(core: &crate::state::Core, health_break_active: bool) -> PomodoroCtxParts {
    PomodoroCtxParts {
      settings: core.settings.clone(),
      tasks: core.tasks.tasks.clone(),
      projects: core.tasks.projects.clone(),
      health_break_active,
    }
  }

  /// Run `op` with a context over the owned snapshot. The availability rule
  /// mirrors `state::pomodoro_context`: an open, current root task.
  fn run<T>(
    &self,
    pomodoro: &mut crate::pomodoro::Pomodoro,
    op: impl FnOnce(&mut crate::pomodoro::Pomodoro, &crate::pomodoro::PomodoroContext) -> T,
  ) -> T {
    let ctx = crate::pomodoro::PomodoroContext {
      settings: &self.settings,
      tasks: &self.tasks,
      projects: &self.projects,
      health_break_active: self.health_break_active,
    };
    op(pomodoro, &ctx)
  }
}

#[tauri::command(async)]
pub fn pomodoro_prepare(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  task_id: Option<String>,
  replace: bool,
) -> Result<crate::types::PomodoroState, String> {
  let mut core = state.core.lock().unwrap();
  let health_break_active = core.scheduler.status().active_reminder.is_some();
  let parts = PomodoroCtxParts::take(&core, health_break_active);
  parts.run(&mut core.pomodoro, move |pomo, ctx| {
    pomo.prepare(task_id, replace, ctx)
  })?;
  core.dirty_pomodoro = true;
  let pomodoro = core.pomodoro.state();
  drop(core);
  crate::state::publish(&app, state.inner());
  Ok(pomodoro)
}

#[tauri::command(async)]
pub fn pomodoro_get(
  state: tauri::State<'_, crate::state::AppState>,
) -> crate::types::PomodoroState {
  state.core.lock().unwrap().pomodoro.state()
}

#[tauri::command(async)]
pub fn pomodoro_start(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  task_id: Option<String>,
  minutes: f64,
  replace: bool,
) -> Result<crate::types::PomodoroState, String> {
  let mut core = state.core.lock().unwrap();
  let health_break_active = core.scheduler.status().active_reminder.is_some();
  let parts = PomodoroCtxParts::take(&core, health_break_active);
  parts.run(&mut core.pomodoro, move |pomo, ctx| {
    pomo.start(task_id, minutes, replace, ctx)
  })?;
  // Persist the chosen duration the way index.ts saves it on start.
  core.settings.pomodoro_minutes = minutes.round().clamp(1.0, 180.0) as u64;
  core.dirty_settings = true;
  core.dirty_pomodoro = true;
  let pomodoro = core.pomodoro.state();
  drop(core);
  crate::state::publish(&app, state.inner());
  Ok(pomodoro)
}

#[tauri::command(async)]
pub fn pomodoro_action(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  action: String,
) -> Result<crate::types::PomodoroState, String> {
  if !matches!(action.as_str(), "pause" | "resume" | "stop" | "break") {
    return Err("无效番茄钟操作".into());
  }
  let mut core = state.core.lock().unwrap();
  let health_break_active = core.scheduler.status().active_reminder.is_some();
  let parts = PomodoroCtxParts::take(&core, health_break_active);
  parts.run(&mut core.pomodoro, |pomo, ctx| pomo.act(&action, ctx))?;
  core.dirty_pomodoro = true;
  let pomodoro = core.pomodoro.state();
  drop(core);
  crate::state::publish(&app, state.inner());
  Ok(pomodoro)
}

// ── Tasks & projects ─────────────────────────────────────────────────────────

fn task_mutation<T>(
  app: &tauri::AppHandle,
  state: &crate::state::AppState,
  operation: impl FnOnce(&mut crate::tasks::TaskCore, &mut crate::tasks::TaskEffects) -> Result<T, String>,
) -> Result<T, String> {
  let result = {
    let mut core = state.core.lock().unwrap();
    let (result, effects) = core.tasks.transact(&state.data_dir.join("tasks.json"), operation)?;
    core.task_effects.append(effects);
    core.tasks_dirty = true;
    result
  };
  crate::state::publish(app, state);
  Ok(result)
}

#[tauri::command(async)]
pub fn task_list(state: tauri::State<'_, crate::state::AppState>) -> Vec<crate::types::Task> {
  state.core.lock().unwrap().tasks.tasks.clone()
}

#[tauri::command(async)]
pub fn task_create(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  input: Value,
) -> Result<Vec<crate::types::Task>, String> {
  let input = crate::tasks::SimpleCreateInput::from_value(&input)?;
  if input.title.trim().is_empty() {
    return Err("请输入任务名称".into());
  }
  let now = crate::state::now_ms();
  task_mutation(&app, state.inner(), |tasks, effects| {
    tasks.create_task(&input, now, effects);
    Ok(tasks.tasks.clone())
  })
}

#[tauri::command(async)]
pub fn task_update(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  id: String,
  input: Value,
) -> Result<Vec<crate::types::Task>, String> {
  let patch = crate::tasks::TaskPatch::from_simple_update(&input)?;
  let now = crate::state::now_ms();
  task_mutation(&app, state.inner(), |tasks, effects| {
    tasks.update_task(&id, &patch, now, effects)?;
    Ok(tasks.tasks.clone())
  })
}

#[tauri::command(async)]
pub fn task_move(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  input: Value,
) -> Result<Vec<crate::types::Task>, String> {
  let task_id = input
    .get("taskId")
    .and_then(Value::as_str)
    .unwrap_or("")
    .to_string();
  let before_id = match input.get("beforeTaskId") {
    Some(Value::String(id)) => Some(id.clone()),
    _ => None,
  };
  // scope {type:'project', projectId} → Some(projectId); anything else is the
  // inbox scope (None).
  let scope_project = match input.get("scope") {
    Some(scope) if scope.get("type").and_then(Value::as_str) == Some("project") => scope
      .get("projectId")
      .and_then(Value::as_str)
      .map(str::to_string),
    _ => None,
  };
  let now = crate::state::now_ms();
  task_mutation(&app, state.inner(), |tasks, effects| {
    tasks.move_task(&task_id, before_id.as_deref(), scope_project.as_deref(), now, effects);
    Ok(tasks.tasks.clone())
  })
}

#[tauri::command(async)]
pub fn task_reorder_queue(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  ids: Vec<String>,
) -> Result<Vec<crate::types::Task>, String> {
  if ids.is_empty() || ids.len() > 500 || ids.iter().any(|id| id.trim().is_empty()) {
    return Err("顺序参数无效".into());
  }
  let now = crate::state::now_ms();
  task_mutation(&app, state.inner(), |tasks, effects| {
    tasks.reorder_queue(&ids, now, effects)?;
    Ok(tasks.tasks.clone())
  })
}

#[tauri::command(async)]
pub fn task_set_status(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  id: String,
  status: String,
) -> Result<Vec<crate::types::Task>, String> {
  let status = match status.as_str() {
    "open" | "done" | "archived" => status,
    _ => "open".to_string(),
  };
  let now = crate::state::now_ms();
  task_mutation(&app, state.inner(), |tasks, effects| {
    tasks.set_task_status(&id, &status, now, effects)?;
    Ok(tasks.tasks.clone())
  })
}

#[tauri::command(async)]
pub fn task_delete(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  id: String,
) -> Result<Vec<crate::types::Task>, String> {
  let now = crate::state::now_ms();
  task_mutation(&app, state.inner(), |tasks, effects| {
    tasks.delete_task(&id, now, effects);
    Ok(tasks.tasks.clone())
  })
}

#[tauri::command(async)]
pub fn task_complete_tree(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  id: String,
  revisions: std::collections::HashMap<String, u64>,
) -> Result<Vec<crate::types::Task>, String> {
  let now = crate::state::now_ms();
  task_mutation(&app, state.inner(), |tasks, effects| {
    tasks.complete_task_tree(&id, &revisions, now, effects)?;
    Ok(tasks.tasks.clone())
  })
}

#[tauri::command(async)]
pub fn task_move_step(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  id: String,
  direction: i32,
) -> Result<Vec<crate::types::Task>, String> {
  if direction != -1 && direction != 1 {
    return Err("无效移动方向".into());
  }
  let now = crate::state::now_ms();
  task_mutation(&app, state.inner(), |tasks, effects| {
    tasks.move_step(&id, direction, now, effects)?;
    Ok(tasks.tasks.clone())
  })
}

#[tauri::command(async)]
pub fn task_create_step(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  root_id: String,
  title: String,
) -> Result<Vec<crate::types::Task>, String> {
  let now = crate::state::now_ms();
  task_mutation(&app, state.inner(), |tasks, effects| {
    tasks.create_step(&root_id, &title, now, effects)?;
    Ok(tasks.tasks.clone())
  })
}

#[tauri::command(async)]
pub fn task_undo_get(
  state: tauri::State<'_, crate::state::AppState>,
) -> Option<crate::types::UndoState> {
  let now = crate::state::now_ms();
  let mut core = state.core.lock().unwrap();
  core.tasks.undo_state(now)
}

#[tauri::command(async)]
pub fn task_undo(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  operation_id: String,
) -> Result<Vec<crate::types::Task>, String> {
  let now = crate::state::now_ms();
  task_mutation(&app, state.inner(), |tasks, effects| {
    tasks.undo(&operation_id, now, effects);
    Ok(tasks.tasks.clone())
  })
}

#[tauri::command(async)]
pub fn task_active_set(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  id: Option<String>,
) -> Result<Vec<crate::types::Task>, String> {
  task_mutation(&app, state.inner(), |tasks, _effects| {
    tasks.set_active_task(id.as_deref());
    Ok(tasks.tasks.clone())
  })
}

#[tauri::command(async)]
pub fn task_restore_legacy(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  id: String,
) -> Result<Vec<crate::types::Task>, String> {
  let now = crate::state::now_ms();
  task_mutation(&app, state.inner(), |tasks, effects| {
    tasks.restore_task(&id, now, effects)?;
    Ok(tasks.tasks.clone())
  })
}

#[tauri::command(async)]
pub fn project_list(state: tauri::State<'_, crate::state::AppState>) -> Vec<crate::types::Project> {
  state.core.lock().unwrap().tasks.projects.clone()
}

#[tauri::command(async)]
pub fn project_create(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  input: Value,
) -> Result<Vec<crate::types::Project>, String> {
  let now = crate::state::now_ms();
  task_mutation(&app, state.inner(), |tasks, effects| {
    tasks.create_project(&input, now, effects)?;
    Ok(tasks.projects.clone())
  })
}

#[tauri::command(async)]
pub fn project_update(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  id: String,
  input: Value,
) -> Result<Vec<crate::types::Project>, String> {
  let now = crate::state::now_ms();
  task_mutation(&app, state.inner(), |tasks, effects| {
    tasks.update_project(&id, &input, now, effects)?;
    Ok(tasks.projects.clone())
  })
}

#[tauri::command(async)]
pub fn project_delete(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  id: String,
) -> Result<Vec<crate::types::Project>, String> {
  let now = crate::state::now_ms();
  task_mutation(&app, state.inner(), |tasks, effects| {
    tasks.delete_project(&id, now, effects);
    Ok(tasks.projects.clone())
  })
}

// ── Delivery failures / hotkeys ──────────────────────────────────────────────

#[tauri::command(async)]
pub fn delivery_failed_list(state: tauri::State<'_, crate::state::AppState>) -> Vec<crate::task_reminders::Delivery> {
  state.core.lock().unwrap().task_reminders.failed()
}

#[tauri::command(async)]
pub fn delivery_failed_retry(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  id: String,
) -> Result<Vec<crate::task_reminders::Delivery>, String> {
  use tauri::Emitter;
  let failures = {
    let mut core = state.core.lock().unwrap();
    core.task_reminders.retry(&id)?;
    core.task_reminders.failed()
  };
  let _ = app.emit("delivery:failed-changed", &failures);
  Ok(failures)
}

#[tauri::command(async)]
pub fn delivery_failed_dismiss(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  id: String,
) -> Result<Vec<crate::task_reminders::Delivery>, String> {
  use tauri::Emitter;
  let failures = {
    let mut core = state.core.lock().unwrap();
    core.task_reminders.dismiss(&id)?;
    core.task_reminders.failed()
  };
  let _ = app.emit("delivery:failed-changed", &failures);
  Ok(failures)
}

#[tauri::command(async)]
pub fn hotkeys_status(
  state: tauri::State<'_, crate::state::AppState>,
) -> crate::types::HotkeyStatus {
  state.core.lock().unwrap().hotkey_status.clone()
}

// ── Backup & data ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn data_backup_export(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
) -> Result<crate::types::DataActionResult, String> {
  use tauri_plugin_dialog::DialogExt;
  let now = crate::state::now_ms();
  // Snapshot the domain state before opening the modal dialog.
  let payload = {
    let core = state.core.lock().unwrap();
    crate::backup::BackupPayload {
      settings: core.settings.clone(),
      tasks: core.tasks.tasks.clone(),
      projects: core.tasks.projects.clone(),
      active_task_id: core.tasks.active_task_id.clone(),
      reminder_history: core.history.events.clone(),
      created_at: now,
      app_version: app.package_info().version.to_string(),
    }
  };
  let date = chrono::Local::now().format("%Y-%m-%d").to_string();
  let dialog_app = app.clone();
  let picked = tauri::async_runtime::spawn_blocking(move || {
    dialog_app
      .dialog()
      .file()
      .add_filter("EyeProtect 备份", &["json"])
      .set_file_name(format!("EyeProtect-backup-{}.json", date))
      .blocking_save_file()
  })
  .await
  .unwrap_or(None);
  let Some(path) = picked.and_then(|p| p.simplified().into_path().ok()) else {
    return Ok(crate::types::DataActionResult { success: false, message: "已取消导出".into() });
  };
  let text = crate::backup::build_backup_text(&payload);
  match std::fs::write(&path, text) {
    Ok(()) => Ok(crate::types::DataActionResult { success: true, message: "备份已导出".into() }),
    Err(error) => Ok(crate::types::DataActionResult { success: false, message: error.to_string() }),
  }
}

#[tauri::command]
pub async fn data_backup_import(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
) -> Result<crate::types::DataActionResult, String> {
  use tauri_plugin_dialog::DialogExt;
  let dialog_app = app.clone();
  let picked = tauri::async_runtime::spawn_blocking(move || {
    dialog_app
      .dialog()
      .file()
      .add_filter("EyeProtect 备份", &["json"])
      .blocking_pick_file()
  })
  .await
  .unwrap_or(None);
  let Some(path) = picked.and_then(|p| p.simplified().into_path().ok()) else {
    return Ok(crate::types::DataActionResult { success: false, message: "已取消导入".into() });
  };
  let text = match std::fs::read_to_string(&path) {
    Ok(text) => text,
    Err(error) => return Ok(crate::types::DataActionResult { success: false, message: error.to_string() }),
  };
  let backup = match crate::backup::parse_backup(&text) {
    Ok(backup) => backup,
    Err(message) => {
      return Ok(crate::types::DataActionResult { success: false, message });
    }
  };
  // Destructive: confirm with the user before replacing anything.
  use chrono::TimeZone;
  let created_at_text = chrono::Local
    .timestamp_millis_opt(backup.created_at as i64)
    .single()
    .map(|t| t.format("%Y-%m-%d %H:%M").to_string())
    .unwrap_or_else(|| "未知时间".into());
  let confirm_app = app.clone();
  let confirmed = tauri::async_runtime::spawn_blocking(move || {
    use tauri_plugin_dialog::{MessageDialogButtons, MessageDialogKind};
    confirm_app
      .dialog()
      .message(format!("导入会替换当前设置、任务与提醒历史。备份创建于 {}。建议先导出当前数据。", created_at_text))
      .title("确认导入备份")
      .kind(MessageDialogKind::Warning)
      .buttons(MessageDialogButtons::OkCancelCustom("确认导入".into(), "取消".into()))
      .blocking_show()
  })
  .await
  .unwrap_or(false);
  if !confirmed {
    return Ok(crate::types::DataActionResult { success: false, message: "已取消导入".into() });
  }

  let now = crate::state::now_ms();
  let rollback_path = state
    .data_dir
    .join(format!("import-rollback-{}.json", now));
  let result = {
    let mut guard = state.core.lock().unwrap();
    let core = &mut *guard;
    // Rollback snapshot FIRST: a failed apply restores this exact state.
    let current = crate::backup::BackupPayload {
      settings: core.settings.clone(),
      tasks: core.tasks.tasks.clone(),
      projects: core.tasks.projects.clone(),
      active_task_id: core.tasks.active_task_id.clone(),
      reminder_history: core.history.events.clone(),
      created_at: now,
      app_version: app.package_info().version.to_string(),
    };
    let rollback_text = crate::backup::build_backup_text(&current);
    if let Err(error) = std::fs::write(&rollback_path, rollback_text) {
      return Ok(crate::types::DataActionResult { success: false, message: format!("无法写入导入前快照，已取消导入：{}", error) });
    }
    let files = crate::backup::domain_files(&state.data_dir, &backup)?;
    let autostart_changed = core.settings.start_with_windows != backup.settings.start_with_windows;
    if autostart_changed {
      crate::state::set_autostart(&app, backup.settings.start_with_windows)?;
    }
    if let Err(message) = crate::fsutil::replace_json_files(&files) {
      let restore = if autostart_changed {
        crate::state::set_autostart(&app, core.settings.start_with_windows).err()
      } else { None };
      let message = match restore {
        Some(error) => format!("{}；开机启动恢复失败：{}", message, error),
        None => message,
      };
      return Ok(crate::types::DataActionResult { success: false, message });
    }
    let previous_settings = core.settings.clone();
    core.tasks = crate::tasks::TaskCore::from_parts(
      backup.tasks.clone(), backup.projects.clone(), backup.active_task_id.clone(),
    );
    core.tasks.persist_pending = false;
    core.history = crate::history::History::new(backup.reminder_history.clone());
    core.settings = backup.settings.clone();
    core.scheduler.update_settings(&backup.settings, &previous_settings, now);
    let ctx = crate::state::pomodoro_context(
      &core.settings, &core.tasks.tasks, &core.tasks.projects,
      core.scheduler.status().active_reminder.is_some(),
    );
    let _ = core.pomodoro.act("stop", &ctx);
    core.dirty_pomodoro = true;
    core.dirty_settings = true;
    core.dirty_reminder = true;
    core.dirty_hydration = true;
    core.tasks_dirty = true;
    core.task_effects.replaced = true;
    core.task_effects.projects_replaced = true;
    core.hydration.on_settings_changed(&core.settings, now);
    core.context.configure_from_settings(&core.settings);
    crate::types::DataActionResult {
      success: true,
      message: "备份已导入，设置已经生效；导入前快照已保留".into(),
    }
  };
  if result.success {
    crate::state::publish(&app, state.inner());
    crate::state::apply_global_hotkeys(&app, state.inner());
    use tauri::Emitter;
    let core = state.core.lock().unwrap();
    let _ = app.emit("reminder:companion-changed", core.history.rest_companion(core.settings.history_enabled, now));
  }
  Ok(result)
}

#[tauri::command]
pub async fn data_reset(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
) -> Result<crate::types::DataActionResult, String> {
  use tauri_plugin_dialog::DialogExt;
  let dialog_app = app.clone();
  let confirmed = tauri::async_runtime::spawn_blocking(move || {
    use tauri_plugin_dialog::{MessageDialogButtons, MessageDialogKind};
    dialog_app.dialog().message("这会清空当前任务并恢复默认设置；休息历史不会清除。建议先导出备份。")
      .title("恢复默认设置").kind(MessageDialogKind::Warning)
      .buttons(MessageDialogButtons::OkCancelCustom("恢复默认".into(), "取消".into())).blocking_show()
  }).await.unwrap_or(false);
  if !confirmed {
    return Ok(crate::types::DataActionResult { success: false, message: "已取消恢复默认设置".into() });
  }
  let now = crate::state::now_ms();
  let mut guard = state.core.lock().unwrap();
  let core = &mut *guard;
  let previous = crate::backup::BackupPayload {
    settings: core.settings.clone(), tasks: core.tasks.tasks.clone(), projects: core.tasks.projects.clone(),
    active_task_id: core.tasks.active_task_id.clone(), reminder_history: core.history.events.clone(),
    created_at: now, app_version: app.package_info().version.to_string(),
  };
  let rollback_path = state.data_dir.join(format!("reset-rollback-{}.json", now));
  std::fs::write(&rollback_path, crate::backup::build_backup_text(&previous))
    .map_err(|error| format!("无法写入重置前快照：{}", error))?;
  let replacement = crate::backup::BackupPayload {
    settings: crate::types::Settings::default(), tasks: Vec::new(), projects: Vec::new(),
    active_task_id: None, reminder_history: previous.reminder_history.clone(),
    created_at: now, app_version: previous.app_version.clone(),
  };
  let files = crate::backup::domain_files(&state.data_dir, &replacement)?;
  let autostart_changed = core.settings.start_with_windows != replacement.settings.start_with_windows;
  if autostart_changed {
    crate::state::set_autostart(&app, replacement.settings.start_with_windows)?;
  }
  if let Err(message) = crate::fsutil::replace_json_files(&files) {
    let restore = if autostart_changed {
      crate::state::set_autostart(&app, core.settings.start_with_windows).err()
    } else { None };
    return Err(match restore {
      Some(error) => format!("{}；开机启动恢复失败：{}", message, error),
      None => message,
    });
  }
  core.tasks = crate::tasks::TaskCore::from_parts(Vec::new(), Vec::new(), None);
  core.tasks.persist_pending = false;
  core.settings = replacement.settings;
  core.scheduler.restart_cycle(&core.settings, now);
  let ctx = crate::state::pomodoro_context(&core.settings, &core.tasks.tasks, &core.tasks.projects, false);
  let _ = core.pomodoro.act("stop", &ctx);
  core.dirty_pomodoro = true;
  core.dirty_settings = true;
  core.dirty_reminder = true;
  core.tasks_dirty = true;
  core.task_effects = crate::tasks::TaskEffects::default();
  core.task_effects.replaced = true;
  core.task_effects.projects_replaced = true;
  core.context.configure_from_settings(&core.settings);
  drop(guard);
  crate::state::publish(&app, state.inner());
  crate::state::apply_global_hotkeys(&app, state.inner());
  Ok(crate::types::DataActionResult { success: true, message: "已恢复默认设置；重置前快照已保留".into() })
}

fn open_directory(app: &tauri::AppHandle, path: &std::path::Path) -> Result<(), String> {
  app.opener()
    .open_path(path.to_string_lossy().to_string(), None::<&str>)
    .map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub fn data_open_directory(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
) -> crate::types::DataActionResult {
  if let Err(error) = std::fs::create_dir_all(&state.data_dir) {
    return crate::types::DataActionResult { success: false, message: error.to_string() };
  }
  match open_directory(&app, &state.data_dir) {
    Ok(()) => crate::types::DataActionResult { success: true, message: "已打开数据目录".into() },
    Err(message) => crate::types::DataActionResult { success: false, message },
  }
}

#[tauri::command(async)]
pub fn data_recovery_info(state: tauri::State<'_, crate::state::AppState>) -> Value {
  json!({
    "dataDir": state.data_dir.to_string_lossy(),
    "corruptBackups": [],
    "taskDatabase": {
      "readOnly": false,
      "snapshotPath": Value::Null,
      "reason": Value::Null
    }
  })
}

#[tauri::command]
pub fn data_legacy() -> Value {
  json!({ "sections": [] })
}

// ── Custom pet assets ────────────────────────────────────────────────────────

/// Same readme text the Electron handler writes (index.ts 1062–1089).
const CUSTOM_PET_README: &str = "EyeProtect 自定义桌面伙伴动图说明\r\n\r\n把动图直接放在本文件夹（custom-pet）根目录，在设置中选择“我的动图”。\r\n不需要子文件夹；内置火力奋斗猫、水獭、企鹅与像素猫始终保留。\r\n\r\n动作文件命名规范：\r\n- idle*.gif / idle*.png：待机/呼吸循环\r\n- click*.gif / interact*.gif：单击桌宠时随机互动\r\n- fidget*.gif / action*.gif：闲置时偶尔小动作\r\n- sleep*.gif / rest*.gif：护眼休息提醒期间播放\r\n";

fn custom_pet_dir(state: &crate::state::AppState) -> std::path::PathBuf {
  state.data_dir.join("custom-pet")
}

#[tauri::command(async)]
pub fn pet_custom_get_assets(
  state: tauri::State<'_, crate::state::AppState>,
) -> crate::types::CustomPetAssets {
  let mut assets = crate::types::CustomPetAssets {
    has_custom_pet: false,
    idles: Vec::new(),
    clicks: Vec::new(),
    fidgets: Vec::new(),
    sleeps: Vec::new(),
  };
  let entries = match std::fs::read_dir(custom_pet_dir(state.inner())) {
    Ok(entries) => entries,
    Err(_) => return assets, // No folder yet → empty assets.
  };
  for entry in entries.flatten() {
    let path = entry.path();
    if !path.is_file() {
      continue;
    }
    let name = path
      .file_name()
      .map(|name| name.to_string_lossy().to_lowercase())
      .unwrap_or_default();
    let is_image = [".gif", ".png", ".webp", ".jpg", ".jpeg"]
      .iter()
      .any(|ext| name.ends_with(ext));
    if !is_image {
      continue;
    }
    // Unreadable files are skipped, like the Electron version.
    let Ok(bytes) = std::fs::read(&path) else { continue };
    let mime = if name.ends_with(".png") {
      "image/png"
    } else if name.ends_with(".webp") {
      "image/webp"
    } else if name.ends_with(".jpg") || name.ends_with(".jpeg") {
      "image/jpeg"
    } else {
      "image/gif"
    };
    let data_url = format!(
      "data:{};base64,{}",
      mime,
      base64::engine::general_purpose::STANDARD.encode(bytes)
    );
    if name.starts_with("click") || name.starts_with("interact") || name.starts_with("tap") {
      assets.clicks.push(data_url);
    } else if name.starts_with("fidget") || name.starts_with("action") || name.starts_with("play") {
      assets.fidgets.push(data_url);
    } else if name.starts_with("sleep") || name.starts_with("rest") {
      assets.sleeps.push(data_url);
    } else {
      assets.idles.push(data_url);
    }
  }
  assets.has_custom_pet = !assets.idles.is_empty()
    || !assets.clicks.is_empty()
    || !assets.fidgets.is_empty()
    || !assets.sleeps.is_empty();
  assets
}

#[tauri::command(async)]
pub fn pet_custom_open_folder(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
) -> crate::types::DataActionResult {
  let dir = custom_pet_dir(state.inner());
  if let Err(error) = std::fs::create_dir_all(&dir) {
    return crate::types::DataActionResult { success: false, message: error.to_string() };
  }
  let readme = dir.join("使用说明.txt");
  if !readme.exists() {
    if let Err(error) = std::fs::write(&readme, CUSTOM_PET_README) {
      return crate::types::DataActionResult { success: false, message: error.to_string() };
    }
  }
  match open_directory(&app, &dir) {
    Ok(()) => crate::types::DataActionResult { success: true, message: "已打开自定义桌宠目录".into() },
    Err(message) => crate::types::DataActionResult { success: false, message },
  }
}

// ── Windows / surfaces ───────────────────────────────────────────────────────

#[tauri::command(async)]
pub fn window_pet_artwork_bounds(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  top: f64,
  bottom: f64,
) {
  let mut core = state.core.lock().unwrap();
  core.windows.report_pet_artwork_bounds(&app, top, bottom);
}

#[tauri::command(async)]
pub fn window_bubble_height(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  height: f64,
) {
  let mut core = state.core.lock().unwrap();
  core.windows.report_bubble_height(&app, height);
}

#[tauri::command(async)]
pub fn window_pet_move(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
  position: Value,
) -> Option<crate::types::PetPosition> {
  let (x, y) = match (
    position.get("x").and_then(Value::as_f64),
    position.get("y").and_then(Value::as_f64),
  ) {
    (Some(x), Some(y)) if x.is_finite() && y.is_finite() => (x, y),
    _ => return None,
  };
  let mut guard = state.core.lock().unwrap();
  let core = &mut *guard;
  core
    .windows
    .move_pet_window(&app, &core.settings, (x, y))
    .map(|(x, y)| crate::types::PetPosition { x: x.round() as i64, y: y.round() as i64 })
}

#[tauri::command(async)]
pub fn window_pet_toggle_visibility(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
) -> bool {
  let now = crate::state::now_ms();
  let (hidden, settings, inputs) = {
    let mut guard = state.core.lock().unwrap();
    let core = &mut *guard;
    // Same snapshot state.rs uses: reminder status + pomodoro + hydration
    // prompt + tasks (BubbleInputs::snapshot under the hood).
    let inputs = crate::state::bubble_inputs(core);
    let hidden = core.windows.toggle_pet_visibility_flag();
    (hidden, core.settings.clone(), inputs)
  };
  // Un-hiding may rebuild the alert surface: never on the main thread.
  crate::state::run_off_main(&app, move |app| {
    let state = app.state::<crate::state::AppState>();
    let mut guard = state.core.lock().unwrap();
    let core = &mut *guard;
    core.windows.apply_pet_visibility(app, &settings, &inputs, now);
  });
  hidden
}

#[tauri::command(async)]
pub fn window_pet_recall(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
) {
  let mut guard = state.core.lock().unwrap();
  let core = &mut *guard;
  core
    .windows
    .bring_pet_to_active_display(&app, &mut core.settings);
  core.dirty_settings = true;
  drop(guard);
  crate::state::publish(&app, state.inner());
}

#[tauri::command(async)]
pub fn window_workbench_open(
  app: tauri::AppHandle,
  _state: tauri::State<'_, crate::state::AppState>,
  section: Option<String>,
  focus_task_id: Option<String>,
) {
  // The command runs off the event thread because building the webview needs
  // the message pump; run_off_main also protects non-command callers.
  let section = section.unwrap_or_else(|| "today".into());
  let focus_task_id = focus_task_id.filter(|id| !id.is_empty());
  crate::state::run_off_main(&app, move |app| {
    let state = app.state::<crate::state::AppState>();
    let mut guard = state.core.lock().unwrap();
    let core = &mut *guard;
    core.windows.show_workbench(app, &core.settings, &section, focus_task_id);
  });
}

#[tauri::command(async)]
pub fn window_workbench_close(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
) {
  let core = state.core.lock().unwrap();
  core.windows.close_workbench(&app);
}

#[tauri::command(async)]
pub fn window_workbench_section(
  state: tauri::State<'_, crate::state::AppState>,
) -> crate::types::WorkbenchNavPayload {
  state.core.lock().unwrap().windows.workbench_section()
}
