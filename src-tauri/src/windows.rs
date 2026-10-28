//! Window lifecycle — Rust port of `src/main/windows.ts` for the four surfaces
//! (pet / bubble / alert / workbench) plus the focused-rest dim masks.
//!
//! All layout math is done in logical (DIP) coordinates like the Electron
//! implementation and converted per-display to physical pixels on apply.

use crate::types::{PetPosition, Project, ReminderStatus, Settings, Task};
use crate::winarea::{
  active_display, clamp, display_at_point, display_layout_key, get_alert_bounds,
  get_pet_bubble_layout, get_pet_move_bounds, list_displays, DisplayInfo,
};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const PET_LABEL: &str = "pet";
pub const BUBBLE_LABEL: &str = "bubble";
pub const ALERT_LABEL: &str = "alert";
pub const WORKBENCH_LABEL: &str = "workbench";

const TODO_BUBBLE_SIZE: (f64, f64) = (260.0, 180.0);
const PRE_ALERT_BUBBLE_SIZE: (f64, f64) = (300.0, 172.0);
const GENTLE_BUBBLE_SIZE: (f64, f64) = (300.0, 224.0);
const GENTLE_COMBINED_BUBBLE_SIZE: (f64, f64) = (320.0, 292.0);
const POMODORO_BUBBLE_SIZE: (f64, f64) = (280.0, 220.0);
const HYDRATION_BUBBLE_SIZE: (f64, f64) = (300.0, 168.0);
const ALL_DONE_DISPLAY_MS: u64 = 2_500;

/// Everything `refresh_bubble` needs from the domain state.
pub struct BubbleInputs {
  pub status: ReminderStatus,
  pub pomodoro_phase: String,
  pub hydration_prompt: Option<crate::types::HydrationPrompt>,
  pub tasks: Vec<Task>,
  pub projects: Vec<Project>,
}

impl BubbleInputs {
  pub fn snapshot(
    status: &ReminderStatus,
    pomodoro: &crate::types::PomodoroState,
    hydration: Option<&crate::types::HydrationPrompt>,
    tasks: &[Task],
    projects: &[Project],
  ) -> BubbleInputs {
    BubbleInputs {
      status: status.clone(),
      pomodoro_phase: pomodoro.phase.clone(),
      hydration_prompt: hydration.cloned(),
      tasks: tasks.to_vec(),
      projects: projects.to_vec(),
    }
  }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BubbleSurface {
  PreAlert,
  Gentle,
  Pomodoro,
  Hydration,
  Todo,
}

impl BubbleSurface {
  fn key(&self, inputs: &BubbleInputs) -> String {
    match self {
      BubbleSurface::PreAlert => "prealert".into(),
      BubbleSurface::Gentle => format!(
        "gentle-{}",
        inputs.status.active_reminder.as_ref().map(|a| a.id.clone()).unwrap_or_default()
      ),
      BubbleSurface::Pomodoro => format!("pomodoro-{}", inputs.pomodoro_phase),
      BubbleSurface::Hydration => format!(
        "hydration-{}",
        inputs.hydration_prompt.as_ref().map(|p| p.id.clone()).unwrap_or_default()
      ),
      BubbleSurface::Todo => "todo".into(),
    }
  }

  fn base_size(&self, inputs: &BubbleInputs) -> (f64, f64) {
    match self {
      BubbleSurface::PreAlert => PRE_ALERT_BUBBLE_SIZE,
      BubbleSurface::Gentle => {
        let active = inputs.status.active_reminder.as_ref();
        if active.map(|a| a.kind == "combined" || a.break_task.is_some()).unwrap_or(false) {
          GENTLE_COMBINED_BUBBLE_SIZE
        } else {
          GENTLE_BUBBLE_SIZE
        }
      }
      BubbleSurface::Pomodoro => POMODORO_BUBBLE_SIZE,
      BubbleSurface::Hydration => HYDRATION_BUBBLE_SIZE,
      BubbleSurface::Todo => TODO_BUBBLE_SIZE,
    }
  }
}

/// Priority: pre-alert > gentle reminder > pomodoro > hydration > todo
/// (shared/bubbleSurface.ts).
pub fn resolve_bubble_surface(inputs: &BubbleInputs) -> BubbleSurface {
  if inputs.status.pre_alert.is_some() {
    return BubbleSurface::PreAlert;
  }
  if inputs
    .status
    .active_reminder
    .as_ref()
    .map(|a| a.mode == "gentle")
    .unwrap_or(false)
  {
    return BubbleSurface::Gentle;
  }
  if inputs.pomodoro_phase != "idle" {
    return BubbleSurface::Pomodoro;
  }
  if inputs.hydration_prompt.as_ref().map(|p| p.phase == "strip").unwrap_or(false) {
    return BubbleSurface::Hydration;
  }
  BubbleSurface::Todo
}

/// Pet-bubble task selection (shared/petTasks.ts).
pub fn select_pet_tasks(settings: &Settings, tasks: &[Task], projects: &[Project]) -> Vec<Task> {
  let mut selected: Vec<Task> = Vec::new();
  let mut seen = std::collections::HashSet::new();
  for id in &settings.todo_bubble_task_ids {
    if !seen.insert(id.clone()) {
      continue;
    }
    if let Some(task) = tasks.iter().find(|task| &task.id == id) {
      let project = task.project_id.as_deref().and_then(|pid| projects.iter().find(|p| p.id == pid));
      let writable = project.map(|p| crate::types::is_project_writable(Some(p))).unwrap_or(true);
      let eligible = task.parent_id.is_none() && task.status != "done" && task.status != "archived"
        && (task.project_id.is_none() || writable);
      if eligible {
        selected.push(task.clone());
      }
    }
  }
  selected
}

fn view_url(fragment: &str) -> WebviewUrl {
  WebviewUrl::App(format!("web.html#{}", fragment).into())
}

fn set_logical_bounds(window: &WebviewWindow, display: &DisplayInfo, bounds: (f64, f64, f64, f64)) {
  let scale = display.scale;
  let _ = window.set_position(PhysicalPosition::new(
    (bounds.0 * scale).round() as i32,
    (bounds.1 * scale).round() as i32,
  ));
  let _ = window.set_size(PhysicalSize::new(
    (bounds.2 * scale).round() as u32,
    (bounds.3 * scale).round() as u32,
  ));
}

fn window_bounds_physical(window: &WebviewWindow) -> Option<(i32, i32, u32, u32)> {
  let position = window.outer_position().ok()?;
  let size = window.outer_size().ok()?;
  Some((position.x, position.y, size.width, size.height))
}

fn rect_contains(bounds: (i32, i32, u32, u32), point: (i32, i32)) -> bool {
  point.0 >= bounds.0 && point.0 < bounds.0 + bounds.2 as i32 && point.1 >= bounds.1 && point.1 < bounds.1 + bounds.3 as i32
}

fn hex_color(value: &str) -> tauri::utils::config::Color {
  let hex = value.trim_start_matches('#');
  if hex.len() == 6 {
    let parse = |range: std::ops::Range<usize>| u8::from_str_radix(&hex[range], 16).unwrap_or(255);
    return tauri::utils::config::Color(parse(0..2), parse(2..4), parse(4..6), 255);
  }
  tauri::utils::config::Color(245, 242, 236, 255)
}

#[derive(Default)]
pub struct WindowManager {
  pub pet_temporarily_hidden: bool,
  pub pet_artwork_bounds: (f64, f64),
  bubble_height: Option<f64>,
  bubble_surface_key: String,
  last_bubble_size: (f64, f64),
  previous_selected_pending: Vec<String>,
  all_done_until: Option<u64>,
  dim_labels: Vec<String>,
  pub workbench_section: String,
  pub workbench_focus_task_id: Option<String>,
  presented_reminder_id: Option<String>,
  pet_position_dirty: Option<PetPosition>,
  pet_position_last_write: u64,
}

impl WindowManager {
  pub fn new() -> WindowManager {
    WindowManager {
      pet_artwork_bounds: (8.0 / 64.0, 60.0 / 64.0),
      ..Default::default()
    }
  }

  pub fn idle_pet_size(&self, settings: &Settings) -> (f64, f64) {
    let base = if settings.pet_companion == "pixel" { 160.0 } else { 200.0 };
    let size = (base * settings.pet_scale).round();
    (size, size)
  }

  fn saved_pet_position(&self, settings: &Settings, layout_key: &str) -> Option<(f64, f64)> {
    settings
      .pet_positions_by_layout
      .get(layout_key)
      .or(settings.pet_position.as_ref())
      .map(|position| (position.x as f64, position.y as f64))
  }

  fn initial_pet_bounds(&self, settings: &Settings, layout_key: &str, display: &DisplayInfo) -> (f64, f64, f64, f64) {
    let (width, height) = self.idle_pet_size(settings);
    let (wx, wy, ww, wh) = display.work_area_logical();
    match self.saved_pet_position(settings, layout_key) {
      Some((x, y)) => (
        clamp(x, wx, wx + ww - width),
        clamp(y, wy, wy + wh - height),
        width,
        height,
      ),
      None => (wx + ww - width - 24.0, wy + wh - height - 24.0, width, height),
    }
  }

  pub fn pet_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(PET_LABEL)
  }

  /// Best-effort pet window creation; never fatal to startup.
  pub fn create_pet_window(&mut self, app: &AppHandle, settings: &Settings) {
    if Self::pet_window(app).is_some() {
      return;
    }
    let layout_key = display_layout_key(app);
    let saved = self.saved_pet_position(settings, &layout_key);
    let probe_scale = list_displays(app).first().map(|d| d.scale).unwrap_or(1.0);
    let display = saved
      .and_then(|(x, y)| display_at_point(app, ((x * probe_scale) as i32, (y * probe_scale) as i32)))
      .or_else(|| list_displays(app).first().cloned())
      .unwrap_or_else(|| active_display(app, None));
    let bounds = self.initial_pet_bounds(settings, &layout_key, &display);
    let builder = WebviewWindowBuilder::new(app, PET_LABEL, view_url("pet"))
      .decorations(false)
      .transparent(true)
      .resizable(false)
      .maximizable(false)
      .minimizable(false)
      .closable(false)
      .skip_taskbar(true)
      .shadow(false)
      .always_on_top(true)
      .focused(false)
      .visible(false)
      .title("EyeProtect");
    match builder.build() {
      Ok(window) => {
        set_logical_bounds(&window, &display, bounds);
        let _ = window.show();
      }
      Err(error) => {
        eprintln!("[windows] pet window creation failed: {}", error);
      }
    }
  }

  pub fn pet_bounds(&self, app: &AppHandle) -> Option<(i32, i32, u32, u32)> {
    Self::pet_window(app).and_then(|window| window_bounds_physical(&window))
  }

  /// Drag move: input is logical; clamps into the nearest display's work area.
  pub fn move_pet_window(
    &mut self,
    app: &AppHandle,
    settings: &Settings,
    position: (f64, f64),
  ) -> Option<(f64, f64)> {
    let window = Self::pet_window(app)?;
    let current = window_bounds_physical(&window)?;
    let current_display =
      display_at_point(app, (current.0 + current.2 as i32 / 2, current.1 + current.3 as i32 / 2))?;
    let probe = (
      (position.0 * current_display.scale) as i32,
      (position.1 * current_display.scale) as i32,
    );
    let display = display_at_point(app, probe).unwrap_or(current_display);
    let (wx, wy, ww, wh) = display.work_area_logical();
    let size = self.idle_pet_size(settings);
    let (x, y) = get_pet_move_bounds(position, (wx, wy, ww, wh), size);
    set_logical_bounds(&window, &display, (x, y, size.0, size.1));
    self.position_bubble(app);
    self.pet_position_dirty = Some(PetPosition { x: x.round() as i64, y: y.round() as i64 });
    Some((x, y))
  }

  /// Debounced persistence, driven by the 1 s tick (400 ms in Electron).
  pub fn flush_pet_position(&mut self, now: u64) -> Option<PetPosition> {
    let position = self.pet_position_dirty.clone()?;
    if now.saturating_sub(self.pet_position_last_write) < 400 {
      return None;
    }
    self.pet_position_dirty = None;
    self.pet_position_last_write = now;
    Some(position)
  }

  pub fn store_pet_position(&mut self, app: &AppHandle, settings: &mut Settings, position: PetPosition) {
    let layout_key: String = display_layout_key(app).chars().take(240).collect();
    settings.pet_position = Some(position.clone());
    settings.pet_positions_by_layout.insert(layout_key, position);
    if settings.pet_positions_by_layout.len() > 20 {
      if let Some(oldest) = settings.pet_positions_by_layout.keys().next().cloned() {
        settings.pet_positions_by_layout.remove(&oldest);
      }
    }
  }

  /// Flip the user's hide/show preference and return the new state. The
  /// window work happens in `apply_pet_visibility` so callers can run it off
  /// the main thread.
  pub fn toggle_pet_visibility_flag(&mut self) -> bool {
    self.pet_temporarily_hidden = !self.pet_temporarily_hidden;
    self.pet_temporarily_hidden
  }

  pub fn apply_pet_visibility(&mut self, app: &AppHandle, settings: &Settings, inputs: &BubbleInputs, now: u64) {
    if self.pet_temporarily_hidden {
      if let Some(window) = Self::pet_window(app) {
        let _ = window.hide();
      }
      self.destroy_bubble(app);
    } else {
      self.apply_reminder_status(app, settings, inputs, now);
    }
  }

  pub fn toggle_pet_visibility(&mut self, app: &AppHandle, settings: &Settings, inputs: &BubbleInputs, now: u64) -> bool {
    self.pet_temporarily_hidden = !self.pet_temporarily_hidden;
    if self.pet_temporarily_hidden {
      if let Some(window) = Self::pet_window(app) {
        let _ = window.hide();
      }
      self.destroy_bubble(app);
    } else {
      self.apply_reminder_status(app, settings, inputs, now);
    }
    self.pet_temporarily_hidden
  }

  /// Move the pet to the bottom-right of the active display and un-hide it.
  pub fn bring_pet_to_active_display(&mut self, app: &AppHandle, settings: &mut Settings) {
    let Some(window) = Self::pet_window(app) else { return };
    self.pet_temporarily_hidden = false;
    let display = active_display(app, self.pet_bounds(app));
    let (wx, wy, ww, wh) = display.work_area_logical();
    let size = self.idle_pet_size(settings);
    let x = (wx + ww - size.0 - 24.0).round();
    let y = (wy + wh - size.1 - 24.0).round();
    set_logical_bounds(&window, &display, (x, y, size.0, size.1));
    let _ = window.show();
    self.store_pet_position(
      app,
      settings,
      PetPosition { x: x as i64, y: y as i64 },
    );
  }

  // ── Workbench ─────────────────────────────────────────────────────────────

  pub fn show_workbench(
    &mut self,
    app: &AppHandle,
    settings: &Settings,
    section: &str,
    focus_task_id: Option<String>,
  ) {
    let section = match section {
      "review" | "settings" => section.to_string(),
      _ => "today".to_string(),
    };
    self.workbench_section = section.clone();
    self.workbench_focus_task_id = focus_task_id.clone();
    let payload = json!({ "section": section, "focusTaskId": focus_task_id });

    if let Some(window) = app.get_webview_window(WORKBENCH_LABEL) {
      // Re-center onto the active display when the window lives elsewhere.
      if let Some(bounds) = window_bounds_physical(&window) {
        let center = (bounds.0 + bounds.2 as i32 / 2, bounds.1 + bounds.3 as i32 / 2);
        let current = display_at_point(app, center);
        let target = active_display(app, self.pet_bounds(app));
        let moved = match (&current, &target) {
          (Some(current), target) => !rect_contains(target.bounds, center)
            || current.key != target.key,
          (None, _) => true,
        };
        if moved {
          let (wx, wy, ww, wh) = target.work_area_logical();
          let scale = target.scale;
          let width = (bounds.2 as f64 / scale).min(ww);
          let height = (bounds.3 as f64 / scale).min(wh);
          let x = wx + ((ww - width) / 2.0).round();
          let y = wy + ((wh - height) / 2.0).round();
          set_logical_bounds(&window, &target, (x, y, width, height));
        }
      }
      let _ = window.show();
      let _ = window.set_focus();
      let _ = app.emit_to(WORKBENCH_LABEL, "workbench:navigate", payload);
      return;
    }

    let display = active_display(app, self.pet_bounds(app));
    let (wx, wy, ww, wh) = display.work_area_logical();
    let width = (ww * 0.7).clamp(960.0, 1280.0);
    let height = (wh * 0.75).clamp(600.0, 800.0);
    let x = wx + ((ww - width) / 2.0).round();
    let y = wy + ((wh - height) / 2.0).round();
    let background = match settings.theme.as_str() {
      "light" => hex_color("#ffffff"),
      "dark" => hex_color("#14161a"),
      _ => hex_color("#f5f2ec"),
    };
    let builder = WebviewWindowBuilder::new(app, WORKBENCH_LABEL, view_url("workbench"))
      .title("EyeProtect · 工作台")
      .decorations(true)
      .resizable(true)
      .min_inner_size(880.0, 560.0)
      .visible(false)
      .background_color(background);
    match builder.build() {
      Ok(window) => {
        set_logical_bounds(&window, &display, (x, y, width, height));
        let _ = app.emit_to(WORKBENCH_LABEL, "workbench:navigate", payload);
        let _ = window.show();
        let _ = window.set_focus();
      }
      Err(error) => eprintln!("[windows] workbench creation failed: {}", error),
    }
  }

  pub fn close_workbench(&self, app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WORKBENCH_LABEL) {
      let _ = window.destroy();
    }
  }

  pub fn workbench_section(&self) -> crate::types::WorkbenchNavPayload {
    crate::types::WorkbenchNavPayload {
      section: self.workbench_section.clone(),
      focus_task_id: self.workbench_focus_task_id.clone(),
    }
  }

  // ── Bubble ────────────────────────────────────────────────────────────────

  pub fn destroy_bubble(&mut self, app: &AppHandle) {
    self.all_done_until = None;
    if let Some(window) = app.get_webview_window(BUBBLE_LABEL) {
      let _ = window.destroy();
    }
  }

  pub fn report_pet_artwork_bounds(&mut self, app: &AppHandle, top: f64, bottom: f64) {
    if !top.is_finite() || !bottom.is_finite() || !(0.0..=1.0).contains(&top) || !(0.0..=1.0).contains(&bottom) || top >= bottom {
      return;
    }
    self.pet_artwork_bounds = (top, bottom);
    self.position_bubble(app);
  }

  pub fn report_bubble_height(&mut self, app: &AppHandle, height: f64) {
    if !height.is_finite() || !(40.0..=600.0).contains(&height) {
      return;
    }
    let next = height.ceil();
    if self.bubble_height == Some(next) {
      return;
    }
    self.bubble_height = Some(next);
    self.last_bubble_size.1 = next;
    self.position_bubble(app);
  }

  fn bubble_size(&mut self, surface: BubbleSurface, inputs: &BubbleInputs) -> (f64, f64) {
    let key = surface.key(inputs);
    if key != self.bubble_surface_key {
      self.bubble_surface_key = key;
      self.bubble_height = None;
    }
    let base = surface.base_size(inputs);
    (base.0, self.bubble_height.unwrap_or(base.1))
  }

  pub fn position_bubble(&self, app: &AppHandle) {
    let Some(bubble) = app.get_webview_window(BUBBLE_LABEL) else { return };
    let Some(pet_window) = Self::pet_window(app) else { return };
    let Some(pet_physical) = window_bounds_physical(&pet_window) else { return };
    let Some(display) = display_at_point(app, (pet_physical.0, pet_physical.1)) else { return };
    let scale = display.scale;
    let pet_logical = (
      pet_physical.0 as f64 / scale,
      pet_physical.1 as f64 / scale,
      pet_physical.2 as f64 / scale,
      pet_physical.3 as f64 / scale,
    );
    let (width, height) = self.last_bubble_size;
    let layout = get_pet_bubble_layout(
      pet_logical,
      display.work_area_logical(),
      (width, height),
      self.pet_artwork_bounds,
    );
    set_logical_bounds(&bubble, &display, layout.bounds);
    let _ = app.emit_to(
      BUBBLE_LABEL,
      "bubble:layout",
      json!({ "placement": layout.placement, "tailX": layout.tail_x }),
    );
  }

  fn ensure_bubble(&mut self, app: &AppHandle, inputs: &BubbleInputs, surface: BubbleSurface, now: u64) {
    self.all_done_until = None;
    let size = self.bubble_size(surface, inputs);
    self.last_bubble_size = size;
    if app.get_webview_window(BUBBLE_LABEL).is_none() {
      let builder = WebviewWindowBuilder::new(app, BUBBLE_LABEL, view_url("bubble"))
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .skip_taskbar(true)
        .shadow(false)
        .always_on_top(true)
        .focusable(false)
        .visible(false)
        .title("EyeProtect");
      if let Err(error) = builder.build() {
        eprintln!("[windows] bubble creation failed: {}", error);
        return;
      }
    }
    self.position_bubble(app);
    if let Some(window) = app.get_webview_window(BUBBLE_LABEL) {
      let _ = window.show();
    }
    let _ = now;
  }

  /// The bubble show/hide decision (windows.ts `refreshBubble`).
  pub fn refresh_bubble(&mut self, app: &AppHandle, settings: &Settings, inputs: &BubbleInputs, now: u64) {
    let surface = resolve_bubble_surface(inputs);
    let pet_alive = Self::pet_window(app).is_some();
    let active = inputs.status.active_reminder.as_ref();
    let reminder_bubble =
      inputs.status.pre_alert.is_some() || active.map(|a| a.mode == "gentle").unwrap_or(false);

    if reminder_bubble {
      if !pet_alive {
        self.destroy_bubble(app);
        return;
      }
      self.ensure_bubble(app, inputs, surface, now);
      return;
    }

    if active.is_some() || !pet_alive {
      self.destroy_bubble(app);
      return;
    }

    if inputs.pomodoro_phase != "idle" {
      self.ensure_bubble(app, inputs, surface, now);
      return;
    }
    if inputs.hydration_prompt.as_ref().map(|p| p.phase == "strip").unwrap_or(false) {
      self.ensure_bubble(app, inputs, surface, now);
      return;
    }
    if !settings.todo_bubble_enabled {
      self.destroy_bubble(app);
      return;
    }

    let selected = select_pet_tasks(settings, &inputs.tasks, &inputs.projects);
    let pending = selected.len();
    if pending > 0 {
      self.previous_selected_pending = selected.iter().map(|task| task.id.clone()).collect();
      self.ensure_bubble(app, inputs, surface, now);
      return;
    }

    let just_completed = !self.previous_selected_pending.is_empty()
      && pending == 0
      && self.previous_selected_pending.iter().all(|id| {
        settings.todo_bubble_task_ids.contains(id)
          && inputs.tasks.iter().any(|task| &task.id == id && task.status == "done")
      });
    self.previous_selected_pending = selected.iter().map(|task| task.id.clone()).collect();

    if settings.todo_bubble_task_ids.is_empty() || (!just_completed && self.all_done_until.is_none()) {
      self.destroy_bubble(app);
      return;
    }

    // No pending items: flash "all done" briefly, then destroy.
    match self.all_done_until {
      None => {
        if app.get_webview_window(BUBBLE_LABEL).is_some() {
          self.all_done_until = Some(now + ALL_DONE_DISPLAY_MS);
          return;
        }
        self.destroy_bubble(app);
      }
      Some(until) => {
        if now >= until {
          self.destroy_bubble(app);
        }
      }
    }
  }

  // ── Alert + dim masks ─────────────────────────────────────────────────────

  pub fn destroy_alert_window(&self, app: &AppHandle) {
    if let Some(window) = app.get_webview_window(ALERT_LABEL) {
      let _ = window.destroy();
    }
  }

  fn alert_bounds(&self, app: &AppHandle, settings: &Settings) -> (f64, f64, f64, f64) {
    let display = active_display(app, self.pet_bounds(app));
    get_alert_bounds(display.work_area_logical(), settings.rest_reading_scale)
  }

  pub fn position_alert_window(&self, app: &AppHandle, settings: &Settings) {
    if let Some(window) = app.get_webview_window(ALERT_LABEL) {
      let display = active_display(app, self.pet_bounds(app));
      set_logical_bounds(&window, &display, self.alert_bounds(app, settings));
    }
  }

  /// Present the focused rest on the alert surface. Dim masks are created
  /// FIRST so the alert card lands above them.
  pub fn ensure_alert_window(&self, app: &AppHandle, settings: &Settings, active_id: &str) -> bool {
    if app.get_webview_window(ALERT_LABEL).is_none() {
      let display = active_display(app, self.pet_bounds(app));
      let bounds = self.alert_bounds(app, settings);
      let builder = WebviewWindowBuilder::new(app, ALERT_LABEL, view_url("alert"))
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .skip_taskbar(true)
        .shadow(false)
        .always_on_top(true)
        .visible(false)
        .title("EyeProtect");
      match builder.build() {
        Ok(window) => {
          set_logical_bounds(&window, &display, bounds);
          let _ = window.show();
          let _ = window.set_focus();
        }
        Err(error) => {
          eprintln!("[windows] alert window creation failed: {}", error);
          return false;
        }
      }
    } else {
      self.position_alert_window(app, settings);
    }
    let _ = active_id;
    app.get_webview_window(ALERT_LABEL).map(|w| w.is_visible().unwrap_or(false)).unwrap_or(false)
  }

  pub fn update_dim_windows(&mut self, app: &AppHandle, want: bool) {
    if !want {
      for label in self.dim_labels.drain(..) {
        if let Some(window) = app.get_webview_window(&label) {
          let _ = window.destroy();
        }
      }
      return;
    }
    if !self.dim_labels.is_empty() {
      return;
    }
    for (index, display) in list_displays(app).into_iter().enumerate() {
      let label = format!("dim-{}", index);
      let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("dim.html".into()))
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .skip_taskbar(true)
        .shadow(false)
        .always_on_top(true)
        .focusable(false)
        .visible(false)
        .title("EyeProtect");
      match builder.build() {
        Ok(window) => {
          let _ = window.set_position(PhysicalPosition::new(display.bounds.0, display.bounds.1));
          let _ = window.set_size(PhysicalSize::new(display.bounds.2, display.bounds.3));
          let _ = window.show();
          self.dim_labels.push(label);
        }
        Err(error) => eprintln!("[windows] dim mask creation failed: {}", error),
      }
    }
  }

  /// Reminder lifecycle for windows (windows.ts `applyReminderStatus`).
  /// Returns the id of a NEWLY presented reminder so the caller can start the
  /// rest clock (`beginHealthRest`).
  pub fn apply_reminder_status(
    &mut self,
    app: &AppHandle,
    settings: &Settings,
    inputs: &BubbleInputs,
    now: u64,
  ) -> Option<String> {
    let active = inputs.status.active_reminder.clone();
    let mut newly_presented = None;
    if let Some(active) = &active {
      let gentle = active.mode == "gentle";
      if gentle {
        if let Some(window) = Self::pet_window(app) {
          let _ = window.show();
        }
        self.destroy_alert_window(app);
        self.update_dim_windows(app, false);
        self.refresh_bubble(app, settings, inputs, now);
        return None;
      }
      // Focused/guided: the pet yields, the alert surface takes over.
      if let Some(window) = Self::pet_window(app) {
        let _ = window.hide();
      }
      self.destroy_bubble(app);
      // Only the immersive (focused) mode dims the desktop.
      self.update_dim_windows(app, active.mode == "focused");
      if self.presented_reminder_id.as_deref() != Some(active.id.as_str()) {
        self.presented_reminder_id = Some(active.id.clone());
        if self.ensure_alert_window(app, settings, &active.id) {
          newly_presented = Some(active.id.clone());
        }
      } else {
        self.position_alert_window(app, settings);
      }
      return newly_presented;
    }

    self.presented_reminder_id = None;
    self.destroy_alert_window(app);
    self.update_dim_windows(app, false);

    if let Some(window) = Self::pet_window(app) {
      if let Some(bounds) = window_bounds_physical(&window) {
        let display = display_at_point(app, (bounds.0, bounds.1))
          .unwrap_or_else(|| active_display(app, None));
        let layout_key = display_layout_key(app);
        let restore = self.initial_pet_bounds(settings, &layout_key, &display);
        set_logical_bounds(&window, &display, restore);
      }
      let _ = window.set_always_on_top(true);
      if !self.pet_temporarily_hidden || inputs.status.pre_alert.is_some() {
        let _ = window.show();
      } else {
        let _ = window.hide();
      }
    }
    if !self.pet_temporarily_hidden || inputs.status.pre_alert.is_some() {
      self.refresh_bubble(app, settings, inputs, now);
    } else {
      self.destroy_bubble(app);
    }
    newly_presented
  }
}
