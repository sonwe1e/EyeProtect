//! EyeProtect Tauri shell (Rust backend).
//!
//! Phase 1 scope (fresh data store): settings, tasks/lists/steps, reminder
//! scheduling, pomodoro, hydration, tray, and the pet/bubble/alert/workbench
//! windows — driven by the unchanged React renderer through the Tauri bridge.

pub mod backup;
pub mod commands;
pub mod fsutil;
pub mod history;
pub mod hydration;
pub mod pomodoro;
pub mod reminder_context;
pub mod scheduler;
pub mod state;
pub mod task_reminders;
pub mod tasks;
pub mod tests_support;
pub mod tray;
pub mod types;
pub mod winarea;
pub mod wincontext;
pub mod windows;

use state::AppState;
use std::path::PathBuf;
use tauri::Manager;

fn resolve_data_dir(app: &tauri::AppHandle) -> PathBuf {
  if let Ok(dir) = std::env::var("EYEPROTECT_DATA_DIR") {
    if !dir.trim().is_empty() {
      return PathBuf::from(dir);
    }
  }
  app
    .path()
    .app_data_dir()
    .expect("app data dir resolves")
}

fn report_startup_error(message: &str) {
  let detail = format!("无法安全读取 EyeProtect 的本地数据，应用未启动，原文件没有被覆盖。\n\n{}\n\n请检查数据目录或从备份恢复。", message);
  eprintln!("[startup] {}", detail);
  #[cfg(windows)]
  {
    #[link(name = "user32")]
    extern "system" {
      fn MessageBoxW(window: *mut std::ffi::c_void, text: *const u16, title: *const u16, kind: u32) -> i32;
    }
    let text: Vec<u16> = detail.encode_utf16().chain(Some(0)).collect();
    let title: Vec<u16> = "EyeProtect 无法启动".encode_utf16().chain(Some(0)).collect();
    unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), 0x10); }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Registered first: a second launch focuses the workbench instead.
    .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
      tray::menu_action(app, "open-today");
    }))
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      None,
    ))
    .plugin(
      tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
          if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            state::hotkey_action(app, shortcut);
          }
        })
        .build(),
    )
    .on_menu_event(|app, event| {
      tray::menu_action(app, event.id().as_ref());
    })
    .invoke_handler(tauri::generate_handler![
      commands::settings_get,
      commands::settings_save,
      commands::runtime_get,
      commands::app_health_get,
      commands::app_relaunch,
      commands::reminder_status,
      commands::reminder_action,
      commands::reminder_pre_alert,
      commands::reminder_test,
      commands::reminder_now,
      commands::reminder_pause,
      commands::reminder_resume,
      commands::reminder_restart,
      commands::reminder_begin_rest,
      commands::reminder_companion,
      commands::hydration_get,
      commands::hydration_record,
      commands::hydration_dismiss,
      commands::pomodoro_prepare,
      commands::pomodoro_get,
      commands::pomodoro_start,
      commands::pomodoro_action,
      commands::task_list,
      commands::task_create,
      commands::task_update,
      commands::task_move,
      commands::task_reorder_queue,
      commands::task_set_status,
      commands::task_delete,
      commands::task_complete_tree,
      commands::task_move_step,
      commands::task_create_step,
      commands::task_undo_get,
      commands::task_undo,
      commands::task_active_set,
      commands::task_restore_legacy,
      commands::project_list,
      commands::project_create,
      commands::project_update,
      commands::project_delete,
      commands::delivery_failed_list,
      commands::delivery_failed_retry,
      commands::delivery_failed_dismiss,
      commands::hotkeys_status,
      commands::data_backup_export,
      commands::data_backup_import,
      commands::data_reset,
      commands::data_open_directory,
      commands::data_recovery_info,
      commands::data_legacy,
      commands::pet_custom_get_assets,
      commands::pet_custom_open_folder,
      commands::window_pet_artwork_bounds,
      commands::window_bubble_height,
      commands::window_pet_move,
      commands::window_pet_toggle_visibility,
      commands::window_pet_recall,
      commands::window_workbench_open,
      commands::window_workbench_close,
      commands::window_workbench_section,
      tray::window_pet_context_menu,
      #[cfg(debug_assertions)]
      tests_support::smoke_hold_core_and_query_window,
      #[cfg(debug_assertions)]
      tests_support::smoke_core_held,
      #[cfg(debug_assertions)]
      tests_support::smoke_blocking_core_read
    ])
    .setup(|app| {
      // The run loop owns this thread; window builds must never run on it.
      let _ = state::MAIN_THREAD_ID.set(std::thread::current().id());
      let data_dir = resolve_data_dir(app.handle());
      if let Err(error) = std::fs::create_dir_all(&data_dir) {
        let message = format!("无法访问数据目录 {}：{}", data_dir.display(), error);
        report_startup_error(&message);
        return Err(std::io::Error::other(message).into());
      }
      let state = match AppState::load(app.handle(), data_dir) {
        Ok(state) => state,
        Err(message) => {
          report_startup_error(&message);
          return Err(std::io::Error::other(message).into());
        }
      };
      app.manage(state);

      tray::init_tray(app.handle());

      // Pet window is best-effort eye candy: never fatal to startup.
      {
        let state = app.state::<AppState>();
        let mut guard = state.core.lock().unwrap();
        let core = &mut *guard;
        core.windows.create_pet_window(app.handle(), &core.settings);
        // A break session recovered from the last run must be presented; a
        // normal start must NOT touch the pet window while its first
        // navigation is still in flight (that aborts it to about:blank).
        if core.scheduler.status().active_reminder.is_some() {
          core.dirty_reminder = true;
        }
      }

      let state = app.state::<AppState>();
      {
        // Scene sampling follows the foreground/fullscreen DND settings.
        let mut guard = state.core.lock().unwrap();
        let core = &mut *guard;
        core.context.configure_from_settings(&core.settings);
      }
      state::apply_global_hotkeys(app.handle(), state.inner());
      state::sync_autostart(app.handle(), state.inner());

      // Start window work only after the setup thread has finished taking
      // Core, otherwise setup and the worker can wait on each other.
      state::publish(app.handle(), state.inner());

      // The 1 s heartbeat (scheduler/pomodoro/hydration + watchdog).
      let handle = app.handle().clone();
      tauri::async_runtime::spawn(async move {
        let mut interval =
          tokio::time::interval(std::time::Duration::from_millis(1000));
        loop {
          interval.tick().await;
          let state = handle.state::<AppState>();
          state::tick(&handle, state.inner());
        }
      });
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("failed to build tauri application")
    .run(|app_handle, event| {
      if let tauri::RunEvent::Exit = event {
        let state = app_handle.state::<AppState>();
        state::persist_on_exit(state.inner());
      }
    });
}
