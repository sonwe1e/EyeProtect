//! Tray icon + native menus (the port of index.ts `createTray` and the pet
//! context menu). Menu events route through one app-level handler.

use crate::state::{begin_health_rest, bubble_inputs, now_ms, publish, AppState};
use crate::windows::WindowManager;
use chrono::TimeZone;
use tauri::menu::{CheckMenuItem, ContextMenu, Menu, MenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

pub struct TrayHolder {
  pub tray: Option<TrayIcon>,
}

fn format_clock(timestamp: u64) -> String {
  chrono::Local
    .timestamp_millis_opt(timestamp as i64)
    .single()
    .map(|t| t.format("%H:%M").to_string())
    .unwrap_or_else(|| "--:--".into())
}

fn item(app: &AppHandle, id: &str, label: impl AsRef<str>, enabled: bool) -> MenuItem<Wry> {
  MenuItem::with_id(app, id, label.as_ref(), enabled, None::<&str>).expect("menu item builds")
}

/// Rebuild the tray menu so it always reflects live status when opened.
pub fn refresh_tray_menu(app: &AppHandle) {
  let holder = app.try_state::<TrayHolder>();
  let Some(holder) = holder else { return };
  let tray = holder.tray.as_ref();
  let Some(tray) = tray else { return };
  let _ = tray.set_menu(Some(build_tray_menu(app)));
}

fn build_tray_menu(app: &AppHandle) -> Menu<Wry> {
  let now = now_ms();
  let state = app.state::<AppState>();
  let core = state.core.lock().unwrap();
  let status = core.scheduler.status();
  let settings = core.settings.clone();
  let paused = status.paused_until.map(|until| until > now).unwrap_or(false);
  let pending = core
    .tasks
    .tasks
    .iter()
    .filter(|task| task.status != "done" && task.status != "archived")
    .count();
  let active = status.active_reminder.clone();
  drop(core);

  let mut builder = tauri::menu::MenuBuilder::new(app).separator();
  builder = builder.item(&item(app, "tray-status",
    if paused {
      format!("EyeProtect · 已暂停至 {}", status.paused_until.map(format_clock).unwrap_or_default())
    } else {
      "EyeProtect · 运行中".to_string()
    }, false));
  if !paused {
    builder = builder
      .item(&item(app, "next-eye", if settings.eye_enabled {
        format!("下次护眼：{}", format_clock(status.next_eye_at))
      } else {
        "护眼提醒已关闭".to_string()
      }, false))
      .item(&item(app, "next-walk", if settings.walk_enabled {
        format!("下次走动：{}", format_clock(status.next_walk_at))
      } else {
        "走动提醒已关闭".to_string()
      }, false));
  }
  if let Some(active) = &active {
    builder = builder
      .separator()
      .item(&item(app, "active-label", "当前提醒", false))
      .item(&item(app, "start-rest", "开始休息", active.rest_started_at.is_none()))
      .item(&item(app, "complete", "完成当前提醒",
        active.rest_started_at.is_some() && now >= active.unlock_at))
      .item(&item(app, "snooze", "稍后提醒", now >= active.snooze_allowed_at))
      .item(&item(app, "skip", "跳过当前提醒", true));
  }
  builder = builder.separator();
  if paused {
    builder = builder
      .item(&item(app, "resume", "恢复提醒", true))
      .item(&item(app, "restart", "重新开始计时", true));
  } else {
    builder = builder
      .item(&item(app, "rest-now", "立即休息", active.is_none()))
      .item(&item(app, "pause-30", "暂停 30 分钟", true))
      .item(&item(app, "pause-60", "暂停 1 小时", true));
  }
  builder = builder
    .separator()
    .item(&item(app, "todo-count", format!("待办：{} 项未完成", pending), false))
    .item(&item(app, "open-today", "打开工作台", true))
    .item(&item(app, "open-settings", "打开设置", true))
    .item(&item(app, "recall-pet", "召回桌宠到当前屏幕", true))
    .item(&item(app, "reload-pet", "重新加载宠物", true))
    .separator()
    .item(&item(app, "quit", "退出", true));
  builder.build().expect("tray menu builds")
}

pub fn init_tray(app: &AppHandle) {
  let menu = build_tray_menu(app);
  let mut builder = TrayIconBuilder::with_id("main")
    .menu(&menu)
    .show_menu_on_left_click(false)
    .tooltip("EyeProtect")
    .on_tray_icon_event(|tray, event| {
      if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
        let app = tray.app_handle().clone();
        menu_action(&app, "open-today");
      }
    });
  if let Some(icon) = app.default_window_icon() {
    builder = builder.icon(icon.clone());
  }
  match builder.build(app) {
    Ok(tray) => {
      app.manage(TrayHolder { tray: Some(tray) });
    }
    Err(error) => {
      eprintln!("[tray] init failed: {}", error);
      app.manage(TrayHolder { tray: None });
    }
  }
}

fn mutate_then_publish(app: &AppHandle, mutate: impl FnOnce(&mut crate::state::Core)) {
  let state = app.state::<AppState>();
  {
    let mut core = state.core.lock().unwrap();
    mutate(&mut core);
  }
  publish(app, &state);
}

/// One handler for tray + pet context menu ids.
pub fn menu_action(app: &AppHandle, id: &str) {
  // Window work may hold Core while waiting for the event loop. Menu callbacks
  // must not park that same event loop while trying to acquire Core.
  if crate::state::on_main_thread() {
    let id = id.to_owned();
    crate::state::run_off_main(app, move |app| menu_action(app, &id));
    return;
  }
  let now = now_ms();
  match id {
    "start-rest" => mutate_then_publish(app, |core| {
      if let Some(active) = core.scheduler.status().active_reminder {
        begin_health_rest(core, &active.id, now);
      }
    }),
    "complete" | "snooze" | "skip" => mutate_then_publish(app, |core| {
      if let Some(active) = core.scheduler.status().active_reminder {
        if core.scheduler.handle_action(id, &active.id, &core.settings, now) {
          core.dirty_reminder = true;
        }
      }
    }),
    "resume" => mutate_then_publish(app, |core| {
      if core.scheduler.resume(now) {
        core.dirty_reminder = true;
      }
    }),
    "restart" => mutate_then_publish(app, |core| {
      if core.scheduler.restart_cycle(&core.settings, now) {
        core.dirty_reminder = true;
      }
    }),
    "rest-now" => mutate_then_publish(app, |core| {
      let tasks = core.tasks.tasks.clone();
      if core.scheduler.trigger_now(&core.settings, &tasks, now) {
        core.dirty_reminder = true;
      }
    }),
    "pause-30" | "pet-pause-30" => mutate_then_publish(app, |core| {
      if core.scheduler.pause(30, now) {
        core.dirty_reminder = true;
      }
    }),
    "pause-60" | "pet-pause-60" => mutate_then_publish(app, |core| {
      if core.scheduler.pause(60, now) {
        core.dirty_reminder = true;
      }
    }),
    "pet-pause-day" => mutate_then_publish(app, |core| {
      if core.scheduler.pause(1440, now) {
        core.dirty_reminder = true;
      }
    }),
    "open-today" | "pet-open-today" => show_workbench(app, "today"),
    "open-settings" | "pet-open-settings" => show_workbench(app, "settings"),
    "pet-open-review" => show_workbench(app, "review"),
    "recall-pet" | "pet-recall" => mutate_then_publish(app, |core| {
      core.windows.bring_pet_to_active_display(app, &mut core.settings);
      core.dirty_settings = true;
    }),
    "reload-pet" => {
      // Menu events arrive on the main thread; window builds go to the pool.
      crate::state::run_off_main(app, |app| {
        let state = app.state::<AppState>();
        {
          let mut guard = state.core.lock().unwrap();
          let core = &mut *guard;
          if let Some(window) = WindowManager::pet_window(app) {
            let _ = window.destroy();
          }
          core.windows.create_pet_window(app, &core.settings);
        }
        publish(app, state.inner());
      });
    }
    "pet-test-eye" | "pet-test-walk" | "pet-test-combined" => mutate_then_publish(app, |core| {
      let kind = id.trim_start_matches("pet-test-");
      let tasks = core.tasks.tasks.clone();
      if core.scheduler.trigger_test(kind, &core.settings, &tasks, now) {
        core.dirty_reminder = true;
      }
    }),
    "pet-pomodoro-toggle" => mutate_then_publish(app, |core| {
      let phase = core.pomodoro.state().phase;
      let health = core.scheduler.status().active_reminder.is_some();
      let ctx = crate::state::pomodoro_context(&core.settings, &core.tasks.tasks, &core.tasks.projects, health);
      if phase == "focus" {
        let _ = core.pomodoro.act("stop", &ctx);
      } else {
        let minutes = core.settings.pomodoro_minutes.max(1) as f64;
        let _ = core.pomodoro.start(None, minutes, true, &ctx);
      }
      core.dirty_pomodoro = true;
    }),
    "pet-motion" => mutate_then_publish(app, |core| {
      core.settings.pet_motion = !core.settings.pet_motion;
      core.dirty_settings = true;
      core.dirty_hydration = true;
      core.hydration.on_settings_changed(&core.settings, now);
    }),
    "pet-hide" => {
      let (settings, inputs) = {
        let state = app.state::<AppState>();
        let mut guard = state.core.lock().unwrap();
        let core = &mut *guard;
        let inputs = bubble_inputs(core);
        core.windows.toggle_pet_visibility_flag();
        (core.settings.clone(), inputs)
      };
      crate::state::run_off_main(app, move |app| {
        let state = app.state::<AppState>();
        let mut guard = state.core.lock().unwrap();
        let core = &mut *guard;
        core.windows.apply_pet_visibility(app, &settings, &inputs, now);
      });
    }
    "quit" => app.exit(0),
    _ => {}
  }
  refresh_tray_menu(app);
}

fn show_workbench(app: &AppHandle, section: &str) {
  let section = section.to_string();
  crate::state::run_off_main(app, move |app| {
    let state = app.state::<AppState>();
    let mut guard = state.core.lock().unwrap();
    let core = &mut *guard;
    core.windows.show_workbench(app, &core.settings, &section, None);
  });
}

/// `window:pet:context-menu` — the pet's right-click menu.
#[tauri::command(async)]
pub fn window_pet_context_menu(app: AppHandle, state: tauri::State<'_, AppState>) {
  let Some(window) = WindowManager::pet_window(&app) else { return };
  let core = state.core.lock().unwrap();
  let status = core.scheduler.status();
  let settings = core.settings.clone();
  let pomodoro_phase = core.pomodoro.state().phase;
  let now = now_ms();
  let paused = status.paused_until.map(|until| until > now).unwrap_or(false);
  let has_active = status.active_reminder.is_some();
  drop(core);

  let test_owned = [
    item(&app, "pet-test-eye", "护眼休息", !has_active),
    item(&app, "pet-test-walk", "走动休息", !has_active),
    item(&app, "pet-test-combined", "合并提醒", !has_active),
  ];
  let test_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> =
    test_owned.iter().map(|entry| entry as &dyn tauri::menu::IsMenuItem<Wry>).collect();
  let rest_menu = Submenu::with_id_and_items(&app, "rest", "🍵 立即休息", !has_active, &test_refs)
    .expect("submenu builds");

  let pause_owned: Vec<MenuItem<Wry>> = if paused {
    vec![
      item(&app, "pet-resume", "立即恢复", true),
      item(&app, "pet-restart", "重新开始计时", true),
    ]
  } else {
    vec![
      item(&app, "pet-pause-30", "暂停 30 分钟", true),
      item(&app, "pet-pause-60", "暂停 1 小时", true),
      item(&app, "pet-pause-day", "暂停至明天", true),
    ]
  };
  let pause_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> =
    pause_owned.iter().map(|entry| entry as &dyn tauri::menu::IsMenuItem<Wry>).collect();
  let pause_menu = Submenu::with_id_and_items(
    &app,
    "pause",
    if paused { "▶ 恢复提醒" } else { "⏸ 暂停提醒" },
    true,
    &pause_refs,
  )
  .expect("submenu builds");

  let workbench_owned = [
    item(&app, "pet-open-today", "待办任务", true),
    item(&app, "pet-open-review", "完成记录", true),
    item(&app, "pet-open-settings", "设置", true),
  ];
  let workbench_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> =
    workbench_owned.iter().map(|entry| entry as &dyn tauri::menu::IsMenuItem<Wry>).collect();
  let workbench_menu =
    Submenu::with_id_and_items(&app, "workbench", "📋 打开工作台", true, &workbench_refs)
      .expect("submenu builds");

  let motion_toggle = CheckMenuItem::with_id(&app, "pet-motion", "桌宠小动作", settings.pet_motion, true, None::<&str>)
    .expect("checkbox builds");
  let pomodoro_label = if pomodoro_phase == "focus" {
    "⏹ 停止专注"
  } else {
    "⏱ 开始专注 (25分钟)"
  };

  let menu = tauri::menu::MenuBuilder::new(&app)
    .item(&rest_menu)
    .item(&pause_menu)
    .item(&item(&app, "pet-pomodoro-toggle", pomodoro_label, true))
    .separator()
    .item(&motion_toggle)
    .separator()
    .item(&workbench_menu)
    .item(&item(&app, "pet-recall", "🎯 召回桌宠到当前屏幕", true))
    .item(&item(&app, "pet-hide", "👁 隐藏桌宠 (可在托盘唤醒)", true))
    .build()
    .expect("pet menu builds");
  // popup() wants the underlying Window handle of the pet webview window.
  let _ = menu.popup(window.as_ref().window());
}
