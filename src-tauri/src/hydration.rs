//! Hydration service — port of `src/main/hydration.ts` + `shared/hydration.ts`.
//!
//! The interval is DERIVED from the working window and the daily goal (never
//! stored). A slot fires at most once; every branch consumes it, so quiet
//! surfaces mean "skip", not "queue". The prompt lifecycle (sipping → strip)
//! runs on the backend's own clock via the shared 1 s tick.

use crate::types::{local_date_at_minutes, local_date_key, ms_until_next_local_midnight, HydrationPrompt, HydrationStatus, Settings};
use serde::{Deserialize, Serialize};

pub const HYDRATION_INTERVAL_MIN_MINUTES: u64 = 30;
pub const HYDRATION_INTERVAL_MAX_MINUTES: u64 = 120;
pub const HYDRATION_SIP_MS: u64 = 2_600;
pub const HYDRATION_STRIP_MS: u64 = 8_000;

/// Use the same Windows client-area animation preference as the WebView.
/// Failure falls back to normal motion, matching the Electron scheduler.
#[cfg(windows)]
pub fn system_prefers_reduced_motion() -> bool {
  use std::ffi::c_void;

  const SPI_GETCLIENTAREAANIMATION: u32 = 0x1042;
  #[link(name = "user32")]
  extern "system" {
    fn SystemParametersInfoW(action: u32, param: u32, value: *mut c_void, flags: u32) -> i32;
  }

  let mut animation_enabled: i32 = 1;
  let succeeded = unsafe {
    SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, (&mut animation_enabled as *mut i32).cast(), 0)
  };
  succeeded != 0 && animation_enabled == 0
}

#[cfg(not(windows))]
pub fn system_prefers_reduced_motion() -> bool {
  false
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HydrationDayState {
  pub local_date: String,
  pub cups: u64,
  pub last_cup_at: Option<u64>,
  pub last_prompt_at: Option<u64>,
}

pub fn empty_day(local_date: String) -> HydrationDayState {
  HydrationDayState { local_date, cups: 0, last_cup_at: None, last_prompt_at: None }
}

fn roll_day(day: &mut HydrationDayState, now: u64) -> bool {
  let today = local_date_key(now);
  if day.local_date != today {
    *day = empty_day(today);
    true
  } else {
    false
  }
}

pub fn hydration_interval_minutes(settings: &Settings) -> u64 {
  if settings.hydration_goal_cups < 1 || settings.work_end_minutes <= settings.work_start_minutes {
    return HYDRATION_INTERVAL_MIN_MINUTES;
  }
  let derived = (settings.work_end_minutes - settings.work_start_minutes) / settings.hydration_goal_cups;
  derived.clamp(HYDRATION_INTERVAL_MIN_MINUTES, HYDRATION_INTERVAL_MAX_MINUTES)
}

/// The next grid slot `workStart + k·interval` that is still ahead of both
/// `now` and the consumed marker, and starts inside today's window.
fn next_hydration_slot_at(now: u64, settings: &Settings, last_prompt_at: Option<u64>) -> Option<u64> {
  if settings.work_end_minutes <= settings.work_start_minutes {
    return None;
  }
  let interval = hydration_interval_minutes(settings);
  if interval == 0 {
    return None;
  }
  let floor = last_prompt_at.map_or(now, |at| now.max(at));
  let today = local_date_key(now);
  let slots = (settings.work_end_minutes - settings.work_start_minutes) / interval;
  for k in 1..=slots {
    let at = local_date_at_minutes(now, (settings.work_start_minutes + k * interval) as u32);
    if at <= floor {
      continue;
    }
    // A slot must START inside today's working window.
    if local_date_key(at) != today {
      return None;
    }
    return Some(at);
  }
  None
}

pub struct Hydration {
  pub day: HydrationDayState,
  prompt: Option<HydrationPrompt>,
  /// (deadline, scheduled slot). `slot: None` means "waiting for midnight".
  armed: (u64, Option<u64>),
  sequence: u64,
  /// The pet should play one sip animation (drained by the caller).
  pub pending_sip: bool,
  /// Persisted state changed.
  pub persist_pending: bool,
}

impl Hydration {
  pub fn new(persisted: Option<HydrationDayState>, now: u64) -> Hydration {
    let mut day = persisted.unwrap_or_else(|| empty_day(local_date_key(now)));
    roll_day(&mut day, now);
    Hydration { day, prompt: None, armed: (u64::MAX, None), sequence: 0, pending_sip: false, persist_pending: false }
  }

  pub fn start(&mut self, settings: &Settings, now: u64) -> bool {
    roll_day(&mut self.day, now);
    self.arm(settings, now);
    true
  }

  /// A settings edit re-derives the schedule; OFF also drops a live prompt.
  pub fn on_settings_changed(&mut self, settings: &Settings, now: u64) -> bool {
    roll_day(&mut self.day, now);
    if !settings.hydration_enabled {
      self.armed = (u64::MAX, None);
      if self.prompt.take().is_some() {
        return true;
      }
      return false;
    }
    self.arm(settings, now);
    false
  }

  fn arm(&mut self, settings: &Settings, now: u64) {
    if !settings.hydration_enabled {
      self.armed = (u64::MAX, None);
      return;
    }
    let slot = next_hydration_slot_at(now, settings, self.day.last_prompt_at);
    let at = slot.unwrap_or_else(|| now + ms_until_next_local_midnight(now));
    self.armed = (at.max(now + 1_000), slot);
  }

  pub fn status(&mut self, settings: &Settings, now: u64) -> HydrationStatus {
    roll_day(&mut self.day, now);
    self.status_of(settings)
  }

  /// Snapshot of the live prompt for the bubble/window manager.
  pub fn prompt_snapshot(&self) -> Option<HydrationPrompt> {
    self.prompt.clone()
  }

  fn status_of(&self, settings: &Settings) -> HydrationStatus {
    let goal = settings.hydration_goal_cups;
    HydrationStatus {
      enabled: settings.hydration_enabled,
      goal_cups: goal,
      cups: self.day.cups.min(goal),
      local_date: self.day.local_date.clone(),
      achieved: self.day.cups >= goal,
      prompt: self.prompt.clone(),
    }
  }

  /// Public status read without a clock (day already rolled elsewhere).
  pub fn status_of_pub(&self, settings: &Settings) -> HydrationStatus {
    self.status_of(settings)
  }

  fn consume_slot(&mut self, slot_at: u64) {
    let marker = self.day.last_prompt_at.map_or(slot_at, |at| at.max(slot_at));
    self.day.last_prompt_at = Some(marker);
    self.persist_pending = true;
  }

  /// Advance prompt phases and slot deadlines. Returns Some(status) when the
  /// renderer state changed.
  pub fn tick(
    &mut self,
    settings: &Settings,
    now: u64,
    surface_busy: bool,
    scene: Option<&crate::wincontext::SceneSample>,
    typing: bool,
    reduced_motion: impl FnOnce() -> bool,
  ) -> Option<HydrationStatus> {
    let mut changed = false;
    // Prompt phase transitions first (the strip never restarts its lifetime).
    if let Some(prompt) = self.prompt.as_mut() {
      if prompt.phase == "sipping" && now >= prompt.ends_at {
        prompt.phase = "strip".into();
        prompt.ends_at = now + HYDRATION_STRIP_MS;
        changed = true;
      }
    }
    if let Some(prompt) = &self.prompt {
      if prompt.phase == "strip" && now >= prompt.ends_at {
        self.prompt = None;
        changed = true;
      }
    }

    if self.armed.0 <= now {
      match self.armed.1 {
        None => {
          // Crossing midnight restarts the count at zero.
          if roll_day(&mut self.day, now) {
            changed = true;
          }
          self.arm(settings, now);
        }
        Some(slot_at) => {
          changed |= self.tick_slot(slot_at, settings, now, surface_busy, scene, typing, reduced_motion);
        }
      }
    } else if roll_day(&mut self.day, now) {
      // Day rolled between slots (e.g. machine off at midnight).
      changed = true;
    }

    if changed {
      Some(self.status_of(settings))
    } else {
      None
    }
  }

  fn tick_slot(
    &mut self,
    slot_at: u64,
    settings: &Settings,
    now: u64,
    surface_busy: bool,
    scene: Option<&crate::wincontext::SceneSample>,
    typing: bool,
    reduced_motion: impl FnOnce() -> bool,
  ) -> bool {
    // A consumed slot never comes back, even if the clock moved backwards.
    if let Some(consumed_at) = self.day.last_prompt_at {
      if slot_at <= consumed_at || now <= consumed_at {
        self.arm(settings, now);
        return false;
      }
    }
    let skip = |this: &mut Self| {
      this.consume_slot(slot_at);
      this.arm(settings, now);
    };
    if !settings.hydration_enabled {
      skip(self);
      return false;
    }
    if self.day.cups >= settings.hydration_goal_cups {
      skip(self);
      return false;
    }
    let interval_ms = hydration_interval_minutes(settings) * 60_000;
    if let Some(last_cup_at) = self.day.last_cup_at {
      if slot_at.saturating_sub(last_cup_at) < interval_ms {
        skip(self);
        return false;
      }
    }
    // The scene gate (quiet hours / fullscreen / meetings) means "skip".
    if !matches!(
      crate::reminder_context::decision_with_sample(settings, scene, typing, now),
      crate::reminder_context::ContextDecision::Show
    ) {
      skip(self);
      return false;
    }
    if surface_busy {
      skip(self);
      return false;
    }
    self.consume_slot(slot_at);
    self.start_prompt(now, settings, settings.pet_motion && reduced_motion());
    self.arm(settings, now);
    true
  }

  fn start_prompt(&mut self, now: u64, settings: &Settings, reduced_motion: bool) {
    self.sequence += 1;
    let id = format!("{}-{}", now, self.sequence);
    if !settings.pet_motion || reduced_motion {
      // No sipping act: the strip appears at once.
      self.prompt = Some(HydrationPrompt { id, phase: "strip".into(), ends_at: now + HYDRATION_STRIP_MS });
      return;
    }
    self.pending_sip = true;
    self.prompt = Some(HydrationPrompt { id, phase: "sipping".into(), ends_at: now + HYDRATION_SIP_MS });
  }

  pub fn record_cup(&mut self, settings: &Settings, now: u64) -> HydrationStatus {
    roll_day(&mut self.day, now);
    let goal = settings.hydration_goal_cups;
    // A cup answering a prompt belongs to THAT slot, not the click second.
    let slot = if self.prompt.is_some() { self.day.last_prompt_at } else { None };
    self.day.cups = (self.day.cups + 1).min(goal);
    self.day.last_cup_at = slot.or(Some(now));
    self.persist_pending = true;
    self.prompt = None;
    self.arm(settings, now);
    self.status_of(settings)
  }

  pub fn dismiss_prompt(&mut self, settings: &Settings) -> Option<HydrationStatus> {
    if self.prompt.take().is_none() {
      return None;
    }
    Some(self.status_of(settings))
  }

  pub fn take_persist_pending(&mut self) -> bool {
    std::mem::replace(&mut self.persist_pending, false)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn settings() -> Settings {
    Settings::default() // 07:00–21:00, goal 8 → interval 105 → clamped to 105? (14h/8=105)
  }

  #[test]
  fn derived_interval_is_clamped() {
    let config = settings();
    assert_eq!(hydration_interval_minutes(&config), 105);
    let mut tiny = config.clone();
    tiny.work_start_minutes = 8 * 60;
    tiny.work_end_minutes = 9 * 60;
    assert_eq!(hydration_interval_minutes(&tiny), HYDRATION_INTERVAL_MIN_MINUTES);
  }

  #[test]
  fn slots_advance_and_consume_once() {
    let config = settings();
    let start = local_date_at_minutes(1_700_000_000_000, 7 * 60);
    let mut hydration = Hydration::new(None, start);
    hydration.start(&config, start);
    // First slot at 07:00 + 105 min.
    let first = start + 105 * 60_000;
    let busy = false;
    let shown = hydration.tick(&config, first + 10, busy, None, false, || false).unwrap();
    assert_eq!(shown.prompt.as_ref().unwrap().phase, "sipping");
    // A timer firing again on the same slot must not drink twice.
    assert!(hydration.tick(&config, first + 2_000, busy, None, false, || false).is_none());
    // Sipping → strip after 2.6 s.
    let strip = hydration.tick(&config, first + 10 + HYDRATION_SIP_MS, busy, None, false, || false).unwrap();
    assert_eq!(strip.prompt.as_ref().unwrap().phase, "strip");
    // Strip retires after 8 s; the moment is over without recording a cup.
    let retired = hydration.tick(&config, first + 10 + HYDRATION_SIP_MS + HYDRATION_STRIP_MS, busy, None, false, || false).unwrap();
    assert!(retired.prompt.is_none());
    assert_eq!(hydration.day.cups, 0);
  }

  #[test]
  fn busy_surface_consumes_the_slot_silently() {
    let config = settings();
    let start = local_date_at_minutes(1_700_000_000_000, 7 * 60);
    let mut hydration = Hydration::new(None, start);
    hydration.start(&config, start);
    let first = start + 105 * 60_000;
    assert!(hydration.tick(&config, first + 10, true, None, false, || panic!("a skipped prompt must not query motion")).is_none());
    assert!(hydration.day.last_prompt_at.is_some());
    assert!(hydration.prompt.is_none());
  }

  #[test]
  fn cup_answered_by_prompt_stamps_the_slot() {
    let config = settings();
    let start = local_date_at_minutes(1_700_000_000_000, 7 * 60);
    let mut hydration = Hydration::new(None, start);
    hydration.start(&config, start);
    let first = start + 105 * 60_000;
    hydration.tick(&config, first + 10, false, None, false, || false).unwrap();
    let status = hydration.record_cup(&config, first + 15_000);
    assert_eq!(status.cups, 1);
    // The cup is stamped with the SLOT instant (the grid owns the cadence),
    // not the firing second.
    assert_eq!(hydration.day.last_cup_at, Some(first));
  }

  #[test]
  fn reduced_motion_shows_the_strip_immediately_without_a_sip_reaction() {
    let config = settings();
    let start = local_date_at_minutes(1_700_000_000_000, 7 * 60);
    let mut hydration = Hydration::new(None, start);
    hydration.start(&config, start);
    let first = start + 105 * 60_000;
    let shown = hydration.tick(&config, first + 10, false, None, false, || true).unwrap();

    let prompt = shown.prompt.unwrap();
    assert_eq!(prompt.phase, "strip");
    assert_eq!(prompt.ends_at, first + 10 + HYDRATION_STRIP_MS);
    assert!(!hydration.pending_sip);
    assert_eq!(hydration.day.last_prompt_at, Some(first));
  }

  #[test]
  fn disabled_pet_motion_also_skips_the_sip() {
    let mut config = settings();
    config.pet_motion = false;
    let start = local_date_at_minutes(1_700_000_000_000, 7 * 60);
    let mut hydration = Hydration::new(None, start);
    hydration.start(&config, start);
    let first = start + 105 * 60_000;
    let shown = hydration.tick(&config, first + 10, false, None, false, || panic!("disabled pet motion needs no system query")).unwrap();

    assert_eq!(shown.prompt.unwrap().phase, "strip");
    assert!(!hydration.pending_sip);
    assert_eq!(hydration.day.last_prompt_at, Some(first));
  }
}
