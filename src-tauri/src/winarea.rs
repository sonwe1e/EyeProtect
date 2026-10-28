//! Per-monitor work areas and the cursor position via a minimal Win32 FFI
//! (Electron exposed these through `screen`; Tauri only reports full bounds).

use tauri::AppHandle;

#[derive(Debug, Clone)]
pub struct DisplayInfo {
  pub key: String,
  /// (x, y, width, height) in physical pixels.
  pub bounds: (i32, i32, u32, u32),
  /// Physical work area (excludes the taskbar).
  pub work_area: (i32, i32, u32, u32),
  pub scale: f64,
}

impl DisplayInfo {
  /// Work area in logical (DIP) coordinates.
  pub fn work_area_logical(&self) -> (f64, f64, f64, f64) {
    let s = self.scale;
    (
      self.work_area.0 as f64 / s,
      self.work_area.1 as f64 / s,
      self.work_area.2 as f64 / s,
      self.work_area.3 as f64 / s,
    )
  }
}

#[cfg(windows)]
mod imp {
  use std::os::raw::c_int;

  #[repr(C)]
  struct Point {
    x: i32,
    y: i32,
  }

  #[repr(C)]
  struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
  }

  #[repr(C)]
  struct MonitorInfo {
    cb_size: u32,
    rc_monitor: Rect,
    rc_work: Rect,
    flags: u32,
  }

  const MONITOR_DEFAULTTONEAREST: u32 = 2;

  #[link(name = "user32")]
  extern "system" {
    fn MonitorFromPoint(pt: Point, flags: u32) -> *mut core::ffi::c_void;
    fn MonitorFromWindow(window: isize, flags: u32) -> *mut core::ffi::c_void;
    fn GetMonitorInfoW(hmonitor: *mut core::ffi::c_void, info: *mut MonitorInfo) -> c_int;
    fn GetWindowRect(window: isize, rect: *mut Rect) -> c_int;
    fn GetCursorPos(point: *mut Point) -> c_int;
  }

  fn rect_to_tuple(rect: Rect) -> (i32, i32, u32, u32) {
    (rect.left, rect.top, (rect.right - rect.left).max(0) as u32, (rect.bottom - rect.top).max(0) as u32)
  }

  /// True when the window's rect covers the entire monitor it is on — the
  /// fullscreen-DND signal (shared with the scene sampler in wincontext).
  pub fn window_covers_monitor(window: isize) -> bool {
    unsafe {
      if window == 0 {
        return false;
      }
      let mut rect = Rect { left: 0, top: 0, right: 0, bottom: 0 };
      if GetWindowRect(window, &mut rect) == 0 {
        return false;
      }
      let monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
      if monitor.is_null() {
        return false;
      }
      let mut info = MonitorInfo {
        cb_size: std::mem::size_of::<MonitorInfo>() as u32,
        rc_monitor: Rect { left: 0, top: 0, right: 0, bottom: 0 },
        rc_work: Rect { left: 0, top: 0, right: 0, bottom: 0 },
        flags: 0,
      };
      if GetMonitorInfoW(monitor, &mut info) == 0 {
        return false;
      }
      let m = info.rc_monitor;
      rect.left <= m.left && rect.top <= m.top && rect.right >= m.right && rect.bottom >= m.bottom
    }
  }

  /// Work area of the monitor whose rect matches `bounds`, if identifiable.
  pub fn work_area_of_monitor(bounds: (i32, i32, u32, u32)) -> Option<(i32, i32, u32, u32)> {
    let cx = bounds.0 + bounds.2 as i32 / 2;
    let cy = bounds.1 + bounds.3 as i32 / 2;
    let monitor = unsafe { MonitorFromPoint(Point { x: cx, y: cy }, MONITOR_DEFAULTTONEAREST) };
    if monitor.is_null() {
      return None;
    }
    let mut info = MonitorInfo { cb_size: std::mem::size_of::<MonitorInfo>() as u32, rc_monitor: Rect { left: 0, top: 0, right: 0, bottom: 0 }, rc_work: Rect { left: 0, top: 0, right: 0, bottom: 0 }, flags: 0 };
    let ok = unsafe { GetMonitorInfoW(monitor, &mut info) };
    if ok == 0 {
      return None;
    }
    if rect_to_tuple(info.rc_monitor) != bounds {
      // Nearest monitor is not the one we asked about; trust the caller's rect.
      return None;
    }
    Some(rect_to_tuple(info.rc_work))
  }

  pub fn cursor_physical() -> Option<(i32, i32)> {
    let mut point = Point { x: 0, y: 0 };
    let ok = unsafe { GetCursorPos(&mut point) };
    if ok == 0 { None } else { Some((point.x, point.y)) }
  }
}

#[cfg(not(windows))]
mod imp {
  pub fn work_area_of_monitor(_bounds: (i32, i32, u32, u32)) -> Option<(i32, i32, u32, u32)> {
    None
  }
  pub fn cursor_physical() -> Option<(i32, i32)> {
    None
  }
  pub fn window_covers_monitor(_window: isize) -> bool {
    false
  }
}

/// Fullscreen check shared with the scene sampler (wincontext).
pub fn window_covers_monitor(window: isize) -> bool {
  imp::window_covers_monitor(window)
}

/// All monitors with their work areas and a stable topology key.
pub fn list_displays(app: &AppHandle) -> Vec<DisplayInfo> {
  let mut displays: Vec<DisplayInfo> = Vec::new();
  if let Ok(monitors) = app.available_monitors() {
    for monitor in monitors {
      let position = monitor.position();
      let size = monitor.size();
      let bounds = (position.x, position.y, size.width, size.height);
      let work_area = imp::work_area_of_monitor(bounds).unwrap_or(bounds);
      displays.push(DisplayInfo {
        key: format!(
          "{},{},{},{},{},0",
          bounds.0, bounds.1, bounds.2, bounds.3, monitor.scale_factor()
        ),
        bounds,
        work_area,
        scale: monitor.scale_factor(),
      });
    }
  }
  displays
}

/// Stable layout key independent of monitor ordering (displayLayout.ts).
pub fn display_layout_key(app: &AppHandle) -> String {
  let mut keys: Vec<String> = list_displays(app).into_iter().map(|display| display.key).collect();
  keys.sort();
  keys.join("|")
}

fn distance_to_display(point: (i32, i32), display: &DisplayInfo) -> f64 {
  let (px, py) = point;
  let (x, y, w, h) = display.bounds;
  let cx = x + w as i32 / 2;
  let cy = y + h as i32 / 2;
  let dx = (px - cx) as f64;
  let dy = (py - cy) as f64;
    (dx * dx + dy * dy).sqrt()
}

/// The display nearest a physical point (used for cursor and saved positions).
pub fn display_at_point(app: &AppHandle, point: (i32, i32)) -> Option<DisplayInfo> {
  let displays = list_displays(app);
  // Containing display first.
  if let Some(hit) = displays.iter().find(|display| {
    let (x, y, w, h) = display.bounds;
    point.0 >= x && point.0 < x + w as i32 && point.1 >= y && point.1 < y + h as i32
  }) {
    return Some(hit.clone());
  }
  displays
    .into_iter()
    .min_by(|a, b| distance_to_display(point, a).total_cmp(&distance_to_display(point, b)))
}

pub fn primary_display(app: &AppHandle) -> Option<DisplayInfo> {
  list_displays(app)
    .into_iter()
    .min_by(|a, b| distance_to_display((0, 0), a).total_cmp(&distance_to_display((0, 0), b)))
}

/// Cursor position in physical pixels (FFI first; Tauri fallback).
pub fn cursor_physical(app: &AppHandle) -> Option<(i32, i32)> {
  if let Some(point) = imp::cursor_physical() {
    return Some(point);
  }
  if let Ok(position) = app.cursor_position() {
    return Some((position.x as i32, position.y as i32));
  }
  None
}

/// The display hosting user attention: cursor → pet → primary.
pub fn active_display(app: &AppHandle, pet_bounds: Option<(i32, i32, u32, u32)>) -> DisplayInfo {
  if let Some(cursor) = cursor_physical(app) {
    if let Some(display) = display_at_point(app, cursor) {
      return display;
    }
  }
  if let Some(bounds) = pet_bounds {
    let center = (bounds.0 + bounds.2 as i32 / 2, bounds.1 + bounds.3 as i32 / 2);
    if let Some(display) = display_at_point(app, center) {
      return display;
    }
  }
  primary_display(app).unwrap_or(DisplayInfo {
    key: "0,0,1920,1080,1,0".into(),
    bounds: (0, 0, 1920, 1080),
    work_area: (0, 0, 1920, 1080),
    scale: 1.0,
  })
}

// ── Bounds math (windowBounds.ts port, logical coordinates) ──────────────────

pub fn clamp(value: f64, min: f64, max: f64) -> f64 {
  value.min(max).max(min)
}

/// Pet drag clamping inside the work area, logical units.
pub fn get_pet_move_bounds(
  position: (f64, f64),
  work_area: (f64, f64, f64, f64),
  size: (f64, f64),
) -> (f64, f64) {
  let max_x = (work_area.0 + work_area.2 - size.0).max(work_area.0);
  let max_y = (work_area.1 + work_area.3 - size.1).max(work_area.1);
  (
    clamp(position.0, work_area.0, max_x).round(),
    clamp(position.1, work_area.1, max_y).round(),
  )
}

pub struct BubbleLayout {
  pub bounds: (f64, f64, f64, f64),
  pub placement: &'static str,
  pub tail_x: f64,
}

/// Where the bubble window sits relative to the pet artwork, logical units.
pub fn get_pet_bubble_layout(
  pet: (f64, f64, f64, f64),
  work_area: (f64, f64, f64, f64),
  size: (f64, f64),
  artwork: (f64, f64),
) -> BubbleLayout {
  let width = size.0.min(work_area.2);
  let height = size.1.min(work_area.3);
  let center = pet.0 + pet.2 / 2.0;
  let head = pet.1 + pet.3 * artwork.0;
  let feet = pet.1 + pet.3 * artwork.1;
  let placement: &'static str = if head - height >= work_area.1 { "above" } else { "below" };
  let x = clamp(center - width / 2.0, work_area.0, work_area.0 + work_area.2 - width).round();
  let y = clamp(
    if placement == "above" { head - height } else { feet },
    work_area.1,
    work_area.1 + work_area.3 - height,
  )
  .round();
  let tail_x = clamp(center - x - 6.0, 18.0, width - 30.0);
  BubbleLayout { bounds: (x, y, width, height), placement, tail_x }
}

const ALERT_EDGE_GAP_RATIO: f64 = 0.05;
const ALERT_EDGE_GAP_MIN: f64 = 16.0;
const ALERT_EDGE_GAP_MAX: f64 = 64.0;

/// Alert card bounds centered on the work area, logical units.
pub fn get_alert_bounds(work_area: (f64, f64, f64, f64), reading_scale: f64) -> (f64, f64, f64, f64) {
  let by_screen = work_area.2.min(work_area.3) * ALERT_EDGE_GAP_RATIO;
  let max_for_area = ((work_area.2.min(work_area.3) - 1.0) / 2.0).floor().max(0.0);
  let margin = clamp(by_screen, ALERT_EDGE_GAP_MIN, ALERT_EDGE_GAP_MAX).min(max_for_area);
  let available_width = (work_area.2 - margin * 2.0).max(1.0);
  let available_height = (work_area.3 - margin * 2.0).max(1.0);
  let width = available_width.min(clamp(work_area.2 * 0.66, 900.0, 1440.0) * reading_scale).round();
  let height = available_height.min(clamp(work_area.3 * 0.76, 620.0, 960.0) * reading_scale).round();
  (
    work_area.0 + ((work_area.2 - width) / 2.0).round(),
    work_area.1 + ((work_area.3 - height) / 2.0).round(),
    width,
    height,
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn bubble_prefers_above_and_clamps_tail() {
    let layout = get_pet_bubble_layout(
      (100.0, 300.0, 200.0, 200.0),
      (0.0, 0.0, 1920.0, 1080.0),
      (260.0, 180.0),
      (8.0 / 64.0, 60.0 / 64.0),
    );
    assert_eq!(layout.placement, "above");
    assert!(layout.tail_x >= 18.0);
    // Not enough room above → below the feet.
    let layout = get_pet_bubble_layout(
      (100.0, 20.0, 200.0, 200.0),
      (0.0, 0.0, 1920.0, 1080.0),
      (260.0, 180.0),
      (8.0 / 64.0, 60.0 / 64.0),
    );
    assert_eq!(layout.placement, "below");
  }

  #[test]
  fn alert_bounds_center_and_scale() {
    let bounds = get_alert_bounds((0.0, 0.0, 1920.0, 1080.0), 1.0);
    assert!(bounds.2 >= 900.0 && bounds.2 <= 1440.0);
    let scaled = get_alert_bounds((0.0, 0.0, 1920.0, 1080.0), 1.25);
    assert!(scaled.2 > bounds.2);
  }
}
