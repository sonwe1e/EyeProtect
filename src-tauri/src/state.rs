//! Central application state: domain services, persistence and the publish
//! loop that turns backend mutations into window events + file writes (the
//! Rust equivalent of the EventEmitter wiring in `src/main/index.ts`).

use crate::fsutil::{read_json, read_json_checked, write_json_atomic};
use crate::history::History;
use crate::hydration::Hydration;
use crate::pomodoro::Pomodoro;
use crate::scheduler::{ReminderSnapshot, Scheduler};
use crate::tasks::{TaskCore, TaskEffects};
use crate::task_reminders::{Delivery, TaskReminders};
use crate::types::{HotkeyStatus, Project, sanitize_settings, Settings, Task};
use crate::windows::{BubbleInputs, WindowManager};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};

const CELEBRATE_SUPPRESS_MS: u64 = 30_000;
const SIP_SUPPRESS_MS: u64 = 10_000;
/// Wall-clock watchdog: a tick-to-tick delta beyond this means the machine
/// slept or the clock jumped; treat the excess as away time.
const WALL_JUMP_THRESHOLD_MS: u64 = 10_000;
/// Crash-checkpoint cadence for the scheduler snapshot.
const SNAPSHOT_CHECKPOINT_MS: u64 = 60_000;

/// Global hotkey accelerators (index.ts `HOTKEYS`; Ctrl on Windows).
pub const HOTKEYS: [(&str, &str); 5] = [
  ("break-now", "Control+Alt+B"),
  ("pause-toggle", "Control+Alt+P"),
  ("todo-add", "Control+Alt+A"),
  ("todos", "Control+Alt+T"),
  ("pet-toggle", "Control+Alt+H"),
];

pub fn now_ms() -> u64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis() as u64)
    .unwrap_or(0)
}

pub struct Core {
  pub settings: Settings,
  pub scheduler: Scheduler,
  pub tasks: TaskCore,
  pub task_reminders: TaskReminders,
  pub pomodoro: Pomodoro,
  pub hydration: Hydration,
  pub history: History,
  pub windows: WindowManager,
  pub context: crate::wincontext::ContextMonitor,
  pub last_exit_at: Option<u64>,
  pub last_checkpoint_at: Option<u64>,
  pub session_id: String,
  last_tick_wall: u64,
  last_tick_mono: Instant,
  last_snapshot_checkpoint: u64,
  celebrate_gate_last: u64,
  sip_gate_last: u64,
  reaction_sequence: u64,
  /// Outbox flags drained by `publish`.
  pub dirty_reminder: bool,
  pub dirty_settings: bool,
  pub dirty_pomodoro: bool,
  pub dirty_hydration: bool,
  pub tasks_dirty: bool,
  pub task_effects: TaskEffects,
  pub reactions: Vec<&'static str>,
  pub hotkey_status: HotkeyStatus,
}

pub struct AppState {
  pub data_dir: PathBuf,
  pub core: Mutex<Core>,
}

impl AppState {
  pub fn load(_app: &AppHandle, data_dir: PathBuf) -> Result<AppState, String> {
    let now = now_ms();
    let settings_input = read_json_checked(&data_dir.join("settings.json"))?;
    if settings_input.as_ref().is_some_and(|value| !value.is_object()) {
      return Err("设置数据格式无效".into());
    }
    let settings = settings_input
      .map(|value| {
        let without_version = if value.is_object() {
          let mut object = value.clone();
          if let Some(map) = object.as_object_mut() {
            map.remove("version");
          }
          object
        } else {
          value
        };
        sanitize_settings(&without_version)
      })
      .unwrap_or_default();

    // Reminder snapshot with the offline bound (runtimeState.ts).
    let snapshot_and_bounds: Option<(ReminderSnapshot, Option<u64>)> =
      read_json(&data_dir.join("runtime-state.json")).and_then(|value| {
        let bound = value
          .get("lastCheckpointAt")
          .and_then(Value::as_u64)
          .or_else(|| value.get("lastExitAt").and_then(Value::as_u64));
        let reminder = value.get("reminder").cloned()?;
        let snapshot: ReminderSnapshot = serde_json::from_value(reminder).ok()?;
        Some((snapshot, bound))
      });
    let (restore, bound) = match snapshot_and_bounds {
      Some((snapshot, bound)) => {
        let restore = if snapshot.paused_until.is_none() {
          if let Some(bound) = bound {
            let offline = now.saturating_sub(bound);
            ReminderSnapshot {
              next_eye_at: snapshot.next_eye_at + offline,
              next_walk_at: snapshot.next_walk_at + offline,
              ..snapshot
            }
          } else {
            snapshot
          }
        } else {
          snapshot
        };
        (Some(restore), bound)
      }
      None => (None, None),
    };
    let _ = bound;

    let tasks = TaskCore::load_checked(read_json_checked(&data_dir.join("tasks.json"))?, now)?;
    let task_reminders = TaskReminders::load(&data_dir)?;
    let pomodoro_value = read_json(&data_dir.join("pomodoro-state.json"));
    let hydration_day: Option<crate::hydration::HydrationDayState> =
      read_json(&data_dir.join("hydration-state.json"))
        .and_then(|value| serde_json::from_value(value).ok());
    let history_events = match read_json_checked(&data_dir.join("reminder-history.json"))? {
      Some(value) => {
        if value.get("version").and_then(Value::as_u64) != Some(1) {
          return Err("休息记录版本无效".into());
        }
        let events = value.get("events").cloned().ok_or("休息记录格式无效")?;
        serde_json::from_value::<Vec<crate::types::ReminderEvent>>(events)
          .map_err(|error| format!("休息记录格式无效：{}", error))?
      }
      None => Vec::new(),
    };

    let task_ids: Vec<String> = tasks.tasks.iter().map(|t| t.id.clone()).collect();
    let available = move |id: &str| task_ids.iter().any(|task_id| task_id == id);

    let scheduler = Scheduler::new(&settings, restore, now);
    let pomodoro = Pomodoro::from_persisted(pomodoro_value, &available);
    let hydration = Hydration::new(hydration_day, now);
    let history = History::new(history_events);

    let hotkeys_enabled = settings.hotkeys_enabled;
    let core = Core {
      settings,
      scheduler,
      tasks,
      task_reminders,
      pomodoro,
      hydration,
      history,
      windows: WindowManager::new(),
      context: crate::wincontext::ContextMonitor::default(),
      last_exit_at: None,
      last_checkpoint_at: None,
      session_id: uuid::Uuid::new_v4().to_string(),
      last_tick_wall: 0,
      last_tick_mono: Instant::now(),
      last_snapshot_checkpoint: 0,
      celebrate_gate_last: 0,
      sip_gate_last: 0,
      reaction_sequence: 0,
      dirty_reminder: false,
      dirty_settings: true,
      dirty_pomodoro: false,
      dirty_hydration: false,
      tasks_dirty: false,
      task_effects: TaskEffects::default(),
      reactions: Vec::new(),
      hotkey_status: HotkeyStatus { enabled: hotkeys_enabled, registered: Vec::new(), conflicts: Vec::new() },
    };
    Ok(AppState { data_dir, core: Mutex::new(core) })
  }

  pub fn settings_path(&self) -> PathBuf {
    self.data_dir.join("settings.json")
  }

  pub fn write_settings(&self, settings: &Settings) -> std::io::Result<()> {
    write_json_atomic(&self.settings_path(), &settings_value(settings)?, true)
  }
}

pub fn settings_value(settings: &Settings) -> std::io::Result<Value> {
  let mut value = serde_json::to_value(settings).map_err(std::io::Error::other)?;
  let map = value.as_object_mut().ok_or_else(|| std::io::Error::other("设置不是对象"))?;
  map.remove("todos");
  map.remove("alarms");
  map.remove("activeTaskId");
  map.insert("version".into(), Value::Number(1.into()));
  Ok(value)
}

/// Persist the scheduler snapshot (runtime-state.json).
fn persist_runtime_state(state: &AppState, core: &mut Core, now: u64) {
  core.last_checkpoint_at = Some(now);
  let file = json!({
    "version": 1,
    "savedAt": now,
    "lastExitAt": core.last_exit_at,
    "lastCheckpointAt": core.last_checkpoint_at,
    "sessionId": core.session_id,
    "reminder": core.scheduler.serialize(),
  });
  let _ = write_json_atomic(&state.data_dir.join("runtime-state.json"), &file, true);
}

fn persist_pomodoro(state: &AppState, core: &Core) {
  let value = serde_json::to_value(core.pomodoro.state()).unwrap_or(Value::Null);
  let _ = write_json_atomic(&state.data_dir.join("pomodoro-state.json"), &value, false);
}

fn persist_hydration(state: &AppState, core: &Core) {
  if let Ok(value) = serde_json::to_value(&core.hydration.day) {
    let _ = write_json_atomic(&state.data_dir.join("hydration-state.json"), &value, false);
  }
}

fn persist_history(state: &AppState, core: &Core) {
  let file = json!({
    "version": 1,
    "events": core.history.events,
  });
  let _ = write_json_atomic(&state.data_dir.join("reminder-history.json"), &file, true);
}

fn persist_tasks(state: &AppState, core: &Core) {
  if let Ok(value) = serde_json::to_value(core.tasks.to_file()) {
    let _ = write_json_atomic(&state.data_dir.join("tasks.json"), &value, false);
  }
}

/// `beginHealthRest` from index.ts: start the visible rest, extending the
/// enforced window when a pomodoro phase should own the duration.
pub fn begin_health_rest(core: &mut Core, id: &str, now: u64) -> bool {  let Some(active) = core.scheduler.status().active_reminder else { return false };
  if active.id != id || active.rest_started_at.is_some() {
    return false;
  }
  let pomodoro_state = core.pomodoro.state();
  let focus_ended = pomodoro_state.phase == "focus-finished"
    || (pomodoro_state.phase == "focus" && pomodoro_state.remaining_ms == 0);
  let minimum_ms = if focus_ended {
    core.settings.pomodoro_break_minutes * 60_000
  } else if pomodoro_state.phase == "break" {
    pomodoro_state.remaining_ms
  } else {
    0
  };
  let started = core.scheduler.begin_rest(id, minimum_ms, &core.settings, now);
  if started {
    // The single health surface owns the screen while the rest runs.
    let ctx = pomodoro_context(
      &core.settings,
      &core.tasks.tasks,
      &core.tasks.projects,
      true,
    );
    if core.pomodoro.begin_health_rest(&ctx) {
      core.dirty_pomodoro = true;
    }
    core.dirty_reminder = true;
  }
  started
}

/// Field-level borrowed pomodoro inputs: callers can hold this context next to
/// a `&mut core.pomodoro` (the borrows are on disjoint fields).
pub fn pomodoro_context<'a>(
  settings: &'a Settings,
  tasks: &'a [Task],
  projects: &'a [Project],
  health_break_active: bool,
) -> crate::pomodoro::PomodoroContext<'a> {
  crate::pomodoro::PomodoroContext { settings, tasks, projects, health_break_active }
}

/// Snapshot for the bubble decision (shared with tray/pet-menu actions).
pub fn bubble_inputs(core: &Core) -> BubbleInputs {
  let status = core.scheduler.status();
  let pomodoro = core.pomodoro.state();
  let hydration_prompt = core.hydration.prompt_snapshot();
  BubbleInputs::snapshot(&status, &pomodoro, hydration_prompt.as_ref(), &core.tasks.tasks, &core.tasks.projects)
}

fn should_react(gate_last: &mut u64, now: u64, window_ms: u64) -> bool {
  if now.saturating_sub(*gate_last) < window_ms {
    return false;
  }
  *gate_last = now;
  true
}

/// Drain the outbox: record history, persist, emit events, update windows.
/// Window work runs off the main thread. Some window-manager operations still
/// need the Core lock while waiting for the event loop, so stateful commands
/// and menu/hotkey callbacks must also acquire Core off the main thread.
pub static MAIN_THREAD_ID: std::sync::OnceLock<std::thread::ThreadId> = std::sync::OnceLock::new();

pub fn on_main_thread() -> bool {
  MAIN_THREAD_ID.get().is_some_and(|id| *id == std::thread::current().id())
}

/// Run `work` on the async pool when called from the main thread (window
/// builds deadlock there); otherwise run it inline.
pub fn run_off_main<F: FnOnce(&AppHandle) + Send + 'static>(app: &AppHandle, work: F) {
  if on_main_thread() {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
      work(&app);
    });
  } else {
    work(app);
  }
}

pub fn publish(app: &AppHandle, state: &AppState) {
  let now = now_ms();
  let mut guard = state.core.lock().unwrap();
  // Split borrow through the guard: disjoint fields may coexist.
  let core = &mut *guard;

  // 1. Reminder events recorded by scheduler actions → history store.
  let events = std::mem::take(&mut core.scheduler.pending_events);
  for event in events {
    core.history.record(event, &core.settings);
  }
  if core.history.take_persist_pending() {
    persist_history(state, &core);
    let summary = core.history.rest_companion(core.settings.history_enabled, now);
    let _ = app.emit("reminder:companion-changed", &summary);
  }

  // 2. Reminder transitions: persist + flag; window work moves to the phase.
  let reminder_changed = std::mem::take(&mut core.dirty_reminder);
  if reminder_changed {
    if core.scheduler.status().pre_alert.is_some() {
      core.reactions.push("stretch");
    }
    persist_runtime_state(state, core, now);
  }

  // 3. Task effects.
  if core.tasks_dirty {
    core.tasks_dirty = false;
    let effects = std::mem::take(&mut core.task_effects);
    for task in &effects.upserted {
      let _ = app.emit("task:upserted", task);
    }
    for id in &effects.removed {
      let _ = app.emit("task:removed", id);
    }
    if effects.replaced {
      let tasks: Vec<Task> = core.tasks.tasks.clone();
      let _ = app.emit("task:changed", &tasks);
    }
    for project in &effects.projects_upserted {
      let _ = app.emit("project:upserted", project);
    }
    for id in &effects.projects_removed {
      let _ = app.emit("project:removed", id);
    }
    if effects.projects_replaced {
      let projects = core.tasks.projects.clone();
      let _ = app.emit("project:changed", &projects);
    }
    if let Some(undo) = effects.undo {
      let _ = app.emit("task:undo-changed", &undo);
    }
    if effects.task_completed && should_react(&mut core.celebrate_gate_last, now, CELEBRATE_SUPPRESS_MS) {
      core.reactions.push("celebrate");
    }
    if core.tasks.take_persist_pending() {
      persist_tasks(state, &core);
    }
  }

  // 4. Settings.
  if core.dirty_settings {
    core.dirty_settings = false;
    if let Err(error) = state.write_settings(&core.settings) {
      eprintln!("[settings] could not write settings: {}", error);
    }
    let settings = core.settings.clone();
    let _ = app.emit("settings:changed", &settings);
  }

  // 5. Pomodoro.
  if core.dirty_pomodoro {
    core.dirty_pomodoro = false;
    if core.pomodoro.take_persist_pending() {
      persist_pomodoro(state, &core);
    }
    let pomodoro = core.pomodoro.state();
    let _ = app.emit("pomodoro:changed", &pomodoro);
  }

  // 6. Hydration.
  if core.dirty_hydration {
    core.dirty_hydration = false;
    if core.hydration.take_persist_pending() {
      persist_hydration(state, &core);
    }
    let status = core.hydration.status_of_pub(&core.settings);
    let _ = app.emit("hydration:changed", &status);
  }

  // 7. Pet reactions (one-shot, throttled per kind).
  let reactions = std::mem::take(&mut core.reactions);
  for action in reactions {
    core.reaction_sequence += 1;
    let event = json!({
      "id": format!("{}-{}", now, core.reaction_sequence),
      "action": action,
    });
    let _ = app.emit("pet:reaction", &event);
  }

  drop(guard);
  if reminder_changed {
    crate::tray::refresh_tray_menu(app);
  }
  window_phase(app, reminder_changed, now);
}

/// Window side effects of a publish: reminder surfaces + bubble refresh.
/// Runs off the main thread (spawning there would deadlock window creation).
fn window_phase(app: &AppHandle, reminder_changed: bool, now: u64) {
  if on_main_thread() {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
      window_phase_inner(&app, reminder_changed, now);
    });
    return;
  }
  window_phase_inner(app, reminder_changed, now);
}

fn window_phase_inner(app: &AppHandle, reminder_changed: bool, now: u64) {
  let state = app.state::<AppState>();
  if reminder_changed {
    let (settings, inputs) = {
      let mut guard = state.core.lock().unwrap();
      let core = &mut *guard;
      (core.settings.clone(), bubble_inputs(core))
    };
    let status = {
      let core = state.core.lock().unwrap();
      core.scheduler.status()
    };
    let _ = app.emit("reminder:changed", &status);
    let newly_presented = {
      let mut guard = state.core.lock().unwrap();
      let core = &mut *guard;
      core.windows.apply_reminder_status(app, &settings, &inputs, now)
    };
    if let Some(reminder_id) = newly_presented {
      // The main process starts timing only once the rest is visibly shown.
      let status = {
        let mut guard = state.core.lock().unwrap();
        let core = &mut *guard;
        begin_health_rest(core, &reminder_id, now);
        core.scheduler.status()
      };
      let _ = app.emit("reminder:changed", &status);
    }
  }
  // Bubble surface re-evaluation (covers task/pomodoro/hydration/settings
  // changes; apply_reminder_status already ran when relevant).
  {
    let mut guard = state.core.lock().unwrap();
    let core = &mut *guard;
    let inputs = bubble_inputs(core);
    core.windows.refresh_bubble(app, &core.settings, &inputs, now);
  }
}

/// The 1 s heartbeat: watchdog, scheduler pass, pomodoro/hydration clocks and
/// the debounced pet-position save.
pub fn tick(app: &AppHandle, state: &AppState) {
  let now = now_ms();
  let mut guard = state.core.lock().unwrap();
  let core = &mut *guard;

  // Watchdog: compare wall delta with the nominal tick.
  if core.last_tick_wall > 0 {
    let delta = now as i64 - core.last_tick_wall as i64;
    if delta > WALL_JUMP_THRESHOLD_MS as i64 {
      let inactive = (delta as u64).saturating_sub(1_000);
      core.scheduler.handle_activity_resume(inactive, &core.settings, now);
      core.dirty_reminder = true;
      // A machine that slept paused the user's pomodoro too.
      let health_active = core.scheduler.status().active_reminder.is_some();
      let ctx = pomodoro_context(&core.settings, &core.tasks.tasks, &core.tasks.projects, health_active);
      let _ = core.pomodoro.act("pause", &ctx);
      core.dirty_pomodoro = true;
    } else if delta < -(WALL_JUMP_THRESHOLD_MS as i64) {
      core.scheduler.handle_wall_clock_backwards(delta);
      core.dirty_reminder = true;
    }
  }
  core.last_tick_wall = now;
  let mono_delta = core.last_tick_mono.elapsed().as_millis() as u64;
  core.last_tick_mono = Instant::now();

  // Scheduler pass (fires/absorbs/auto-completes reminders). The scene gate
  // reads the live context sample (quiet hours / fullscreen / meeting apps).
  let scene = core.context.snapshot();
  let typing = core.context.typing();
  let tasks = core.tasks.tasks.clone();
  if core.scheduler.tick(now, &core.settings, &tasks, scene.as_ref(), typing) {
    core.dirty_reminder = true;
  }

  // Task reminders are separate from health breaks; a pending occurrence is
  // persisted before a native notification is attempted.
  let projects = core.tasks.projects.clone();
  let failures_before = serde_json::to_value(core.task_reminders.failed()).ok();
  if let Err(error) = core.task_reminders.collect_due(&tasks, &projects, now) {
    eprintln!("[task-reminder] {}", error);
  } else {
    core.task_reminders.dispatch(&tasks, &projects, now, |delivery| send_task_notification(app, delivery));
    let failures = core.task_reminders.failed();
    if failures_before != serde_json::to_value(&failures).ok() {
      let _ = app.emit("delivery:failed-changed", failures);
    }
  }

  // Pomodoro countdown.
  let health_active = core.scheduler.status().active_reminder.is_some();
  let ctx = pomodoro_context(&core.settings, &core.tasks.tasks, &core.tasks.projects, health_active);
  if core.pomodoro.tick(mono_delta, &ctx).is_some() {
    core.dirty_pomodoro = true;
  }
  // The focused task may have been deleted or completed elsewhere.
  if core.pomodoro.reconcile_task(&ctx) {
    core.dirty_pomodoro = true;
  }

  // Hydration moments (scene gate applies: quiet hours mean skip).
  let status = core.scheduler.status();
  let surface_busy =
    status.pre_alert.is_some() || status.active_reminder.is_some() || core.pomodoro.state().phase != "idle";
  if let Some(_status) = core.hydration.tick(&core.settings, now, surface_busy, scene.as_ref(), typing, crate::hydration::system_prefers_reduced_motion) {
    core.dirty_hydration = true;
  }
  if core.hydration.pending_sip {
    core.hydration.pending_sip = false;
    if should_react(&mut core.sip_gate_last, now, SIP_SUPPRESS_MS) {
      core.reactions.push("sip");
    }
  }

  // Debounced pet-position persistence (silent: no settings broadcast).
  if let Some(position) = core.windows.flush_pet_position(now) {
    core.windows.store_pet_position(app, &mut core.settings, position);
    if let Err(error) = state.write_settings(&core.settings) {
      eprintln!("[settings] could not write pet position: {}", error);
    }
  }

  // Crash-checkpoint for the scheduler snapshot.
  if now.saturating_sub(core.last_snapshot_checkpoint) >= SNAPSHOT_CHECKPOINT_MS {
    core.last_snapshot_checkpoint = now;
    persist_runtime_state(state, core, now);
  }

  drop(guard);
  publish(app, state);
}

fn send_task_notification(app: &AppHandle, delivery: &Delivery) -> Result<(), String> {
  #[cfg(windows)]
  {
    use tauri_winrt_notification::Toast;
    // Development executables do not have the installer's registered app ID.
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let build_dir = exe.parent().and_then(|path| path.file_name()).and_then(|name| name.to_str());
    let app_id = if std::env::var("EYEPROTECT_SMOKE").as_deref() == Ok("1")
      || matches!(build_dir, Some("debug") | Some("release")) {
      Toast::POWERSHELL_APP_ID
    } else {
      &app.config().identifier
    };
    Toast::new(app_id).title(&delivery.title).text1(&delivery.body)
      .show().map_err(|error| error.to_string())
  }
  #[cfg(not(windows))]
  {
    let _ = (app, delivery);
    Err("任务提醒目前仅支持 Windows".into())
  }
}

/// A registered global shortcut fired (matched against the HOTKEYS table).
pub fn hotkey_action(app: &AppHandle, shortcut: &tauri_plugin_global_shortcut::Shortcut) {
  use tauri_plugin_global_shortcut::Shortcut;
  if on_main_thread() {
    let shortcut = *shortcut;
    run_off_main(app, move |app| hotkey_action(app, &shortcut));
    return;
  }
  let action = HOTKEYS.iter().find_map(|(action, accelerator)| {
    accelerator
      .parse::<Shortcut>()
      .ok()
      .filter(|parsed| parsed == shortcut)
      .map(|_| *action)
  });
  let Some(action) = action else { return };
  match action {
    "break-now" => crate::tray::menu_action(app, "rest-now"),
    "todo-add" | "todos" => crate::tray::menu_action(app, "open-today"),
    "pet-toggle" => crate::tray::menu_action(app, "pet-hide"),
    "pause-toggle" => {
      let now = now_ms();
      let state = app.state::<AppState>();
      {
        let mut guard = state.core.lock().unwrap();
        let core = &mut *guard;
        let paused = core.scheduler.status().paused_until.map(|until| until > now).unwrap_or(false);
        if paused {
          if core.scheduler.resume(now) {
            core.dirty_reminder = true;
          }
        } else if core.scheduler.pause(30, now) {
          core.dirty_reminder = true;
        }
      }
      publish(app, state.inner());
    }
    _ => {}
  }
}

/// (Re-)register the global hotkeys; a shortcut taken by another app lands in
/// `conflicts`. Broadcasts `hotkeys:changed` when the result differs.
pub fn apply_global_hotkeys(app: &AppHandle, state: &AppState) {
  use tauri_plugin_global_shortcut::GlobalShortcutExt;
  let shortcuts = app.global_shortcut();
  let _ = shortcuts.unregister_all();
  let mut registered: Vec<String> = Vec::new();
  let mut conflicts: Vec<String> = Vec::new();
  let enabled = {
    let core = state.core.lock().unwrap();
    core.settings.hotkeys_enabled
  };
  if enabled {
    for (action, accelerator) in HOTKEYS {
      match shortcuts.register(accelerator) {
        Ok(()) => registered.push(action.to_string()),
        Err(_) => conflicts.push(action.to_string()),
      }
    }
  }
  let status = HotkeyStatus { enabled, registered, conflicts };
  let changed = {
    let mut core = state.core.lock().unwrap();
    let changed = core.hotkey_status != status;
    core.hotkey_status = status.clone();
    changed
  };
  if changed {
    let _ = app.emit("hotkeys:changed", &status);
  }
}

/// Sync the OS autostart entry with `startWithWindows`. Like the Electron
/// shortcut writer, only the packaged build manages the entry.
pub fn sync_autostart(app: &AppHandle, state: &AppState) {
  let enabled = state.core.lock().unwrap().settings.start_with_windows;
  if let Err(error) = set_autostart(app, enabled) {
    eprintln!("[autostart] sync failed: {}", error);
  }
}

pub fn set_autostart(app: &AppHandle, desired: bool) -> Result<(), String> {
  use tauri_plugin_autostart::ManagerExt;
  // An isolated smoke run must never change the user's OS startup entry.
  if cfg!(debug_assertions) || std::env::var("EYEPROTECT_SMOKE").as_deref() == Ok("1") {
    return Ok(());
  }
  let autolaunch = app.autolaunch();
  let enabled = autolaunch.is_enabled().map_err(|error| error.to_string())?;
  let result = if desired && !enabled {
    autolaunch.enable()
  } else if !desired && enabled {
    autolaunch.disable()
  } else {
    Ok(())
  };
  result.map_err(|error| format!("无法更改开机启动：{}", error))
}

/// Persist everything on the way out so a restart resumes the countdowns.
pub fn persist_on_exit(state: &AppState) {  let mut core = state.core.lock().unwrap();
  let now = now_ms();
  core.last_exit_at = Some(now);
  persist_runtime_state(state, &mut core, now);
  if core.pomodoro.take_persist_pending() {
    persist_pomodoro(state, &core);
  } else {
    persist_pomodoro(state, &core);
  }
  if core.hydration.take_persist_pending() {
    persist_hydration(state, &core);
  }
  if core.tasks.take_persist_pending() {
    persist_tasks(state, &core);
  }
  persist_history(state, &core);
  if let Err(error) = state.write_settings(&core.settings) {
    eprintln!("[settings] could not write settings at exit: {}", error);
  }
}
