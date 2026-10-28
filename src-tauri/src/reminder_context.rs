//! Scene gate for real reminders — port of `src/main/reminderContext.ts`.
//!
//! Contract mirrors the Electron gate: real due reminders ask this module
//! before showing; manual ("立即休息") and settings-test reminders bypass it.
//! A defer reschedules the involved kinds and surfaces a context deferral in
//! `ReminderStatus`; pre-alerts and hydration moments are suppressed while a
//! deferral is active. All context defers keep re-checking (waitForContext).

use crate::types::Settings;
use crate::wincontext::SceneSample;
use chrono::{Local, TimeZone, Timelike};

const MEETING_APPS: [&str; 9] = [
  "zoom", "teams", "ms-teams", "wemeetapp", "voovmeeting", "tencentmeeting",
  "webex", "webexhost", "ciscowebexstart",
];

#[derive(Debug, Clone, PartialEq)]
pub enum ContextDecision {
  Show,
  Defer { seconds: u64, reason: String, foreground_app: Option<String> },
}

fn defer(seconds: u64, reason: &str, foreground_app: Option<String>) -> ContextDecision {
  ContextDecision::Defer { seconds, reason: reason.into(), foreground_app }
}

/// Minutes since local midnight (wall clock), 0–1439.
pub fn minutes_of_local_day(timestamp: u64) -> u64 {
  match Local.timestamp_millis_opt(timestamp as i64).single() {
    Some(local) => (local.hour() as u64) * 60 + local.minute() as u64,
    None => 0,
  }
}

/// True when `now` is inside the quiet window `[start, end)`; a window that
/// crosses midnight wraps (`start > end`). An empty window never defers.
pub fn in_quiet_window(now: u64, start_minutes: u64, end_minutes: u64) -> bool {
  if start_minutes == end_minutes {
    return false;
  }
  let minute = minutes_of_local_day(now);
  if start_minutes < end_minutes {
    minute >= start_minutes && minute < end_minutes
  } else {
    minute >= start_minutes || minute < end_minutes
  }
}

/// Full gate decision (port of `contextDecision`): quiet hours first, then
/// fullscreen DND, then foreground detection (devices / meeting apps /
/// whitelist / typing). A missing sample only leaves the quiet-hours slice.
pub fn decision_with_sample(
  settings: &Settings,
  sample: Option<&SceneSample>,
  typing: bool,
  now: u64,
) -> ContextDecision {
  if settings.quiet_hours_enabled
    && in_quiet_window(now, settings.quiet_hours_start_minutes, settings.quiet_hours_end_minutes)
  {
    return defer(30, "当前处于定时免打扰时段", sample.and_then(|s| s.foreground_app.clone()));
  }
  let Some(sample) = sample else { return ContextDecision::Show };
  if settings.fullscreen_dnd_enabled && sample.fullscreen {
    return defer(10, "全屏应用使用中，退出全屏后再提醒", sample.foreground_app.clone());
  }
  if !settings.foreground_detection_enabled {
    return ContextDecision::Show;
  }
  if sample.camera || sample.microphone {
    return defer(10, "摄像头或麦克风使用中，结束后再提醒", sample.foreground_app.clone());
  }
  if let Some(foreground) = &sample.foreground_app {
    if MEETING_APPS.contains(&foreground.as_str())
      || settings.quiet_app_whitelist.iter().any(|entry| entry == foreground)
    {
      return defer(10, "会议或免打扰应用在前台，切换后再提醒", sample.foreground_app.clone());
    }
  }
  if typing {
    return defer(2, "正在连续输入，停顿片刻后再提醒", sample.foreground_app.clone());
  }
  ContextDecision::Show
}

/// Gate without a scene sample (quiet-hours-only slice).
pub fn decision(settings: &Settings, now: u64) -> ContextDecision {
  decision_with_sample(settings, None, false, now)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn at(hour: u64, minute: u64) -> u64 {
    let today = Local::now().date_naive();
    today
      .and_hms_opt(hour as u32, minute as u32, 0)
      .map(|t| Local.from_local_datetime(&t).single().unwrap().timestamp_millis() as u64)
      .unwrap_or(0)
  }

  fn settings(start: u64, end: u64) -> Settings {
    Settings {
      quiet_hours_enabled: true,
      quiet_hours_start_minutes: start,
      quiet_hours_end_minutes: end,
      ..Settings::default()
    }
  }

  #[test]
  fn same_day_window() {
    let config = settings(12 * 60, 14 * 60);
    assert_eq!(
      decision(&config, at(13, 0)),
      defer(30, "当前处于定时免打扰时段", None)
    );
    assert_eq!(decision(&config, at(15, 0)), ContextDecision::Show);
    // The boundary start is inside, the boundary end is outside.
    assert!(matches!(decision(&config, at(12, 0)), ContextDecision::Defer { .. }));
    assert_eq!(decision(&config, at(14, 0)), ContextDecision::Show);
  }

  #[test]
  fn window_wraps_midnight() {
    let config = settings(22 * 60, 8 * 60);
    assert!(matches!(decision(&config, at(23, 30)), ContextDecision::Defer { .. }));
    assert!(matches!(decision(&config, at(6, 59)), ContextDecision::Defer { .. }));
    assert_eq!(decision(&config, at(12, 0)), ContextDecision::Show);
  }

  #[test]
  fn disabled_or_empty_window_shows() {
    let mut config = settings(0, 24 * 60 - 1);
    assert!(matches!(decision(&config, at(3, 0)), ContextDecision::Defer { .. }));
    config.quiet_hours_enabled = false;
    assert_eq!(decision(&config, at(3, 0)), ContextDecision::Show);
    let degenerate = settings(9 * 60, 9 * 60);
    assert_eq!(decision(&degenerate, at(9, 0)), ContextDecision::Show);
  }

  fn sample() -> SceneSample {
    SceneSample {
      foreground_app: Some("zoom".into()),
      fullscreen: false,
      microphone: false,
      camera: false,
    }
  }

  #[test]
  fn quiet_hours_outranks_the_scene() {
    let mut config = settings(0, 24 * 60);
    config.fullscreen_dnd_enabled = true;
    let scene = SceneSample { fullscreen: true, ..sample() };
    assert_eq!(
      decision_with_sample(&config, Some(&scene), true, at(3, 0)),
      defer(30, "当前处于定时免打扰时段", Some("zoom".into()))
    );
  }

  #[test]
  fn fullscreen_dnd_defers_without_foreground_detection() {
    let mut config = Settings::default();
    config.fullscreen_dnd_enabled = true;
    config.foreground_detection_enabled = false;
    let scene = SceneSample { foreground_app: Some("game".into()), fullscreen: true, ..Default::default() };
    assert_eq!(
      decision_with_sample(&config, Some(&scene), false, at(10, 0)),
      defer(10, "全屏应用使用中，退出全屏后再提醒", Some("game".into()))
    );
  }

  #[test]
  fn meeting_app_and_whitelist_defer() {
    let mut config = Settings::default();
    config.foreground_detection_enabled = true;
    assert_eq!(
      decision_with_sample(&config, Some(&sample()), false, at(10, 0)),
      defer(10, "会议或免打扰应用在前台，切换后再提醒", Some("zoom".into()))
    );
    config.quiet_app_whitelist.push("myfocusapp".into());
    let scene = SceneSample { foreground_app: Some("myfocusapp".into()), ..Default::default() };
    assert_eq!(
      decision_with_sample(&config, Some(&scene), false, at(10, 0)),
      defer(10, "会议或免打扰应用在前台，切换后再提醒", Some("myfocusapp".into()))
    );
  }

  #[test]
  fn devices_and_typing_defer() {
    let mut config = Settings::default();
    config.foreground_detection_enabled = true;
    let scene = SceneSample { foreground_app: Some("obs".into()), microphone: true, ..Default::default() };
    assert_eq!(
      decision_with_sample(&config, Some(&scene), false, at(10, 0)),
      defer(10, "摄像头或麦克风使用中，结束后再提醒", Some("obs".into()))
    );
    let scene = SceneSample::default();
    assert_eq!(
      decision_with_sample(&config, Some(&scene), true, at(10, 0)),
      defer(2, "正在连续输入，停顿片刻后再提醒", None)
    );
    // Detection off + nothing special → show even while typing.
    config.foreground_detection_enabled = false;
    assert_eq!(decision_with_sample(&config, Some(&scene), true, at(10, 0)), ContextDecision::Show);
  }
}
