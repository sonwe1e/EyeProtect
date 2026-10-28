//! Windows scene sampling — in-process port of the Electron PowerShell helper
//! (`src/main/reminderContext.ts` WINDOWS_CONTEXT_SCRIPT).
//!
//! One hidden thread samples key-down state at 40 ms (aggregate counts only;
//! key identities and text never leave this module), and reads window/device
//! state every 2 s. No hooks, no window titles, no recording content. The
//! ConsentStore is a best-effort signal; unavailable keys mean "not in use"
//! and the scheduler keeps its usual behaviour.

use crate::types::Settings;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Freshness window for a scene sample (Electron `SAMPLE_MAX_AGE_MS`).
const SAMPLE_MAX_AGE: Duration = Duration::from_secs(5);
/// Typing = at least 6 key transitions within 5 s (Electron thresholds).
const TYPING_WINDOW: Duration = Duration::from_secs(5);
const TYPING_KEY_THRESHOLD: u32 = 6;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SceneSample {
  pub foreground_app: Option<String>,
  pub fullscreen: bool,
  pub microphone: bool,
  pub camera: bool,
}

#[derive(Default)]
struct Shared {
  sample: Mutex<Option<(Instant, SceneSample)>>,
  key_counts: Mutex<Vec<(Instant, u32)>>,
}

pub struct ContextMonitor {
  shared: Arc<Shared>,
  stop: Arc<AtomicBool>,
  /// Whether mic/camera are sampled too (foreground detection enabled).
  smart: Arc<AtomicBool>,
  handle: Option<std::thread::JoinHandle<()>>,
}

impl Default for ContextMonitor {
  fn default() -> Self {
    ContextMonitor {
      shared: Arc::new(Shared::default()),
      stop: Arc::new(AtomicBool::new(false)),
      smart: Arc::new(AtomicBool::new(false)),
      handle: None,
    }
  }
}

impl ContextMonitor {
  /// Idempotent lifecycle control: the thread runs while `enabled`, with
  /// `smart` deciding whether device state is sampled. Like the Electron
  /// monitor, smoke runs and non-Windows platforms never sample.
  pub fn configure(&mut self, smart: bool, enabled: bool) {
    let allowed = cfg!(windows)
      && std::env::var("EYEPROTECT_SMOKE").ok().as_deref() != Some("1");
    self.smart.store(smart, Ordering::Relaxed);
    let should_run = allowed && enabled;
    if should_run {
      if self.handle.is_none() {
        self.stop.store(false, Ordering::Relaxed);
        let shared = Arc::clone(&self.shared);
        let stop = Arc::clone(&self.stop);
        let smart = Arc::clone(&self.smart);
        if let Some(handle) = std::thread::Builder::new()
          .name("eyeprotect-context".into())
          .spawn(move || sampler_loop(shared, stop, smart))
          .ok()
        {
          self.handle = Some(handle);
        }
      }
    } else {
      self.shutdown();
    }
  }

  pub fn configure_from_settings(&mut self, settings: &Settings) {
    self.configure(
      settings.foreground_detection_enabled,
      settings.foreground_detection_enabled || settings.fullscreen_dnd_enabled,
    );
  }

  /// Latest sample if it is still fresh enough for a gate decision.
  pub fn snapshot(&self) -> Option<SceneSample> {
    let guard = self.shared.sample.lock().ok()?;
    let (at, sample) = guard.as_ref()?;
    if at.elapsed() <= SAMPLE_MAX_AGE {
      Some(sample.clone())
    } else {
      None
    }
  }

  /// True while the user is in a burst of typing (aggregate counts only).
  pub fn typing(&self) -> bool {
    let Ok(counts) = self.shared.key_counts.lock() else { return false };
    let now = Instant::now();
    counts
      .iter()
      .filter(|(at, _)| now.duration_since(*at) <= TYPING_WINDOW)
      .map(|(_, count)| *count)
      .sum::<u32>()
      >= TYPING_KEY_THRESHOLD
  }

  fn shutdown(&mut self) {
    self.stop.store(true, Ordering::Relaxed);
    if let Some(handle) = self.handle.take() {
      let _ = handle.join();
    }
    if let Ok(mut sample) = self.shared.sample.lock() {
      *sample = None;
    }
    if let Ok(mut counts) = self.shared.key_counts.lock() {
      counts.clear();
    }
  }
}

impl Drop for ContextMonitor {
  fn drop(&mut self) {
    self.shutdown();
  }
}

fn sampler_loop(shared: Arc<Shared>, stop: Arc<AtomicBool>, smart: Arc<AtomicBool>) {
  let mut down = [false; 256];
  let mut count: u32 = 0;
  let mut last_key = Instant::now();
  let mut last_report = Instant::now();
  let mut last_scene = Instant::now() - Duration::from_secs(2);
  let mut scene = SceneSample::default();
  loop {
    if stop.load(Ordering::Relaxed) {
      return;
    }
    count += keys_pressed(&mut down) as u32;
    if count > 0 {
      last_key = Instant::now();
    }
    let _ = last_key;
    if last_scene.elapsed() >= Duration::from_secs(2) {
      scene = sample_scene(smart.load(Ordering::Relaxed));
      last_scene = Instant::now();
    }
    if last_report.elapsed() >= Duration::from_secs(1) {
      if let Ok(mut counts) = shared.key_counts.lock() {
        counts.retain(|(at, _)| at.elapsed() <= TYPING_WINDOW);
        counts.push((Instant::now(), count));
      }
      count = 0;
      last_report = Instant::now();
      if let Ok(mut sample) = shared.sample.lock() {
        *sample = Some((Instant::now(), scene.clone()));
      }
    }
    std::thread::sleep(Duration::from_millis(40));
  }
}

// ── Win32 FFI ────────────────────────────────────────────────────────────────

#[cfg(windows)]
mod imp {
  use std::os::raw::{c_int, c_ulong};

  const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

  #[link(name = "user32")]
  extern "system" {
    fn GetForegroundWindow() -> isize;
    fn GetWindowThreadProcessId(window: isize, process_id: *mut u32) -> c_ulong;
    fn GetAsyncKeyState(key: c_int) -> i16;
  }

  #[link(name = "kernel32")]
  extern "system" {
    fn OpenProcess(access: u32, inherit: c_int, process_id: u32) -> isize;
    fn QueryFullProcessImageNameW(
      process: isize,
      flags: u32,
      name: *mut u16,
      size: *mut u32,
    ) -> c_int;
    fn CloseHandle(handle: isize) -> c_int;
    fn GetTickCount64() -> u64;
  }

  #[link(name = "advapi32")]
  extern "system" {
    fn RegOpenKeyExW(parent: isize, subkey: *const u16, options: u32, access: u32, result: *mut isize) -> c_int;
    fn RegCloseKey(key: isize) -> c_int;
    fn RegQueryValueExW(
      key: isize,
      name: *const u16,
      reserved: *mut u32,
      kind: *mut u32,
      data: *mut u8,
      size: *mut u32,
    ) -> c_int;
    fn RegEnumKeyExW(
      key: isize,
      index: u32,
      name: *mut u16,
      name_size: *mut u32,
      reserved: *mut u32,
      class: *mut u16,
      class_size: *mut u32,
      last_write: *mut u64,
    ) -> c_int;
  }

  const HKEY_CURRENT_USER: isize = 0x8000_0001u32 as isize;
  const KEY_READ: u32 = 0x2001_9;
  const REG_QWORD: u32 = 11;

  /// Aggregate text-key down-transitions since the previous call. Same key
  /// set as the Electron helper: modifiers/functions/navigation excluded.
  pub fn keys_pressed(down: &mut [bool; 256]) -> usize {
    let mut count = 0;
    for key in 8..255usize {
      let pressed = unsafe { GetAsyncKeyState(key as c_int) } < 0;
      let text = key == 8
        || key == 13
        || key == 32
        || (48..=90).contains(&key)
        || (96..=111).contains(&key)
        || (186..=226).contains(&key);
      if text && pressed && !down[key] {
        count += 1;
      }
      down[key] = pressed;
    }
    count
  }

  fn process_name(process_id: u32) -> Option<String> {
    unsafe {
      let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
      if process == 0 {
        return None;
      }
      let mut buffer = [0u16; 512];
      let mut size = buffer.len() as u32;
      let ok = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut size);
      CloseHandle(process);
      if ok == 0 {
        return None;
      }
      let full = String::from_utf16_lossy(&buffer[..size as usize]);
      let base = full.rsplit(['\\', '/']).next().unwrap_or(&full);
      Some(base.trim_end_matches(".exe").to_lowercase())
    }
  }

  /// Foreground process name + whether its window covers the whole monitor
  /// (fullscreen detection lives in winarea's shared FFI).
  pub fn foreground() -> (Option<String>, bool) {
    unsafe {
      let window = GetForegroundWindow();
      if window == 0 {
        return (None, false);
      }
      let mut process_id = 0u32;
      GetWindowThreadProcessId(window, &mut process_id);
      let name = process_name(process_id).unwrap_or_default();
      let excluded = name == "explorer" || name == "shellexperiencehost";
      let fullscreen = !excluded && crate::winarea::window_covers_monitor(window);
      (if name.is_empty() { None } else { Some(name) }, fullscreen)
    }
  }

  fn filetime_to_u64(value: &[u8]) -> Option<u64> {
    if value.len() != 8 {
      return None;
    }
    let mut parts = [0u8; 8];
    parts.copy_from_slice(value);
    Some(u64::from_le_bytes(parts))
  }

  /// 100-ns intervals since 1601-01-01 for "now minus uptime" (boot FILETIME).
  fn boot_filetime() -> u64 {
    let uptime_ms = unsafe { GetTickCount64() };
    let unix_now_ms = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|d| d.as_millis() as u64)
      .unwrap_or(0);
    let boot_unix_ms = unix_now_ms.saturating_sub(uptime_ms);
    boot_unix_ms * 10_000 + 116_444_736_000_000_000
  }

  fn utf16(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
  }

  fn live_use(key: isize, depth: i32, boot: u64) -> bool {
    unsafe {
      let start_name = utf16("LastUsedTimeStart");
      let stop_name = utf16("LastUsedTimeStop");
      let mut kind = 0u32;
      let mut start = [0u8; 8];
      let mut start_size = 8u32;
      let start_ok = RegQueryValueExW(key, start_name.as_ptr(), std::ptr::null_mut(), &mut kind, start.as_mut_ptr(), &mut start_size);
      let mut stop = [0u8; 8];
      let mut stop_size = 8u32;
      let stop_ok = RegQueryValueExW(key, stop_name.as_ptr(), std::ptr::null_mut(), &mut kind, stop.as_mut_ptr(), &mut stop_size);
      if start_ok == 0 && stop_ok == 0 && kind == REG_QWORD {
        if let (Some(start), Some(stop)) = (filetime_to_u64(&start), filetime_to_u64(&stop)) {
          // Live use: started, never stopped, and not a stale pre-boot entry.
          // (The Electron helper additionally verifies a NonPackaged process
          // is running; this port accepts the registry signal as-is.)
          if start > 0 && stop == 0 && start >= boot {
            return true;
          }
        }
      }
      if depth > 0 {
        let mut index = 0u32;
        loop {
          let mut name = [0u16; 260];
          let mut name_size = name.len() as u32;
          let status = RegEnumKeyExW(
            key,
            index,
            name.as_mut_ptr(),
            &mut name_size,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
          );
          if status != 0 {
            break;
          }
          let mut child = 0isize;
          if RegOpenKeyExW(key, name.as_ptr(), 0, KEY_READ, &mut child) == 0 {
            let live = live_use(child, depth - 1, boot);
            RegCloseKey(child);
            if live {
              return true;
            }
          }
          index += 1;
        }
      }
      false
    }
  }

  /// Best-effort "device currently in use" from the ConsentStore.
  pub fn device(kind: &str) -> bool {
    let root = format!(
      "Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\{}",
      kind
    );
    unsafe {
      let mut key = 0isize;
      let root16 = utf16(&root);
      if RegOpenKeyExW(HKEY_CURRENT_USER, root16.as_ptr(), 0, KEY_READ, &mut key) != 0 {
        return false;
      }
      let live = live_use(key, 2, boot_filetime());
      RegCloseKey(key);
      live
    }
  }
}

#[cfg(windows)]
use imp as platform;

#[cfg(not(windows))]
mod platform {
  pub fn keys_pressed(_down: &mut [bool; 256]) -> usize {
    0
  }
  pub fn foreground() -> (Option<String>, bool) {
    (None, false)
  }
  pub fn device(_kind: &str) -> bool {
    false
  }
}

fn keys_pressed(down: &mut [bool; 256]) -> usize {
  platform::keys_pressed(down)
}

fn sample_scene(smart: bool) -> SceneSample {
  let (foreground_app, fullscreen) = platform::foreground();
  if smart {
    SceneSample {
      foreground_app,
      fullscreen,
      microphone: platform::device("microphone"),
      camera: platform::device("webcam"),
    }
  } else {
    SceneSample { foreground_app, fullscreen, microphone: false, camera: false }
  }
}
