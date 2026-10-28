//! Shared test fixtures.

use crate::types::Task;

pub fn sample_task() -> Task {
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

// Debug-only fixtures reproduce the event-thread/Core lock inversion with a
// real Tauri window. The release build has neither commands nor registrations.
#[cfg(debug_assertions)]
static SMOKE_CORE_HELD: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(debug_assertions)]
#[tauri::command(async)]
pub fn smoke_hold_core_and_query_window(
  app: tauri::AppHandle,
  state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
  if std::env::var("EYEPROTECT_SMOKE").as_deref() != Ok("1") {
    return Err("Smoke fixture is disabled".into());
  }
  let _guard = state.core.lock().map_err(|error| error.to_string())?;
  SMOKE_CORE_HELD.store(true, std::sync::atomic::Ordering::SeqCst);
  // Give the test time to issue a competing state read from the webview.
  std::thread::sleep(std::time::Duration::from_millis(800));
  let result = crate::windows::WindowManager::pet_window(&app)
    .ok_or_else(|| "Pet window is missing".to_string())?
    .outer_position()
    .map(|_| ())
    .map_err(|error| error.to_string());
  SMOKE_CORE_HELD.store(false, std::sync::atomic::Ordering::SeqCst);
  result
}

#[cfg(debug_assertions)]
#[tauri::command]
pub fn smoke_core_held() -> bool {
  std::env::var("EYEPROTECT_SMOKE").as_deref() == Ok("1")
    && SMOKE_CORE_HELD.load(std::sync::atomic::Ordering::SeqCst)
}

// Deliberately models the old synchronous command for the negative control.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn smoke_blocking_core_read(state: tauri::State<'_, crate::state::AppState>) -> bool {
  if std::env::var("EYEPROTECT_SMOKE").as_deref() != Ok("1") {
    return false;
  }
  state.core.lock().is_ok()
}
