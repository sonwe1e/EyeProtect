//! Reminder history — port of `src/main/reminderHistory.ts` (the parts the
//! simplified product uses: event retention + the weekly rest companion).

use crate::types::{add_local_days, local_date_key, ReminderEvent, RestCompanionDay, RestCompanionSummary, Settings};
use chrono::{Datelike, Local, TimeZone, Timelike};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const DAY_MS: u64 = 24 * 60 * 60 * 1_000;

/// Validate one persisted/imported event (mirrors `sanitizeReminderEvent`).
pub fn sanitize_event(value: &serde_json::Value) -> Option<ReminderEvent> {
  let obj = value.as_object()?;
  let timestamp = obj.get("timestamp").and_then(Value::as_u64)?;
  let scheduled_at = obj.get("scheduledAt").and_then(Value::as_u64)?;
  let shown_at = obj.get("shownAt").and_then(Value::as_u64)?;
  let kind = obj.get("kind").and_then(Value::as_str)?;
  if !["eye", "walk", "combined"].contains(&kind) {
    return None;
  }
  let action = obj.get("action").and_then(Value::as_str)?;
  if !["complete", "snooze", "skip", "natural-break"].contains(&action) {
    return None;
  }
  let mode = obj.get("mode").and_then(Value::as_str)?;
  if !["gentle", "guided", "focused"].contains(&mode) {
    return None;
  }
  Some(ReminderEvent {
    timestamp,
    kind: kind.to_string(),
    scheduled_at,
    shown_at,
    action: action.to_string(),
    snooze_count: obj.get("snoozeCount").and_then(Value::as_u64).unwrap_or(0) as u32,
    mode: mode.to_string(),
  })
}

fn start_of_week(timestamp: u64) -> u64 {
  let local = Local.timestamp_millis_opt(timestamp as i64).single().unwrap_or_else(Local::now);
  let days_from_monday = local.weekday().num_days_from_monday() as i64;
  let monday = (local - chrono::Duration::days(days_from_monday))
    .with_hour(0)
    .and_then(|d| d.with_minute(0))
    .and_then(|d| d.with_second(0))
    .and_then(|d| d.with_nanosecond(0));
  monday.map(|d| d.timestamp_millis().max(0) as u64).unwrap_or(timestamp)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryFile {
  pub version: u64,
  pub events: Vec<ReminderEvent>,
}

pub struct History {
  pub events: Vec<ReminderEvent>,
  pub persist_pending: bool,
}

impl History {
  pub fn new(events: Vec<ReminderEvent>) -> History {
    History { events, persist_pending: false }
  }

  pub fn record(&mut self, event: ReminderEvent, settings: &Settings) {
    if !settings.history_enabled {
      return;
    }
    let timestamp = event.timestamp;
    self.events.push(event);
    let cutoff = timestamp.saturating_sub(settings.history_retention_days * DAY_MS);
    self.events.retain(|entry| entry.timestamp >= cutoff);
    self.persist_pending = true;
  }

  pub fn apply_retention(&mut self, days: u64, now: u64) {
    let cutoff = now.saturating_sub(days * DAY_MS);
    let before = self.events.len();
    self.events.retain(|entry| entry.timestamp >= cutoff);
    if self.events.len() != before {
      self.persist_pending = true;
    }
  }

  pub fn rest_companion(&self, enabled: bool, now: u64) -> RestCompanionSummary {
    let week_start = start_of_week(now);
    let mut days: Vec<RestCompanionDay> = (0..7)
      .map(|index| RestCompanionDay {
        date: local_date_key(add_local_days(week_start, index as i64)),
        completed: 0,
      })
      .collect();
    for event in &self.events {
      if event.action != "complete" || event.timestamp < week_start || event.timestamp > now {
        continue;
      }
      let key = local_date_key(event.timestamp);
      if let Some(day) = days.iter_mut().find(|day| day.date == key) {
        day.completed += 1;
      }
    }
    let completed: u32 = days.iter().map(|day| day.completed).sum();
    let message = if !enabled {
      "休息记录已关闭，仍然可以按自己的节奏休息。".to_string()
    } else if completed > 0 {
      format!("本周已为自己留出 {} 次休息，每一小次停顿都算数。", completed)
    } else {
      "按自己的节奏来，下一次小小的休息就很好。".to_string()
    };
    RestCompanionSummary { generated_at: now, enabled, completed, message, days }
  }

  pub fn take_persist_pending(&mut self) -> bool {
    std::mem::replace(&mut self.persist_pending, false)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn event(timestamp: u64, action: &str) -> ReminderEvent {
    ReminderEvent {
      timestamp,
      kind: "eye".into(),
      scheduled_at: timestamp,
      shown_at: timestamp,
      action: action.into(),
      snooze_count: 0,
      mode: "focused".into(),
    }
  }

  #[test]
  fn companion_counts_only_this_weeks_completes() {
    let now = Local::now().timestamp_millis() as u64;
    let week_start = start_of_week(now);
    let mut history = History::new(vec![
      event(week_start + 1000, "complete"),
      event(week_start + 2000, "complete"),
      event(week_start + 3000, "skip"),
      event(week_start - DAY_MS, "complete"),
      event(now + DAY_MS, "complete"),
    ]);
    let summary = history.rest_companion(true, now);
    assert_eq!(summary.completed, 2);
    assert_eq!(summary.days.len(), 7);
    assert!(summary.message.contains("2 次"));
    let disabled = history.rest_companion(false, now);
    assert!(disabled.message.contains("已关闭"));
  }

  #[test]
  fn retention_prunes_old_events() {
    let now = 10 * DAY_MS;
    let mut history = History::new(vec![event(0, "complete"), event(5 * DAY_MS, "complete")]);
    history.apply_retention(7, now);
    assert_eq!(history.events.len(), 1);
  }
}
