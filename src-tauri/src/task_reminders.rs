//! One-time task reminders. Queue an occurrence before invoking Windows, and
//! retain its outcome across restarts so a delivered reminder is not repeated.

use crate::fsutil::{read_json_checked, write_json_atomic};
use crate::types::{is_current_task, Project, Task};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Delivery {
  pub id: String,
  pub source: String,
  pub source_id: String,
  pub occurrence_at: u64,
  pub title: String,
  pub body: String,
  pub failed_at: Option<u64>,
  status: String,
}

#[derive(Serialize, Deserialize)]
struct Store {
  version: u8,
  deliveries: Vec<Delivery>,
}

pub struct TaskReminders {
  path: PathBuf,
  deliveries: Vec<Delivery>,
  attempted: HashSet<String>,
}

impl TaskReminders {
  pub fn load(data_dir: &Path) -> Result<Self, String> {
    let path = data_dir.join("task-reminders.json");
    let deliveries = match read_json_checked(&path)? {
      Some(value) => {
        let store: Store = serde_json::from_value(value)
          .map_err(|error| format!("任务提醒记录格式无效：{}", error))?;
        if store.version != 1 { return Err("任务提醒记录版本不受支持".into()); }
        store.deliveries
      }
      None => Vec::new(),
    };
    Ok(Self { path, deliveries, attempted: HashSet::new() })
  }

  fn save(&self, deliveries: &[Delivery]) -> Result<(), String> {
    let value = serde_json::to_value(Store { version: 1, deliveries: deliveries.to_vec() })
      .map_err(|error| format!("无法保存任务提醒：{}", error))?;
    write_json_atomic(&self.path, &value, false)
      .map_err(|error| format!("无法保存任务提醒：{}", error))
  }

  pub fn failed(&self) -> Vec<Delivery> {
    self.deliveries.iter().filter(|entry| entry.status == "failed").cloned().collect()
  }

  pub fn collect_due(&mut self, tasks: &[Task], projects: &[Project], now: u64) -> Result<(), String> {
    let mut next = self.deliveries.clone();
    // A changed time or a deleted task invalidates the old occurrence.
    next.retain(|entry| tasks.iter().any(|task|
      task.id == entry.source_id && task.reminder_at == Some(entry.occurrence_at)
    ));
    for task in tasks.iter().filter(|task|
      task.status == "open" && is_current_task(task, projects)
        && task.reminder_at.is_some_and(|at| at <= now)
    ) {
      let at = task.reminder_at.unwrap();
      if !next.iter().any(|entry| entry.source_id == task.id && entry.occurrence_at == at) {
        next.push(Delivery {
          id: format!("task:{}:{}", task.id, at),
          source: "task".into(),
          source_id: task.id.clone(),
          occurrence_at: at,
          title: "EyeProtect · 任务提醒".into(),
          body: format!("该处理：「{}」", task.title),
          failed_at: None,
          status: "pending".into(),
        });
      }
    }
    if serde_json::to_value(&next).ok() != serde_json::to_value(&self.deliveries).ok() {
      self.save(&next)?;
      self.deliveries = next;
      self.attempted.retain(|id| self.deliveries.iter().any(|entry| &entry.id == id));
    }
    Ok(())
  }

  pub fn dispatch(&mut self, tasks: &[Task], projects: &[Project], now: u64, mut send: impl FnMut(&Delivery) -> Result<(), String>) -> bool {
    let mut changed = false;
    let candidates: Vec<Delivery> = self.deliveries.iter().filter(|entry|
      entry.status == "pending" && !self.attempted.contains(&entry.id)
        && tasks.iter().any(|task| task.id == entry.source_id && task.reminder_at == Some(entry.occurrence_at)
          && task.status == "open" && is_current_task(task, projects))
    ).cloned().collect();
    for entry in candidates {
      self.attempted.insert(entry.id.clone());
      let result = send(&entry);
      let mut next = self.deliveries.clone();
      if let Some(item) = next.iter_mut().find(|item| item.id == entry.id) {
        item.status = if result.is_ok() { "sent" } else { "failed" }.into();
        item.failed_at = result.as_ref().err().map(|_| now);
      }
      if let Err(error) = self.save(&next) {
        // Avoid repeated popups in this process; the pending record remains
        // recoverable on disk and may be retried on the next launch.
        eprintln!("[task-reminder] {}", error);
      } else {
        self.deliveries = next;
        changed = true;
      }
      if let Err(error) = result {
        eprintln!("[task-reminder] notification failed: {}", error);
      }
    }
    changed
  }

  pub fn retry(&mut self, id: &str) -> Result<(), String> {
    let mut next = self.deliveries.clone();
    if let Some(entry) = next.iter_mut().find(|entry| entry.id == id && entry.status == "failed") {
      entry.status = "pending".into();
      entry.failed_at = None;
      self.save(&next)?;
      self.deliveries = next;
      self.attempted.remove(id);
    }
    Ok(())
  }

  pub fn dismiss(&mut self, id: &str) -> Result<(), String> {
    let mut next = self.deliveries.clone();
    if let Some(entry) = next.iter_mut().find(|entry| entry.id == id && entry.status == "failed") {
      entry.status = "dismissed".into();
      self.save(&next)?;
      self.deliveries = next;
    }
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::types::sanitize_task;
  use serde_json::json;

  #[test]
  fn reminders_survive_restart_dont_repeat_and_can_retry_failures() {
    let dir = std::env::temp_dir().join(format!("eyeprotect-reminder-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    let task = sanitize_task(&json!({"id":"a", "title":"任务", "reminderAt": 2000}), 1000).unwrap();
    let mut reminders = TaskReminders::load(&dir).unwrap();
    reminders.collect_due(&[task.clone()], &[], 1999).unwrap();
    assert!(!reminders.dispatch(&[task.clone()], &[], 1999, |_| panic!("not due")));
    reminders.collect_due(&[task.clone()], &[], 2000).unwrap();
    assert!(reminders.dispatch(&[task.clone()], &[], 2000, |_| Err("offline".into())));
    let id = reminders.failed()[0].id.clone();
    let mut restarted = TaskReminders::load(&dir).unwrap();
    assert_eq!(restarted.failed().len(), 1);
    restarted.retry(&id).unwrap();
    assert!(restarted.dispatch(&[task.clone()], &[], 3000, |_| Ok(())));
    let mut restarted = TaskReminders::load(&dir).unwrap();
    restarted.collect_due(&[task.clone()], &[], 4000).unwrap();
    assert!(!restarted.dispatch(&[task], &[], 4000, |_| panic!("already delivered")));
    std::fs::remove_file(dir.join("task-reminders.json")).unwrap();
    std::fs::remove_dir(dir).unwrap();
  }

  #[test]
  fn does_not_send_without_a_durable_pending_occurrence() {
    let dir = std::env::temp_dir().join(format!("eyeprotect-reminder-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    std::fs::create_dir(dir.join("task-reminders.json.tmp")).unwrap();
    let task = sanitize_task(&json!({"id":"a", "title":"任务", "reminderAt": 2000}), 1000).unwrap();
    let mut reminders = TaskReminders::load(&dir).unwrap();
    assert!(reminders.collect_due(&[task.clone()], &[], 2000).is_err());
    assert!(!reminders.dispatch(&[task], &[], 2000, |_| panic!("not persisted")));
    std::fs::remove_dir(dir.join("task-reminders.json.tmp")).unwrap();
    std::fs::remove_dir(dir).unwrap();
  }

  #[test]
  fn only_open_root_tasks_fire_and_a_changed_time_is_a_new_occurrence() {
    let dir = std::env::temp_dir().join(format!("eyeprotect-reminder-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    let root = sanitize_task(&json!({"id":"root", "title":"待办", "reminderAt": 2000}), 1000).unwrap();
    let done = sanitize_task(&json!({"id":"done", "title":"完成", "status":"done", "reminderAt": 2000}), 1000).unwrap();
    let step = sanitize_task(&json!({"id":"step", "title":"步骤", "parentId":"root", "reminderAt": 2000}), 1000).unwrap();
    let mut reminders = TaskReminders::load(&dir).unwrap();
    let tasks = vec![root.clone(), done, step];
    reminders.collect_due(&tasks, &[], 2000).unwrap();
    let mut sent = Vec::new();
    reminders.dispatch(&tasks, &[], 2000, |entry| { sent.push(entry.source_id.clone()); Ok(()) });
    assert_eq!(sent, vec!["root"]);
    let mut rescheduled = root;
    rescheduled.reminder_at = Some(3000);
    reminders.collect_due(&[rescheduled.clone()], &[], 3000).unwrap();
    reminders.dispatch(&[rescheduled], &[], 3000, |entry| { sent.push(entry.source_id.clone()); Ok(()) });
    assert_eq!(sent, vec!["root", "root"]);
    std::fs::remove_file(dir.join("task-reminders.json")).unwrap();
    std::fs::remove_dir(dir).unwrap();
  }
}
