//! Reminder scheduler — Rust port of `src/main/reminders.ts` under the
//! production configuration used by the Electron assembly:
//! - `manual_start = true`  → `rest_started_at` starts null; complete is only
//!   accepted after the rest visibly began (`begin_rest`).
//! - `auto_complete_rest = true` → a started rest self-completes 2.5 s after
//!   `unlock_at`.
//! - effective mode is always `focused`; the settings `reminderMode` value is
//!   recorded on events but never changes enforcement.
//! - no scene/context gate in phase 1 (foreground detection is deferred).
//!
//! All timing inputs are injected (`now: u64`) so tests are deterministic.

use crate::reminder_context::{decision_with_sample, ContextDecision};
use crate::types::{
  ActiveReminder, BreakTaskRef, ContextDeferral, PreAlertInfo, ReminderEvent, ReminderStatus,
  Settings, Task,
};
use crate::wincontext::SceneSample;
use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const MINUTE_MS: u64 = 60_000;
const COMBINE_WINDOW_MS: u64 = 60_000;
const PRE_ALERT_SNOOZE_MINUTES: u64 = 2;
const RECENT_ACTIVITY_CAP: usize = 6;
const SYSTEM_GRACE_MS: u64 = 60_000;
const MAX_SCHEDULE_AHEAD_MS: u64 = 48 * 60 * MINUTE_MS;
const ACTIVE_SESSION_RECOVERY_GRACE_MS: u64 = 10 * MINUTE_MS;
/// Rest auto-complete happens 2.5 s after unlock (matches the TS kernel).
pub const AUTO_COMPLETE_SLACK_MS: u64 = 2_500;

/// Mandatory rest wait per kind in focused mode (owned by the backend).
fn complete_wait_ms(kind: &str) -> u64 {
  match kind {
    "eye" => 30_000,
    "walk" | "combined" => 60_000,
    _ => 30_000,
  }
}

const EYE_ACTIVITIES: &[&str] = &[
  "eye-far-gaze",
  "eye-soft-blink",
  "eye-close-rest",
  "eye-window",
  "eye-dim-break",
];
const WALK_ACTIVITIES: &[&str] = &[
  "walk-water",
  "walk-neck",
  "walk-in-place",
  "walk-calf",
  "walk-loop",
];

fn kinds_for(kind: &str) -> Vec<String> {
  match kind {
    "combined" => vec!["eye".into(), "walk".into()],
    single => vec![single.into()],
  }
}

fn pick_break_task(tasks: &[Task]) -> Option<BreakTaskRef> {
  let rank = |priority: &str| match priority {
    "urgent" => 0,
    "important" => 1,
    _ => 2,
  };
  let mut candidates: Vec<&Task> = tasks
    .iter()
    .filter(|task| {
      task.status != "done"
        && task.status != "archived"
        && task.remind_on_break
        && (task.context == "away" || task.context == "any")
    })
    .collect();
  candidates.sort_by(|a, b| {
    rank(&a.priority)
      .cmp(&rank(&b.priority))
      .then(a.planned_at.unwrap_or(u64::MAX).cmp(&b.planned_at.unwrap_or(u64::MAX)))
      .then(a.sort_order.cmp(&b.sort_order))
  });
  candidates.first().map(|task| BreakTaskRef { id: task.id.clone(), title: task.title.clone() })
}

// ── Persistence shapes (runtime-state.json) ──────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedBreakSession {
  #[serde(skip_serializing_if = "Option::is_none")]
  pub rest_started_at: Option<u64>,
  pub kind: String,
  pub kinds: Vec<String>,
  pub started_at: u64,
  pub scheduled_at: u64,
  pub unlock_at: u64,
  pub snooze_allowed_at: u64,
  pub mode: String,
  pub snooze_count: u32,
  pub activity_ids: Vec<String>,
  pub break_task: Option<BreakTaskRef>,
}

impl From<&ActiveReminder> for PersistedBreakSession {
  fn from(active: &ActiveReminder) -> Self {
    PersistedBreakSession {
      rest_started_at: active.rest_started_at,
      kind: active.kind.clone(),
      kinds: active.kinds.clone(),
      started_at: active.started_at,
      scheduled_at: active.scheduled_at,
      unlock_at: active.unlock_at,
      snooze_allowed_at: active.snooze_allowed_at,
      mode: active.mode.clone(),
      snooze_count: active.snooze_count,
      activity_ids: active.activity_ids.clone(),
      break_task: active.break_task.clone(),
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReminderSnapshot {
  pub next_eye_at: u64,
  pub next_walk_at: u64,
  pub paused_until: Option<u64>,
  pub snooze_count: u32,
  pub frozen_eye_ms: Option<u64>,
  pub frozen_walk_ms: Option<u64>,
  pub active: Option<PersistedBreakSession>,
}

// ── Scheduler ────────────────────────────────────────────────────────────────

pub struct Scheduler {
  pub next_eye_at: u64,
  pub next_walk_at: u64,
  pub paused_until: Option<u64>,
  pub active: Option<ActiveReminder>,
  snooze_count: u32,
  frozen: Option<(u64, u64)>,
  quiet_until: u64,
  pre_alerted: HashMap<String, u64>,
  active_pre_alert: Option<(String, u64)>,
  active_is_test: bool,
  recent_activity_ids: Vec<String>,
  sequence: u64,
  /// Last scene-gate deferral (quiet hours); cleared when a reminder shows or
  /// the user takes manual control.
  context_deferral: Option<ContextDeferral>,
  consecutive_context_deferrals: u32,
  /// Real reminder events awaiting the history store (drained by the caller).
  pub pending_events: Vec<ReminderEvent>,
}

impl Scheduler {
  pub fn new(settings: &Settings, restore: Option<ReminderSnapshot>, now: u64) -> Scheduler {
    let mut scheduler = Scheduler {
      next_eye_at: 0,
      next_walk_at: 0,
      paused_until: None,
      active: None,
      snooze_count: 0,
      frozen: None,
      quiet_until: 0,
      pre_alerted: HashMap::new(),
      active_pre_alert: None,
      active_is_test: false,
      recent_activity_ids: Vec::new(),
      sequence: 0,
      context_deferral: None,
      consecutive_context_deferrals: 0,
      pending_events: Vec::new(),
    };
    let (next_eye_at, next_walk_at, paused_until, active) = match restore {
      Some(snapshot) if scheduler.snapshot_is_restorable(&snapshot, now) => {
        scheduler.snooze_count = snapshot.snooze_count;
        let mut paused_until = snapshot.paused_until;
        let mut frozen = None;
        if let Some(until) = paused_until {
          if until <= now {
            // Pause expired while away: continue from stored deadlines.
            paused_until = None;
          } else if let (Some(eye), Some(walk)) = (snapshot.frozen_eye_ms, snapshot.frozen_walk_ms) {
            frozen = Some((eye, walk));
          }
        }
        scheduler.frozen = frozen;
        let active = if paused_until.is_none() {
          scheduler.restore_active_session(&snapshot, now)
        } else {
          None
        };
        (snapshot.next_eye_at, snapshot.next_walk_at, paused_until, active)
      }
      _ => (
        now + settings.eye_interval_minutes * MINUTE_MS,
        now + settings.walk_interval_minutes * MINUTE_MS,
        None,
        None,
      ),
    };
    scheduler.next_eye_at = next_eye_at;
    scheduler.next_walk_at = next_walk_at;
    scheduler.paused_until = paused_until;
    scheduler.active = active;
    scheduler
  }

  pub fn status(&self) -> ReminderStatus {
    ReminderStatus {
      next_eye_at: self.next_eye_at,
      next_walk_at: self.next_walk_at,
      paused_until: self.paused_until,
      active_reminder: self.active.clone(),
      pre_alert: self.active_pre_alert.as_ref().map(|(kind, for_at)| PreAlertInfo {
        kind: kind.clone(),
        fires_at: *for_at,
      }),
      context_deferral: self.context_deferral.clone(),
    }
  }

  pub fn serialize(&self) -> ReminderSnapshot {
    ReminderSnapshot {
      next_eye_at: self.next_eye_at,
      next_walk_at: self.next_walk_at,
      paused_until: self.paused_until,
      snooze_count: self.snooze_count,
      frozen_eye_ms: self.frozen.map(|(eye, _)| eye),
      frozen_walk_ms: self.frozen.map(|(_, walk)| walk),
      // Test reminders are deliberately ephemeral (never persisted).
      active: match (&self.active, self.active_is_test) {
        (Some(active), false) => Some(PersistedBreakSession::from(active)),
        _ => None,
      },
    }
  }

  fn snapshot_is_restorable(&self, snapshot: &ReminderSnapshot, now: u64) -> bool {
    let finite_ahead =
      |value: u64| value > now.saturating_sub(MAX_SCHEDULE_AHEAD_MS) && value <= now + MAX_SCHEDULE_AHEAD_MS;
    finite_ahead(snapshot.next_eye_at)
      && finite_ahead(snapshot.next_walk_at)
      && snapshot.paused_until.map(finite_ahead).unwrap_or(true)
      && snapshot.frozen_eye_ms.map(|v| v < u64::MAX).unwrap_or(true)
      && snapshot.frozen_walk_ms.map(|v| v < u64::MAX).unwrap_or(true)
  }

  fn restore_active_session(&mut self, snapshot: &ReminderSnapshot, now: u64) -> Option<ActiveReminder> {
    let persisted = snapshot.active.as_ref()?;
    let kind = match persisted.kind.as_str() {
      "walk" | "combined" => persisted.kind.clone(),
      _ => "eye".into(),
    };
    let kinds = kinds_for(&kind);
    let unlock_at = persisted.unlock_at;
    // Only recover while the enforcement window is still live.
    if unlock_at.saturating_add(ACTIVE_SESSION_RECOVERY_GRACE_MS) < now {
      return None;
    }
    self.sequence += 1;
    Some(ActiveReminder {
      rest_started_at: persisted.rest_started_at,
      id: format!("{}-{}", now, self.sequence),
      kind,
      kinds,
      started_at: persisted.started_at,
      scheduled_at: persisted.scheduled_at,
      unlock_at,
      snooze_allowed_at: persisted.snooze_allowed_at,
      mode: "focused".into(),
      snooze_count: persisted.snooze_count,
      activity_ids: persisted.activity_ids.clone(),
      break_task: persisted.break_task.clone(),
    })
  }

  fn next_at_for(&self, kind: &str) -> u64 {
    if kind == "eye" { self.next_eye_at } else { self.next_walk_at }
  }

  fn schedule_kind(&mut self, kind: &str, minutes: f64, from: u64) {
    // Fractional minutes keep sub-minute defers (e.g. typing: 2 s) exact.
    let next_at = from + (minutes * MINUTE_MS as f64).round() as u64;
    if kind == "eye" {
      self.next_eye_at = next_at;
    } else {
      self.next_walk_at = next_at;
    }
  }

  /// Settings change: a cycle is fixed once started, but interval edits while
  /// disabled→enabled (or a changed interval) re-anchor that kind from now.
  pub fn update_settings(&mut self, settings: &Settings, previous: &Settings, now: u64) -> bool {
    if settings.eye_interval_minutes != previous.eye_interval_minutes
      || (!previous.eye_enabled && settings.eye_enabled)
    {
      self.schedule_kind("eye", settings.eye_interval_minutes as f64, now);
    }
    if settings.walk_interval_minutes != previous.walk_interval_minutes
      || (!previous.walk_enabled && settings.walk_enabled)
    {
      self.schedule_kind("walk", settings.walk_interval_minutes as f64, now);
    }
    // Any pending pre-alert refers to an old schedule; drop it and the markers.
    self.active_pre_alert = None;
    self.pre_alerted.clear();
    true
  }

  pub fn handle_action(&mut self, action: &str, reminder_id: &str, settings: &Settings, now: u64) -> bool {
    let Some(active) = self.active.clone() else { return false };
    if active.id != reminder_id {
      return false;
    }
    // Backend enforcement: complete needs a started rest AND the unlock time;
    // snooze is never gated in manual-start (production) mode.
    if action == "complete" && (active.rest_started_at.is_none() || now < active.unlock_at) {
      return false;
    }
    if !self.active_is_test {
      self.pending_events.push(ReminderEvent {
        timestamp: now,
        kind: active.kind.clone(),
        scheduled_at: active.scheduled_at,
        shown_at: active.started_at,
        action: action.to_string(),
        snooze_count: if action == "snooze" { active.snooze_count + 1 } else { active.snooze_count },
        mode: active.mode.clone(),
      });
      for kind in &active.kinds {
        let minutes = if action == "snooze" { settings.snooze_minutes as f64 } else { self.interval_for(kind, settings) as f64 };
        self.schedule_kind(kind, minutes, now);
      }
      self.snooze_count = if action == "snooze" { self.snooze_count + 1 } else { 0 };
    }
    self.active = None;
    self.active_is_test = false;
    true
  }

  pub fn pre_alert_action(&mut self, action: &str, settings: &Settings, tasks: &[Task], now: u64) -> bool {
    let Some((kind, for_at)) = self.active_pre_alert.clone() else { return false };
    self.active_pre_alert = None;
    if action == "start" {
      self.begin_reminder(&kind, false, for_at, settings, tasks, now);
    } else if action == "snooze" {
      self.schedule_kind(&kind, PRE_ALERT_SNOOZE_MINUTES as f64, now);
    }
    let _ = settings;
    true
  }

  /// A settings-window test must never replace a live reminder or a pause.
  pub fn trigger_test(&mut self, kind: &str, settings: &Settings, tasks: &[Task], now: u64) -> bool {
    if self.active.is_some() || self.paused_until.is_some() {
      return false;
    }
    self.begin_reminder(kind, true, now, settings, tasks, now);
    true
  }

  /// Tray "立即休息": picks the nearest deadline; the other kind can absorb in.
  pub fn trigger_now(&mut self, settings: &Settings, tasks: &[Task], now: u64) -> bool {
    if self.active.is_some() || self.paused_until.is_some() {
      return false;
    }
    let kind = if self.next_eye_at <= self.next_walk_at { "eye" } else { "walk" };
    self.begin_reminder(kind, false, now, settings, tasks, now);
    true
  }

  /// Freeze the remaining time instead of resetting the cycles.
  pub fn pause(&mut self, minutes: u64, now: u64) -> bool {
    let minutes = minutes.clamp(1, 24 * 60);
    let paused_until = now + minutes * MINUTE_MS;
    if self.paused_until.is_some() && self.frozen.is_some() {
      // Extend the hold; never inflate the frozen remainder.
      let (eye_ms, walk_ms) = self.frozen.unwrap();
      self.paused_until = Some(self.paused_until.unwrap().max(paused_until));
      self.next_eye_at = self.paused_until.unwrap() + eye_ms;
      self.next_walk_at = self.paused_until.unwrap() + walk_ms;
    } else {
      self.frozen = Some((
        self.next_eye_at.saturating_sub(now),
        self.next_walk_at.saturating_sub(now),
      ));
      self.paused_until = Some(paused_until);
      self.next_eye_at = paused_until + self.frozen.unwrap().0;
      self.next_walk_at = paused_until + self.frozen.unwrap().1;
    }
    self.active = None;
    self.active_is_test = false;
    self.active_pre_alert = None;
    self.snooze_count = 0;
    self.context_deferral = None;
    true
  }

  pub fn resume(&mut self, now: u64) -> bool {
    if self.paused_until.is_none() {
      return false;
    }
    self.paused_until = None;
    if let Some((eye_ms, walk_ms)) = self.frozen.take() {
      self.next_eye_at = now + eye_ms;
      self.next_walk_at = now + walk_ms;
    }
    self.active_pre_alert = None;
    self.context_deferral = None;
    true
  }

  pub fn restart_cycle(&mut self, settings: &Settings, now: u64) -> bool {
    self.paused_until = None;
    self.frozen = None;
    self.snooze_count = 0;
    self.active = None;
    self.active_is_test = false;
    self.active_pre_alert = None;
    self.context_deferral = None;
    self.next_eye_at = now + self.interval_for("eye", settings) * MINUTE_MS;
    self.next_walk_at = now + self.interval_for("walk", settings) * MINUTE_MS;
    true
  }

  /// The rest actually began: enforcement window starts here, not at show time.
  pub fn begin_rest(&mut self, id: &str, minimum_ms: u64, settings: &Settings, now: u64) -> bool {
    let Some(active) = self.active.as_mut() else { return false };
    if active.id != id || active.rest_started_at.is_some() {
      return false;
    }
    let rest_seconds = match active.kind.as_str() {
      "eye" => settings.eye_rest_seconds,
      "walk" => settings.walk_rest_seconds,
      _ => settings.eye_rest_seconds.max(settings.walk_rest_seconds),
    };
    active.rest_started_at = Some(now);
    active.unlock_at = now + (rest_seconds * 1000).max(minimum_ms);
    active.snooze_allowed_at = now;
    true
  }

  /// Forward wall-clock jump: the machine slept or the clock jumped ahead.
  /// A long absence is a natural break, not a backlog of reminders.
  pub fn handle_activity_resume(&mut self, inactive_ms: u64, settings: &Settings, now: u64) -> bool {
    let inactive_ms = inactive_ms.min(i64::MAX as u64);
    if inactive_ms >= settings.natural_break_minutes * MINUTE_MS {
      let eye_due = settings.eye_enabled && self.next_eye_at <= now;
      let walk_due = settings.walk_enabled && self.next_walk_at <= now;
      let natural_kind = if eye_due && walk_due {
        "combined"
      } else if eye_due {
        "eye"
      } else if walk_due {
        "walk"
      } else if self.next_eye_at <= self.next_walk_at {
        "eye"
      } else {
        "walk"
      };
      let scheduled_at = if natural_kind == "combined" {
        self.next_eye_at.min(self.next_walk_at)
      } else {
        self.next_at_for(natural_kind)
      };
      self.pending_events.push(ReminderEvent {
        timestamp: now,
        kind: natural_kind.to_string(),
        scheduled_at,
        shown_at: now,
        action: "natural-break".into(),
        snooze_count: self.snooze_count,
        mode: settings.reminder_mode.clone(),
      });
      self.next_eye_at = now + self.interval_for("eye", settings) * MINUTE_MS;
      self.next_walk_at = now + self.interval_for("walk", settings) * MINUTE_MS;
      self.snooze_count = 0;
      self.active = None;
      self.active_is_test = false;
      self.active_pre_alert = None;
      self.paused_until = None;
      self.frozen = None;
    } else if self.active.is_none() && inactive_ms > 0 {
      self.next_eye_at += inactive_ms;
      self.next_walk_at += inactive_ms;
      if let Some(paused) = self.paused_until {
        self.paused_until = Some(paused + inactive_ms);
      }
      if let Some((kind, for_at)) = self.active_pre_alert.as_mut() {
        let _ = kind;
        *for_at += inactive_ms;
      }
    }
    self.quiet_until = now + SYSTEM_GRACE_MS;
    true
  }

  /// Backward wall-clock jump: keep renderer-facing durations meaningful.
  pub fn handle_wall_clock_backwards(&mut self, delta: i64) -> bool {
    let shift = |value: u64| -> u64 { (value as i64 + delta).max(0) as u64 };
    self.next_eye_at = shift(self.next_eye_at);
    self.next_walk_at = shift(self.next_walk_at);
    if let Some(paused) = self.paused_until {
      self.paused_until = Some(shift(paused));
    }
    if let Some((_, for_at)) = self.active_pre_alert.as_mut() {
      *for_at = shift(*for_at);
    }
    if let Some(active) = self.active.as_mut() {
      active.started_at = shift(active.started_at);
      active.scheduled_at = shift(active.scheduled_at);
      active.unlock_at = shift(active.unlock_at);
      active.snooze_allowed_at = shift(active.snooze_allowed_at);
      if let Some(started) = active.rest_started_at {
        active.rest_started_at = Some(shift(started));
      }
    }
    self.quiet_until = shift(self.quiet_until);
    true
  }

  /// One scheduling pass; returns true when renderer-visible state changed.
  pub fn tick(&mut self, now: u64, settings: &Settings, tasks: &[Task], scene: Option<&SceneSample>, typing: bool) -> bool {
    let mut changed = false;
    if let Some(active) = self.active.clone() {
      changed |= self.absorb_due_kinds(active.id.clone(), settings, tasks, now);
      if let Some(active) = self.active.clone() {
        if active.rest_started_at.is_some() && now >= active.unlock_at.saturating_add(AUTO_COMPLETE_SLACK_MS) {
          changed |= self.handle_action("complete", &active.id, settings, now);
        }
      }
      return changed;
    }

    if let Some(paused) = self.paused_until {
      if now < paused {
        return false;
      }
      self.paused_until = None;
      self.frozen = None;
      changed = true;
    }

    if now < self.quiet_until {
      return changed;
    }

    changed |= self.mark_and_maybe_show_pre_alert(now, settings, scene, typing);

    let eye_due = settings.eye_enabled && self.next_eye_at <= now;
    let walk_due = settings.walk_enabled && self.next_walk_at <= now;
    let eye_near = settings.eye_enabled && self.next_eye_at <= now + COMBINE_WINDOW_MS;
    let walk_near = settings.walk_enabled && self.next_walk_at <= now + COMBINE_WINDOW_MS;

    let due_kind: Option<&str> = if (eye_due && walk_near) || (walk_due && eye_near) {
      Some("combined")
    } else if eye_due {
      Some("eye")
    } else if walk_due {
      Some("walk")
    } else {
      None
    };

    if let Some(kind) = due_kind {
      // Real due reminders pass the scene gate (quiet hours); manual and
      // test triggers bypass it by never reaching this path.
      match decision_with_sample(settings, scene, typing, now) {
        ContextDecision::Defer { seconds, reason, foreground_app } => {
          let defer_seconds = seconds.clamp(1, 24 * 60 * 60);
          for involved in kinds_for(kind) {
            self.schedule_kind(&involved, defer_seconds as f64 / 60.0, now);
          }
          self.consecutive_context_deferrals += 1;
          self.context_deferral = Some(ContextDeferral {
            until: now + defer_seconds * 1000,
            reason,
            foreground_app,
            consecutive_count: self.consecutive_context_deferrals,
          });
          return true;
        }
        ContextDecision::Show => {
          self.consecutive_context_deferrals = 0;
          self.context_deferral = None;
          let scheduled_at = if kind == "combined" {
            self.next_eye_at.min(self.next_walk_at)
          } else {
            self.next_at_for(kind)
          };
          self.begin_reminder(kind, false, scheduled_at, settings, tasks, now);
          return true;
        }
      }
    }
    changed
  }

  /// Soft pre-alert: once per deadline value, the nearest kind gets the bubble.
  fn mark_and_maybe_show_pre_alert(&mut self, now: u64, settings: &Settings, scene: Option<&SceneSample>, typing: bool) -> bool {
    let pre_ms = settings.pre_alert_seconds.saturating_mul(1000);
    if pre_ms == 0 || self.active_pre_alert.is_some() {
      return false;
    }
    let mut candidate: Option<String> = None;
    for kind in ["eye", "walk"] {
      let at = self.next_at_for(kind);
      if self.pre_alerted.get(kind) == Some(&at) || at.saturating_sub(pre_ms) > now {
        continue;
      }
      self.pre_alerted.insert(kind.to_string(), at);
      if at > now {
        let better = match &candidate {
          Some(current) => at < self.next_at_for(current),
          None => true,
        };
        if better {
          candidate = Some(kind.to_string());
        }
      }
    }
    if let Some(kind) = candidate {
      // Pre-alerts respect the scene gate: marked, but not shown during a
      // quiet window (the marker keeps the deadline from re-arming).
      if !matches!(decision_with_sample(settings, scene, typing, now), ContextDecision::Show) {
        return false;
      }
      let for_at = self.next_at_for(&kind);
      self.active_pre_alert = Some((kind, for_at));
      return true;
    }
    false
  }

    /// Fold the other kind into a visible reminder within the combine window.
    fn absorb_due_kinds(&mut self, _active_id: String, settings: &Settings, tasks: &[Task], now: u64) -> bool {
        if self.active_is_test {
            return false;
        }
        let mut active = match self.active.clone() {
            Some(active) => active,
            None => return false,
        };
        let should_absorb = ["eye", "walk"].iter().any(|kind| {
            let enabled = if *kind == "eye" { settings.eye_enabled } else { settings.walk_enabled };
            enabled && !active.kinds.iter().any(|k| k == kind) && self.next_at_for(kind) <= now + COMBINE_WINDOW_MS
        });
        if !should_absorb {
            return false;
        }
        active.kinds = vec!["eye".into(), "walk".into()];
        active.kind = "combined".into();
        active.scheduled_at = active
            .scheduled_at
            .min(self.next_eye_at)
            .min(self.next_walk_at);
        if active.break_task.is_none() {
            active.break_task = pick_break_task(tasks);
        }
        let missing: Vec<String> = active
            .kinds
            .iter()
            .filter(|kind| !active.activity_ids.iter().any(|id| id.starts_with(kind.as_str())))
            .cloned()
            .collect();
        for kind in missing {
            let mut extra = self.pick_activities(&kind);
            active.activity_ids.append(&mut extra);
        }
        // Extend the enforced rest to the combined duration when it already
        // started; a not-yet-started rest keeps its original unlock window.
        let manual_unlock = match active.rest_started_at {
            Some(started) => {
                let seconds = settings.eye_rest_seconds.max(settings.walk_rest_seconds);
                started + seconds * 1000
            }
            None => active.unlock_at,
        };
        if manual_unlock > active.unlock_at {
            active.unlock_at = manual_unlock;
        }
        if active.snooze_count > 0 {
            active.snooze_allowed_at = active.snooze_allowed_at.max(active.unlock_at);
        }
        self.active = Some(active);
        true
    }

  fn begin_reminder(
    &mut self,
    kind: &str,
    is_test: bool,
    scheduled_at: u64,
    _settings: &Settings,
    tasks: &[Task],
    now: u64,
  ) {
    self.sequence += 1;
    let unlock_at = now + complete_wait_ms(kind);
    let active = ActiveReminder {
      rest_started_at: None,
      id: format!("{}-{}", now, self.sequence),
      kind: kind.to_string(),
      kinds: kinds_for(kind),
      started_at: now,
      scheduled_at,
      unlock_at,
      snooze_allowed_at: if self.snooze_count > 0 && !is_test { unlock_at } else { now },
      mode: "focused".into(),
      snooze_count: if is_test { 0 } else { self.snooze_count },
      activity_ids: self.pick_activities(kind),
      break_task: if kind == "walk" || kind == "combined" { pick_break_task(tasks) } else { None },
    };
    self.active_is_test = is_test;
    self.active_pre_alert = None;
    self.context_deferral = None;
    self.active = Some(active);
  }

  fn pick_activities(&mut self, kind: &str) -> Vec<String> {
    let kinds = kinds_for(kind);
    let mut picked = Vec::new();
    for single in kinds {
      let pool: &[&str] = if single == "eye" { EYE_ACTIVITIES } else { WALK_ACTIVITIES };
      let fresh: Vec<&str> = pool
        .iter()
        .copied()
        .filter(|id| !self.recent_activity_ids.iter().any(|recent| recent == id))
        .collect();
      let candidates: &[&str] = if fresh.is_empty() { pool } else { &fresh };
      let choice = candidates
        .choose(&mut rand::thread_rng())
        .copied()
        .unwrap_or(pool[0]);
      picked.push(choice.to_string());
    }
    self.recent_activity_ids.extend(picked.iter().cloned());
    let start = self.recent_activity_ids.len().saturating_sub(RECENT_ACTIVITY_CAP);
    self.recent_activity_ids.drain(0..start);
    picked
  }

  fn interval_for(&self, kind: &str, settings: &Settings) -> u64 {
    if kind == "eye" { settings.eye_interval_minutes } else { settings.walk_interval_minutes }
  }

  pub fn is_test_active(&self) -> bool {
    self.active_is_test
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use chrono::TimeZone;

  fn settings() -> Settings {
    Settings::default()
  }

  fn tasks() -> Vec<Task> {
    Vec::new()
  }

  #[test]
  fn deadline_fires_combined_when_both_near() {
    let now = 1_000_000u64;
    let mut scheduler = Scheduler::new(&settings(), None, now);
    // Both deadlines land inside the 60 s combine window.
    scheduler.next_eye_at = now + 30_000;
    scheduler.next_walk_at = now + 45_000;
    assert!(scheduler.tick(now + 31_000, &settings(), &tasks(), None, false));
    let active = scheduler.active.unwrap();
    assert_eq!(active.kind, "combined");
    assert_eq!(active.kinds, vec!["eye", "walk"]);
  }

  #[test]
  fn complete_is_rejected_before_rest_begins() {
    let now = 1_000_000u64;
    let mut scheduler = Scheduler::new(&settings(), None, now);
    assert!(scheduler.trigger_test("eye", &settings(), &tasks(), now));
    let id = scheduler.active.as_ref().unwrap().id.clone();
    // Manual-start mode: no rest started yet → complete rejected.
    assert!(!scheduler.handle_action("complete", &id, &settings(), now + 5_000));
    assert!(scheduler.begin_rest(&id, 0, &settings(), now + 6_000));
    // unlock = rest start + 30 s.
    assert!(!scheduler.handle_action("complete", &id, &settings(), now + 7_000));
    assert!(scheduler.handle_action("complete", &id, &settings(), now + 40_000));
    assert!(scheduler.active.is_none());
  }

  #[test]
  fn auto_complete_after_unlock_slack() {
    let now = 1_000_000u64;
    let mut scheduler = Scheduler::new(&settings(), None, now);
    scheduler.trigger_test("eye", &settings(), &tasks(), now);
    let id = scheduler.active.as_ref().unwrap().id.clone();
    scheduler.begin_rest(&id, 0, &settings(), now + 1_000);
    // Test reminders must not move real deadlines on completion.
    let next_eye = scheduler.next_eye_at;
    assert!(scheduler.tick(now + 1_000 + 30_000 + 2_500, &settings(), &tasks(), None, false));
    assert!(scheduler.active.is_none());
    assert_eq!(scheduler.next_eye_at, next_eye);
  }

  #[test]
  fn pause_freezes_remaining_time() {
    let now = 1_000_000u64;
    let mut scheduler = Scheduler::new(&settings(), None, now);
    let eye_deadline = scheduler.next_eye_at;
    // 2 minutes left on the eye cycle.
    scheduler.next_eye_at = now + 2 * MINUTE_MS;
    assert!(scheduler.pause(60, now));
    // Extending the hold never inflates the frozen remainder.
    assert!(scheduler.pause(120, now + 60_000));
    assert_eq!(scheduler.next_eye_at, scheduler.paused_until.unwrap() + 2 * MINUTE_MS);
    // Resume earlier than the pause end continues from now.
    assert!(scheduler.resume(now + 90_000));
    assert_eq!(scheduler.next_eye_at, now + 90_000 + 2 * MINUTE_MS);
    let _ = eye_deadline;
  }

  #[test]
  fn natural_break_resets_cycles_and_records_event() {
    let now = 1_000_000u64;
    let mut scheduler = Scheduler::new(&settings(), None, now);
    scheduler.next_eye_at = now - 1; // overdue while away
    scheduler.tick(now, &settings(), &tasks(), None, false); // may fire; clear it
    if let Some(active) = scheduler.active.clone() {
      scheduler.handle_action("skip", &active.id, &settings(), now);
    }
    let away = (settings().natural_break_minutes + 1) * MINUTE_MS;
    assert!(scheduler.handle_activity_resume(away, &settings(), now + away));
    assert_eq!(scheduler.pending_events.last().unwrap().action, "natural-break");
    assert_eq!(scheduler.next_eye_at, now + away + settings().eye_interval_minutes * MINUTE_MS);
    assert_eq!(scheduler.quiet_until, now + away + SYSTEM_GRACE_MS);
  }

  #[test]
  fn pre_alert_marks_once_per_deadline() {
    let mut config = settings();
    config.pre_alert_seconds = 30;
    let now = 1_000_000u64;
    let mut scheduler = Scheduler::new(&config, None, now);
    scheduler.next_eye_at = now + 25_000;
    scheduler.next_walk_at = now + 2 * MINUTE_MS;
    assert!(scheduler.tick(now, &config, &tasks(), None, false));
    assert_eq!(scheduler.active_pre_alert.as_ref().unwrap().0, "eye");
    // Dismiss keeps the plan; the marker prevents an immediate re-show.
    assert!(scheduler.pre_alert_action("dismiss", &config, &tasks(), now + 1_000));
    assert!(!scheduler.tick(now + 2_000, &config, &tasks(), None, false));
  }

  #[test]
  fn snapshot_restore_recovers_live_session_only() {
    let now = 1_000_000_000u64;
    let base = Scheduler::new(&settings(), None, now);
    let mut snapshot = base.serialize();
    snapshot.active = Some(PersistedBreakSession {
      rest_started_at: Some(now - 10_000),
      kind: "eye".into(),
      kinds: vec!["eye".into()],
      started_at: now - 30_000,
      scheduled_at: now - 30_000,
      unlock_at: now + 5_000,
      snooze_allowed_at: now - 10_000,
      mode: "focused".into(),
      snooze_count: 0,
      activity_ids: vec!["eye-close-rest".into()],
      break_task: None,
    });
    let scheduler = Scheduler::new(&settings(), Some(snapshot), now);
    assert!(scheduler.active.is_some());

    // A stale session (unlocked long ago) is dropped.
    let mut stale = Scheduler::new(&settings(), None, now).serialize();
    stale.active = Some(PersistedBreakSession {
      rest_started_at: Some(now - 30 * MINUTE_MS),
      kind: "eye".into(),
      kinds: vec!["eye".into()],
      started_at: now - 30 * MINUTE_MS,
      scheduled_at: now - 30 * MINUTE_MS,
      unlock_at: now - 20 * MINUTE_MS,
      snooze_allowed_at: now - 30 * MINUTE_MS,
      mode: "focused".into(),
      snooze_count: 0,
      activity_ids: vec![],
      break_task: None,
    });
    let scheduler = Scheduler::new(&settings(), Some(stale), now);
    assert!(scheduler.active.is_none());
  }

  #[test]
  fn quiet_hours_defer_real_but_not_manual() {
    let minute = crate::reminder_context::minutes_of_local_day(1_700_000_000_000);
    let now = {
      // A wall-clock instant inside the (minute-1, minute+2) local window.
      let today = chrono::Local::now().date_naive();
      chrono::Local
        .from_local_datetime(
          &today
            .and_hms_opt((minute / 60) as u32, (minute % 60) as u32, 0)
            .unwrap(),
        )
        .single()
        .unwrap()
        .timestamp_millis() as u64
    };
    let mut config = settings();
    config.quiet_hours_enabled = true;
    config.quiet_hours_start_minutes = (minute + 1440 - 1) % 1440;
    config.quiet_hours_end_minutes = (minute + 2) % 1440;
    let mut scheduler = Scheduler::new(&config, None, now);
    scheduler.next_eye_at = now - 1; // overdue while the window is active
    assert!(scheduler.tick(now, &config, &tasks(), None, false));
    assert!(scheduler.active.is_none(), "quiet hours must not show the reminder");
    let status = scheduler.status();
    let deferral = status.context_deferral.expect("deferral surfaced");
    assert!(deferral.reason.contains("免打扰"));
    assert_eq!(status.next_eye_at, now + 30_000);
    // Manual "rest now" bypasses the gate and clears the deferral.
    assert!(scheduler.trigger_now(&config, &tasks(), now + 10));
    assert!(scheduler.active.is_some());
    assert!(scheduler.status().context_deferral.is_none());
  }

  #[test]
  fn walk_reminder_carries_break_task_snapshot() {
    let now = 1_000_000u64;
    let mut scheduler = Scheduler::new(&settings(), None, now);
    let mut task = Task {
      id: "t1".into(),
      title: "浇花".into(),
      status: "open".into(),
      remind_on_break: true,
      context: "away".into(),
      ..crate::tests_support::sample_task()
    };
    task.planned_at = None;
    assert!(scheduler.trigger_test("walk", &settings(), &[task], now));
    assert_eq!(scheduler.active.unwrap().break_task.unwrap().title, "浇花");
  }
}
