//! Pomodoro service — port of `src/main/pomodoro.ts` (production wiring).
//!
//! The backend owns the countdown; the renderer only displays `remaining_ms`.
//! Between transitions the remaining time advances on the shared 1 s tick and
//! is re-published at most every 10 s (the TS kernel used a 10 s checkpoint
//! event for the same purpose).

use crate::types::{PomodoroState, Project, Settings, Task};
use serde_json::Value;

const MINUTES_MIN: u64 = 1;
const MINUTES_MAX: u64 = 180;

fn idle() -> PomodoroState {
  PomodoroState { phase: "idle".into(), running: false, task_id: None, remaining_ms: 0, revision: 0 }
}

pub struct Pomodoro {
  state: PomodoroState,
  last_emit_remaining: u64,
  /// Set when a commit changed persistent state and the file must be rewritten.
  pub persist_pending: bool,
}

/// Borrowed inputs the pomodoro needs; field-level borrows let callers keep a
/// `&mut Pomodoro` alive next to this context.
pub struct PomodoroContext<'a> {
  pub settings: &'a Settings,
  pub tasks: &'a [Task],
  pub projects: &'a [Project],
  pub health_break_active: bool,
}

impl PomodoroContext<'_> {
  /// A focusable task is an open root task of a live list.
  pub fn task_available(&self, id: &str) -> bool {
    self
      .tasks
      .iter()
      .find(|task| task.id == id)
      .map(|task| task.status == "open" && crate::types::is_current_task(task, self.projects))
      .unwrap_or(false)
  }
}

impl Pomodoro {
  pub fn from_persisted(value: Option<Value>, task_available: &dyn Fn(&str) -> bool) -> Pomodoro {
    let mut state = idle();
    if let Some(value) = value {
      let phase = value.get("phase").and_then(Value::as_str).unwrap_or("");
      let remaining = value.get("remainingMs").and_then(Value::as_f64).unwrap_or(-1.0);
      let valid_phase = ["idle", "ready", "focus", "break", "focus-finished", "break-finished"]
        .contains(&phase);
      let valid_remaining = remaining.is_finite() && remaining >= 0.0 && remaining <= 180.0 * 60_000.0;
      if valid_phase && valid_remaining {
        state.phase = phase.to_string();
        state.remaining_ms = remaining.round() as u64;
        state.task_id = match value.get("taskId") {
          Some(Value::String(id)) => Some(id.clone()),
          _ => None,
        };
        if let Some(task_id) = state.task_id.clone() {
          if !task_available(&task_id) {
            state = idle();
          }
        }
      }
    }
    Pomodoro { state, last_emit_remaining: 0, persist_pending: false }
  }

  pub fn state(&self) -> PomodoroState {
    self.state.clone()
  }

  pub fn task_id(&self) -> Option<&str> {
    self.state.task_id.as_deref()
  }

  fn commit(&mut self, phase: &str, running: bool, task_id: Option<String>, remaining_ms: u64) -> PomodoroState {
    self.state = PomodoroState {
      phase: phase.to_string(),
      running,
      task_id,
      remaining_ms,
      revision: self.state.revision + 1,
    };
    self.persist_pending = true;
    self.last_emit_remaining = remaining_ms;
    self.state.clone()
  }

  pub fn prepare(&mut self, task_id: Option<String>, replace: bool, ctx: &PomodoroContext) -> Result<PomodoroState, String> {
    if let Some(id) = &task_id {
      if !ctx.task_available(id) {
        return Err("只能专注未完成主任务".into());
      }
    }
    if ["focus", "break"].contains(&self.state.phase.as_str()) && !replace {
      return Err("请先确认结束当前计时".into());
    }
    Ok(self.commit("ready", false, task_id, 0))
  }

  pub fn start(
    &mut self,
    task_id: Option<String>,
    minutes: f64,
    replace: bool,
    ctx: &PomodoroContext,
  ) -> Result<PomodoroState, String> {
    let whole = minutes.fract() == 0.0 && minutes >= MINUTES_MIN as f64 && minutes <= MINUTES_MAX as f64;
    if !whole {
      return Err("专注时长需要在 1–180 分钟之间".into());
    }
    if let Some(id) = &task_id {
      if !ctx.task_available(id) {
        return Err("只能专注未完成的主任务".into());
      }
    }
    if ctx.health_break_active {
      return Err("请先完成当前休息".into());
    }
    if self.state.phase != "idle" && !replace {
      return Err("已有计时，请先确认结束".into());
    }
    let remaining = (minutes as u64) * 60_000;
    Ok(self.commit("focus", true, task_id, remaining))
  }

  pub fn act(&mut self, action: &str, ctx: &PomodoroContext) -> Result<PomodoroState, String> {
    let current = self.state.clone();
    match action {
      "stop" => Ok(self.commit("idle", false, None, 0)),
      "pause" => {
        if current.running {
          Ok(self.commit(&current.phase, false, current.task_id, current.remaining_ms))
        } else {
          Ok(current)
        }
      }
      "resume" => {
        if ctx.health_break_active {
          return Err("请先完成当前休息".into());
        }
        if current.running || !["focus", "break"].contains(&current.phase.as_str()) {
          return Ok(current);
        }
        Ok(self.commit(&current.phase, true, current.task_id, current.remaining_ms))
      }
      "break" => {
        if current.phase != "focus-finished" {
          return Ok(current);
        }
        let break_ms = ctx.settings.pomodoro_break_minutes * 60_000;
        Ok(self.commit("break", true, current.task_id, break_ms))
      }
      _ => Err("无效番茄钟操作".into()),
    }
  }

  /// A visible health rest started: pause/finish the focus phase so the rest
  /// owns the screen (index.ts `beginHealthRest`).
  pub fn begin_health_rest(&mut self, ctx: &PomodoroContext) -> bool {
    let mut changed = false;
    if self.state.phase == "focus" && self.state.remaining_ms == 0 {
      let task_id = self.state.task_id.clone();
      let _ = self.commit("focus-finished", false, task_id, 0);
      changed = true;
    }
    if self.state.phase == "focus" {
      let _ = self.act("pause", ctx);
      changed = true;
    } else if self.state.phase == "focus-finished" {
      let _ = self.act("break", ctx);
      changed = true;
    } else if self.state.phase == "break" && !self.state.running {
      let current = self.state.clone();
      let _ = self.commit("break", true, current.task_id, current.remaining_ms);
      changed = true;
    }
    changed
  }

  /// The focused task vanished (deleted/completed): stop the timer.
  pub fn reconcile_task(&mut self, ctx: &PomodoroContext) -> bool {
    if let Some(id) = self.state.task_id.clone() {
      if !ctx.task_available(&id) {
        let _ = self.act("stop", ctx);
        return true;
      }
    }
    false
  }

  /// Advance the elapsed-domain countdown; returns Some(state) when the
  /// renderer should receive a fresh `pomodoro:changed` payload.
  pub fn tick(&mut self, elapsed_ms: u64, ctx: &PomodoroContext) -> Option<PomodoroState> {
    let _ = ctx;
    if !self.state.running {
      return None;
    }
    let remaining = self.state.remaining_ms.saturating_sub(elapsed_ms);
    if remaining == 0 {
      let next_phase = if self.state.phase == "focus" { "focus-finished" } else { "break-finished" };
      let task_id = self.state.task_id.clone();
      return Some(self.commit(next_phase, false, task_id, 0));
    }
    self.state.remaining_ms = remaining;
    // Re-publish at most every 10 s while running (checkpoint cadence).
    if self.last_emit_remaining.saturating_sub(remaining) >= 10_000 {
      self.last_emit_remaining = remaining;
      return Some(self.state.clone());
    }
    None
  }

  pub fn take_persist_pending(&mut self) -> bool {
    std::mem::replace(&mut self.persist_pending, false)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn with_context(health: bool, run: impl FnOnce(&PomodoroContext)) {
    let settings = Settings::default();
    let tasks: Vec<Task> = Vec::new();
    let projects: Vec<Project> = Vec::new();
    let context = PomodoroContext { settings: &settings, tasks: &tasks, projects: &projects, health_break_active: health };
    run(&context)
  }

  #[test]
  fn start_validates_minutes_and_replaces() {
    with_context(false, |context| {
      let mut pomodoro = Pomodoro::from_persisted(None, &|_id| true);
      assert!(pomodoro.start(None, 0.5, false, context).is_err());
      assert!(pomodoro.start(None, 25.0, false, context).is_ok());
      assert_eq!(pomodoro.state().phase, "focus");
      // A running focus must be confirmed before it can be replaced.
      assert!(pomodoro.start(None, 25.0, false, context).is_err());
      assert!(pomodoro.start(None, 25.0, true, context).is_ok());
    });
  }

  #[test]
  fn focus_finishes_then_break_then_finished() {
    with_context(false, |context| {
      let mut pomodoro = Pomodoro::from_persisted(None, &|_id| true);
      pomodoro.start(None, 25.0, true, context).unwrap();
      let finished = pomodoro.tick(25 * 60_000, context).unwrap();
      assert_eq!(finished.phase, "focus-finished");
      assert!(!finished.running);
      let on_break = pomodoro.act("break", context).unwrap();
      assert_eq!(on_break.phase, "break");
      assert_eq!(on_break.remaining_ms, 5 * 60_000);
      let done = pomodoro.tick(5 * 60_000, context).unwrap();
      assert_eq!(done.phase, "break-finished");
    });
  }

  #[test]
  fn paused_countdown_does_not_advance() {
    with_context(false, |context| {
      let mut pomodoro = Pomodoro::from_persisted(None, &|_id| true);
      pomodoro.start(None, 25.0, true, context).unwrap();
      pomodoro.act("pause", context).unwrap();
      assert!(pomodoro.tick(60_000, context).is_none());
      assert_eq!(pomodoro.state().remaining_ms, 25 * 60_000);
    });
  }
}
