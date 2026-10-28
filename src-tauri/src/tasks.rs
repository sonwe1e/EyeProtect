//! Task domain — port of the simple-mode surface of `src/main/taskStore.ts` +
//! `src/main/taskService.ts` (production wiring: `legacy_recurrence = false`,
//! fresh JSON storage instead of SQLite).
//!
//! Observable contracts preserved from the Electron app:
//! - `revision` bumps on every persisted edit; `baseRevision` mismatch rejects
//!   with the same stale-write message.
//! - queue reorders persist `sortOrder` (index × 10) WITHOUT touching
//!   `revision`/`updatedAt` (an open drawer must not become a stale write).
//! - undo windows live 10 s; undo restores whole trees and the previous
//!   active-task pointer.
//! - root tasks with open steps refuse `done`; the restore path is the single
//!   escape hatch out of read-only lists.

use crate::types::{
  is_current_task, is_project_writable, order_simple_queue, sanitize_project, sanitize_task, task_steps,
  Project, Task, TASK_STALE_WRITE_MESSAGE, UndoState,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

pub const UNDO_WINDOW_MS: u64 = 10_000;

#[derive(Debug, Clone)]
pub struct TaskPatch {
  pub title: Option<String>,
  /// `Some(None)` clears the field; `None` leaves it untouched.
  pub notes: Option<Option<String>>,
  pub project_id: Option<Option<String>>,
  pub due_date: Option<Option<String>>,
  pub reminder_at: Option<Option<u64>>,
  pub priority: Option<String>,
  pub sort_order: Option<i64>,
  pub base_revision: Option<u64>,
}

impl TaskPatch {
  /// Whitelist + null-vs-absent coercion (mirrors ipcTaskInput.ts).
  pub fn from_simple_update(value: &Value) -> Result<TaskPatch, String> {
    let obj = match value.as_object() {
      Some(obj) => obj,
      None => return Ok(TaskPatch {
        title: None, notes: None, project_id: None, due_date: None,
        reminder_at: None, priority: None, sort_order: None, base_revision: None,
      }),
    };
    let mut patch = TaskPatch {
      title: None, notes: None, project_id: None, due_date: None,
      reminder_at: None, priority: None, sort_order: None, base_revision: None,
    };
    if let Some(Value::String(title)) = obj.get("title") {
      if title.trim().is_empty() {
        return Err("请输入任务名称".into());
      }
      patch.title = Some(title.clone());
    }
    match obj.get("notes") {
      Some(Value::String(notes)) => patch.notes = Some(Some(notes.clone())),
      Some(Value::Null) => patch.notes = Some(None),
      _ => {}
    }
    match obj.get("projectId") {
      Some(Value::String(id)) => patch.project_id = Some(Some(id.clone())),
      Some(Value::Null) => patch.project_id = Some(None),
      _ => {}
    }
    match obj.get("dueDate") {
      Some(Value::String(key)) => {
        if !crate::types::is_local_date_key(key) {
          return Err("截止日期无效".into());
        }
        patch.due_date = Some(Some(key.clone()));
      }
      Some(Value::Null) => patch.due_date = Some(None),
      _ => {}
    }
    match obj.get("reminderAt") {
      Some(Value::Number(number)) => {
        let Some(value) = number.as_f64() else { return Err("参数无效".into()) };
        if !value.is_finite() || value < 0.0 {
          return Err("参数无效".into());
        }
        patch.reminder_at = Some(Some(value as u64));
      }
      Some(Value::Null) => patch.reminder_at = Some(None),
      _ => {}
    }
    if let Some(Value::String(priority)) = obj.get("priority") {
      if ["normal", "important", "urgent"].contains(&priority.as_str()) {
        patch.priority = Some(priority.clone());
      }
    }
    if let Some(Value::Number(number)) = obj.get("sortOrder") {
      if let Some(value) = number.as_i64() {
        if value >= 0 {
          patch.sort_order = Some(value);
        }
      }
    }
    if let Some(Value::Number(number)) = obj.get("baseRevision") {
      if let Some(value) = number.as_u64() {
        if value >= 1 {
          patch.base_revision = Some(value);
        }
      }
    }
    Ok(patch)
  }
}

/// Whitelist for the simple create form (mirrors `asSimpleTaskInput`).
pub struct SimpleCreateInput {
  pub title: String,
  pub notes: Option<String>,
  pub project_id: Option<String>,
  pub due_date: Option<String>,
  pub reminder_at: Option<u64>,
}

impl SimpleCreateInput {
  pub fn from_value(value: &Value) -> Result<SimpleCreateInput, String> {
    let obj = value.as_object().cloned().unwrap_or_default();
    let due_date = match obj.get("dueDate") {
      Some(Value::String(key)) => {
        if !crate::types::is_local_date_key(key) {
          return Err("截止日期无效".into());
        }
        Some(key.clone())
      }
      _ => None,
    };
    let reminder_at = match obj.get("reminderAt") {
      Some(Value::Number(number)) => {
        let value = number.as_f64().filter(|n| n.is_finite() && *n >= 0.0).map(|n| n as u64);
        // Absent and null both mean "no reminder".
        if obj.get("reminderAt").is_some() && value.is_none() {
          return Err("参数无效".into());
        }
        value
      }
      _ => None,
    };
    Ok(SimpleCreateInput {
      title: obj.get("title").and_then(Value::as_str).unwrap_or("").to_string(),
      notes: match obj.get("notes") {
        Some(Value::String(notes)) => Some(notes.clone()),
        _ => None,
      },
      project_id: match obj.get("projectId") {
        Some(Value::String(id)) => Some(id.clone()),
        _ => None,
      },
      due_date,
      reminder_at,
    })
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UndoRecord {
  operation_id: String,
  kind: String,
  task_title: String,
  expires_at: u64,
  tasks: Vec<Task>,
  remove_ids: Vec<String>,
  active_task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStoreFile {
  pub version: u64,
  pub tasks: Vec<Task>,
  pub projects: Vec<Project>,
  #[serde(default)]
  pub active_task_id: Option<String>,
}

#[derive(Default)]
pub struct TaskEffects {
  pub upserted: Vec<Task>,
  pub removed: Vec<String>,
  /// Full-list replacement (undo): broadcast `task:changed`.
  pub replaced: bool,
  pub projects_upserted: Vec<Project>,
  pub projects_removed: Vec<String>,
  pub projects_replaced: bool,
  pub undo: Option<UndoState>,
  pub task_completed: bool,
}

impl TaskEffects {
  pub fn append(&mut self, mut other: TaskEffects) {
    self.upserted.append(&mut other.upserted);
    self.removed.append(&mut other.removed);
    self.replaced |= other.replaced;
    self.projects_upserted.append(&mut other.projects_upserted);
    self.projects_removed.append(&mut other.projects_removed);
    self.projects_replaced |= other.projects_replaced;
    if other.undo.is_some() {
      self.undo = other.undo;
    }
    self.task_completed |= other.task_completed;
  }
}

#[derive(Clone)]
pub struct TaskCore {
  pub tasks: Vec<Task>,
  pub projects: Vec<Project>,
  pub active_task_id: Option<String>,
  undo: Vec<UndoRecord>,
  pub persist_pending: bool,
}

impl TaskCore {
  pub fn new() -> TaskCore {
    TaskCore { tasks: Vec::new(), projects: Vec::new(), active_task_id: None, undo: Vec::new(), persist_pending: false }
  }

  pub fn load_from(value: Option<Value>, now: u64) -> TaskCore {
    let mut core = TaskCore::new();
    if let Some(value) = value {
      let mut tasks = Vec::new();
      if let Some(list) = value.get("tasks").and_then(Value::as_array) {
        for entry in list {
          if let Some(task) = sanitize_task(entry, now) {
            tasks.push(task);
          }
        }
      }
      let mut projects = Vec::new();
      if let Some(list) = value.get("projects").and_then(Value::as_array) {
        for entry in list {
          if let Some(project) = sanitize_project(entry, now) {
            projects.push(project);
          }
        }
      }
      core.active_task_id = match value.get("activeTaskId") {
        Some(Value::String(id)) if !id.is_empty() => Some(id.clone()),
        _ => None,
      };
      core.tasks = tasks;
      core.projects = projects;
    }
    core.validate_active();
    core
  }

  pub fn load_checked(value: Option<Value>, now: u64) -> Result<TaskCore, String> {
    if let Some(value) = &value {
      if value.get("version").and_then(Value::as_u64) != Some(1) {
        return Err("任务数据版本无效".into());
      }
      let tasks = value.get("tasks").and_then(Value::as_array).ok_or("任务数据格式无效")?;
      let projects = value.get("projects").and_then(Value::as_array).ok_or("清单数据格式无效")?;
      if tasks.iter().any(|entry| sanitize_task(entry, now).is_none())
        || projects.iter().any(|entry| sanitize_project(entry, now).is_none()) {
        return Err("任务或清单数据包含无法读取的记录".into());
      }
    }
    Ok(TaskCore::load_from(value, now))
  }

  /// Replace the whole domain (backup import / reset): rows are pre-sanitized
  /// by the caller; the active-task pointer only survives if it still lands on
  /// a live open task.
  pub fn from_parts(tasks: Vec<Task>, projects: Vec<Project>, active_task_id: Option<String>) -> TaskCore {
    let mut core = TaskCore::new();
    core.tasks = tasks;
    core.projects = projects;
    core.active_task_id = active_task_id.filter(|id| !id.is_empty());
    core.validate_active();
    core.persist_pending = true;
    core
  }

  pub fn to_file(&self) -> TaskStoreFile {
    TaskStoreFile {
      version: 1,
      tasks: self.tasks.clone(),
      projects: self.projects.clone(),
      active_task_id: self.active_task_id.clone(),
    }
  }

  /// Persist the candidate before exposing its state or events to the UI.
  pub fn transact<T>(
    &mut self,
    path: &Path,
    operation: impl FnOnce(&mut TaskCore, &mut TaskEffects) -> Result<T, String>,
  ) -> Result<(T, TaskEffects), String> {
    let mut candidate = self.clone();
    let mut effects = TaskEffects::default();
    let result = operation(&mut candidate, &mut effects)?;
    if candidate.persist_pending {
      let value = serde_json::to_value(candidate.to_file())
        .map_err(|error| format!("无法保存待办：{}", error))?;
      crate::fsutil::write_json_atomic(path, &value, false)
        .map_err(|error| format!("无法保存待办：{}", error))?;
      candidate.persist_pending = false;
    }
    *self = candidate;
    Ok((result, effects))
  }

    fn validate_active(&mut self) {
        if let Some(id) = self.active_task_id.clone() {
            let valid = self
                .tasks
                .iter()
                .any(|task| task.id == id && task.status != "done" && task.status != "archived");
            if !valid {
                self.active_task_id = None;
            }
        }
    }

  pub fn get_task(&self, id: &str) -> Option<&Task> {
    self.tasks.iter().find(|task| task.id == id)
  }

  pub fn get_project(&self, id: &str) -> Option<&Project> {
    self.projects.iter().find(|project| project.id == id)
  }

  fn next_sort_order(&self) -> i64 {
    self.tasks.iter().map(|task| task.sort_order).max().unwrap_or(0) + 1
  }

  fn next_project_sort_order(&self) -> i64 {
    self.projects.iter().map(|project| project.sort_order).max().unwrap_or(-1) + 1
  }

  fn mark_persist(&mut self) {
    self.persist_pending = true;
  }

  // ── Task operations ───────────────────────────────────────────────────────

  pub fn create_task(&mut self, input: &SimpleCreateInput, now: u64, effects: &mut TaskEffects) -> Task {
    let title = if input.title.trim().is_empty() { "(untitled)".to_string() } else { input.title.clone() };
    let seed = serde_json::json!({
      "id": uuid::Uuid::new_v4().to_string(),
      "title": title,
      "notes": input.notes,
      "projectId": input.project_id,
      "dueDate": input.due_date,
      "reminderAt": input.reminder_at,
      "sortOrder": self.next_sort_order(),
      "createdAt": now,
      "updatedAt": now,
    });
    let task = sanitize_task(&seed, now).expect("seeded task is valid");
    self.tasks.push(task.clone());
    self.mark_persist();
    effects.upserted.push(task.clone());
    task
  }

  /// Raw field update with revision bump + stale-write guard. Returns false
  /// when the id is unknown (mirrors the store's null pass-through).
  fn apply_update(
    &mut self,
    id: &str,
    patch: &TaskPatch,
    now: u64,
    effects: &mut TaskEffects,
  ) -> bool {
    let Some(index) = self.tasks.iter().position(|task| task.id == id) else { return false };
    if let Some(base) = patch.base_revision {
      if base != self.tasks[index].revision {
        // Stale write: reject without touching anything.
        return false;
      }
    }
    let current = self.tasks[index].clone();
    let mut seed = serde_json::to_value(&current).unwrap_or(Value::Null);
    let obj = seed.as_object_mut().expect("task serializes to an object");
    if let Some(title) = &patch.title {
      obj.insert("title".into(), Value::String(title.clone()));
    }
    if let Some(notes) = &patch.notes {
      obj.insert("notes".into(), notes.clone().map(Value::String).unwrap_or(Value::Null));
    }
    if let Some(project_id) = &patch.project_id {
      obj.insert("projectId".into(), project_id.clone().map(Value::String).unwrap_or(Value::Null));
    }
    if let Some(due_date) = &patch.due_date {
      obj.insert("dueDate".into(), due_date.clone().map(Value::String).unwrap_or(Value::Null));
    }
    if let Some(reminder_at) = &patch.reminder_at {
      obj.insert("reminderAt".into(), reminder_at.map(|v| Value::Number(v.into())).unwrap_or(Value::Null));
    }
    if let Some(priority) = &patch.priority {
      obj.insert("priority".into(), Value::String(priority.clone()));
    }
    if let Some(sort_order) = patch.sort_order {
      obj.insert("sortOrder".into(), Value::Number(sort_order.into()));
    }
    obj.insert("updatedAt".into(), Value::Number(now.into()));
    obj.insert("revision".into(), Value::Number((current.revision + 1).into()));
    let Some(mut next) = sanitize_task(&seed, now) else { return false };
    // sanitize drops a null title; keep identity fields from the current row.
    next.id = current.id.clone();
    next.status = current.status.clone();
    next.completed_at = current.completed_at;
    next.created_at = current.created_at;
    if next.revision <= current.revision {
      next.revision = current.revision + 1;
    }
    // A done/archived task loses any active-task claim.
    if next.status == "done" || next.status == "archived" {
      if self.active_task_id.as_deref() == Some(next.id.as_str()) {
        self.active_task_id = None;
      }
    }
    self.tasks[index] = next.clone();
    self.mark_persist();
    effects.upserted.push(next);
    true
  }

  /// `task:update` — simple whitelist edit (status handled separately).
  pub fn update_task(
    &mut self,
    id: &str,
    patch: &TaskPatch,
    now: u64,
    effects: &mut TaskEffects,
  ) -> Result<(), String> {
    let Some(before) = self.get_task(id).cloned() else { return Ok(()) };
    if let Some(base) = patch.base_revision {
      if base != before.revision {
        return Err(TASK_STALE_WRITE_MESSAGE.into());
      }
    }
    if before.project_id.is_some() {
      let project = self.get_project(before.project_id.as_deref().unwrap());
      if !is_project_writable(project) {
        return Err("清单只读".into());
      }
    }
    let applied = self.apply_update(id, patch, now, effects);
    if !applied {
      return Ok(());
    }
    // Only a REAL list move rehomes the steps (same-value resaves must not
    // bump step revisions).
    if before.parent_id.is_none() {
      if let Some(next_project) = patch.project_id.clone() {
        if next_project != before.project_id {
          let step_ids: Vec<String> = task_steps(id, &self.tasks).iter().map(|t| t.id.clone()).collect();
          for step_id in step_ids {
            let step = self.get_task(&step_id).cloned();
            if let Some(step) = step {
              if step.project_id != next_project {
                let patch = TaskPatch {
                  title: None, notes: None, project_id: Some(next_project.clone()),
                  due_date: None, reminder_at: None, priority: None,
                  sort_order: None, base_revision: None,
                };
                self.apply_update(&step_id, &patch, now, effects);
              }
            }
          }
        }
      }
    }
    Ok(())
  }

  /// `task:set-status` — transitions with undo + recurrence-free guards.
  pub fn set_task_status(
    &mut self,
    id: &str,
    status: &str,
    now: u64,
    effects: &mut TaskEffects,
  ) -> Result<(), String> {
    let status = match status {
      "open" | "done" | "archived" => status,
      _ => "open",
    };
    let Some(task) = self.get_task(id).cloned() else { return Ok(()) };
    if status == "done" && task.parent_id.is_none() {
      let steps_open = task_steps(id, &self.tasks).iter().any(|step| step.status == "open");
      if steps_open {
        return Err("请确认连同步骤完成主任务".into());
      }
    }
    if let Some(project_id) = &task.project_id {
      let project = self.get_project(project_id);
      if !is_project_writable(project) {
        return Err("项目已完成、归档或不存在，无法修改任务状态".into());
      }
    }
    let was_done = task.status == "done";
    if status == task.status {
      return Ok(());
    }
    // Status rides on the raw row so it never enters the simple whitelist.
    {
      let index = self.tasks.iter().position(|t| t.id == id).unwrap();
      self.tasks[index].status = status.to_string();
      self.tasks[index].updated_at = now;
      self.tasks[index].revision += 1;
      self.tasks[index].completed_at = if status == "done" { self.tasks[index].completed_at.or(Some(now)) } else { None };
      if status == "done" || status == "archived" {
        if self.active_task_id.as_deref() == Some(id) {
          self.active_task_id = None;
        }
      }
      effects.upserted.push(self.tasks[index].clone());
      self.mark_persist();
    }
    if status == "done" && !was_done {
      let previous_active = self.active_task_id.clone();
      let title = task.title.clone();
      self.create_undo("complete", &title, vec![task], Vec::new(), previous_active, now, effects);
      effects.task_completed = true;
    }
    self.validate_active();
    Ok(())
  }

  /// `task:complete-tree` — atomic root + open steps completion with revision
  /// cross-check (the bubble and the row checkbox both use this path).
  pub fn complete_task_tree(
    &mut self,
    id: &str,
    revisions: &HashMap<String, u64>,
    now: u64,
    effects: &mut TaskEffects,
  ) -> Result<(), String> {
    let Some(root) = self.get_task(id).cloned() else {
      return Err("任务已变更，请刷新后重试".into());
    };
    if root.parent_id.is_some() || root.status != "open" {
      return Err("任务已变更，请刷新后重试".into());
    }
    if let Some(project_id) = &root.project_id {
      if !is_project_writable(self.get_project(project_id)) {
        return Err("清单只读".into());
      }
    }
    let mut affected: Vec<Task> = vec![root.clone()];
    for step in task_steps(id, &self.tasks) {
      if step.status == "open" {
        affected.push(step.clone());
      }
    }
    if revisions.len() != affected.len() || affected.iter().any(|task| revisions.get(&task.id) != Some(&task.revision)) {
      return Err(TASK_STALE_WRITE_MESSAGE.into());
    }
    let previous_active = self.active_task_id.clone();
    let ids: Vec<String> = affected.iter().map(|task| task.id.clone()).collect();
    for task_id in &ids {
      let index = self.tasks.iter().position(|t| t.id == *task_id).unwrap();
      self.tasks[index].status = "done".into();
      self.tasks[index].updated_at = now;
      self.tasks[index].revision += 1;
      self.tasks[index].completed_at = self.tasks[index].completed_at.or(Some(now));
      if self.active_task_id.as_deref() == Some(task_id.as_str()) {
        self.active_task_id = None;
      }
      effects.upserted.push(self.tasks[index].clone());
    }
    self.mark_persist();
    self.create_undo("complete", &root.title, affected, Vec::new(), previous_active, now, effects);
    effects.task_completed = true;
    Ok(())
  }

  /// `task:move-step` — swap with the adjacent sibling, rewrite ×10 spacing.
  pub fn move_step(&mut self, id: &str, direction: i32, now: u64, effects: &mut TaskEffects) -> Result<(), String> {
    let Some(step) = self.get_task(id).cloned() else {
      return Err("只能调整步骤顺序".into());
    };
    let Some(parent_id) = step.parent_id.clone() else {
      return Err("只能调整步骤顺序".into());
    };
    if let Some(project_id) = &step.project_id {
      if !is_project_writable(self.get_project(project_id)) {
        return Err("清单只读".into());
      }
    }
    let mut siblings: Vec<Task> = self
      .tasks
      .iter()
      .filter(|task| task.parent_id.as_deref() == Some(parent_id.as_str()))
      .cloned()
      .collect();
    siblings.sort_by(|a, b| a.sort_order.cmp(&b.sort_order).then(a.created_at.cmp(&b.created_at)));
    let index = siblings.iter().position(|task| task.id == id);
    let Some(index) = index else { return Ok(()) };
    let other = index as i32 + direction;
    if other < 0 || other as usize >= siblings.len() {
      return Ok(());
    }
    siblings.swap(index, other as usize);
    for (order, task) in siblings.iter().enumerate() {
      let patch = TaskPatch {
        title: None, notes: None, project_id: None, due_date: None, reminder_at: None,
        priority: None, sort_order: Some((order * 10) as i64), base_revision: None,
      };
      self.apply_update(&task.id, &patch, now, effects);
    }
    Ok(())
  }

  /// `task:create-step` — one level under an open root.
  pub fn create_step(&mut self, root_id: &str, title: &str, now: u64, effects: &mut TaskEffects) -> Result<(), String> {
    let Some(root) = self.get_task(root_id).cloned() else {
      return Err("只能为未完成主任务添加步骤".into());
    };
    if root.parent_id.is_some() || root.status != "open" {
      return Err("只能为未完成主任务添加步骤".into());
    }
    if let Some(project_id) = &root.project_id {
      if !is_project_writable(self.get_project(project_id)) {
        return Err("清单只读".into());
      }
    }
    let input = SimpleCreateInput {
      title: title.to_string(),
      notes: None,
      project_id: root.project_id.clone(),
      due_date: None,
      reminder_at: None,
    };
    let mut step = self.create_task(&input, now, effects);
    if let Some(index) = self.tasks.iter().position(|t| t.id == step.id) {
      self.tasks[index].parent_id = Some(root_id.to_string());
      self.tasks[index].context = "desk".into();
      self.tasks[index].remind_on_break = false;
      step = self.tasks[index].clone();
      self.mark_persist();
      effects.upserted.push(step);
    }
    Ok(())
  }

  /// `task:restore-legacy` — completion-record restore; the one path allowed
  /// to move a task out of a read-only list.
  pub fn restore_task(&mut self, id: &str, now: u64, effects: &mut TaskEffects) -> Result<(), String> {
    let Some(before) = self.get_task(id).cloned() else { return Ok(()) };
    let project = before.project_id.as_deref().and_then(|pid| self.get_project(pid));
    let list_is_live = matches!(project.map(|p| p.status.as_str()), Some("active") | Some("onHold"));
    let next_project_id = match (&before.project_id, list_is_live) {
      (Some(pid), true) => Some(pid.clone()),
      _ => None,
    };
    if next_project_id != before.project_id {
      let patch = TaskPatch {
        title: None, notes: None, project_id: Some(next_project_id.clone()), due_date: None,
        reminder_at: None, priority: None, sort_order: None, base_revision: None,
      };
      self.apply_update(id, &patch, now, effects);
      let step_ids: Vec<String> = task_steps(id, &self.tasks).iter().map(|t| t.id.clone()).collect();
      for step_id in step_ids {
        let patch = TaskPatch {
          title: None, notes: None, project_id: Some(next_project_id.clone()), due_date: None,
          reminder_at: None, priority: None, sort_order: None, base_revision: None,
        };
        self.apply_update(&step_id, &patch, now, effects);
      }
    }
    self.set_task_status(id, "open", now, effects)
  }

  /// `task:delete` — removes the whole tree with a 10 s undo snapshot.
  pub fn delete_task(&mut self, id: &str, now: u64, effects: &mut TaskEffects) {
    let Some(task) = self.get_task(id).cloned() else { return };
    let previous_active = self.active_task_id.clone();
    // Collect the descendant closure BEFORE removing (undo needs the rows).
    let mut ids: Vec<String> = vec![id.to_string()];
    let mut changed = true;
    while changed {
      changed = false;
      for entry in &self.tasks {
        if let Some(parent) = &entry.parent_id {
          if ids.contains(parent) && !ids.contains(&entry.id) {
            ids.push(entry.id.clone());
            changed = true;
          }
        }
      }
    }
    let removed: Vec<Task> = self.tasks.iter().filter(|t| ids.contains(&t.id)).cloned().collect();
    self.tasks.retain(|t| !ids.contains(&t.id));
    if self.active_task_id.as_deref().map(|a| ids.iter().any(|id| id == a)).unwrap_or(false) {
      self.active_task_id = None;
    }
    for task_id in &ids {
      effects.removed.push(task_id.clone());
    }
    self.mark_persist();
    self.create_undo("delete", &task.title, removed, Vec::new(), previous_active, now, effects);
  }

  /// `task:move` — sibling reorder within one container (index spacing 0..n).
  pub fn move_task(
    &mut self,
    task_id: &str,
    before_task_id: Option<&str>,
    scope_project: Option<&str>,
    now: u64,
    effects: &mut TaskEffects,
  ) {
    let in_container = |task: &Task| -> bool {
      task.status == "open"
        && match scope_project {
          None => task.project_id.is_none(),
          Some(project_id) => task.project_id.as_deref() == Some(project_id),
        }
    };
    let Some(task) = self.get_task(task_id).cloned() else { return };
    if !in_container(&task) {
      return;
    }
    let parent = task.parent_id.clone();
    let mut ordered: Vec<Task> = self
      .tasks
      .iter()
      .filter(|t| in_container(t) && t.parent_id == parent)
      .cloned()
      .collect();
    ordered.sort_by(|a, b| a.sort_order.cmp(&b.sort_order).then(a.created_at.cmp(&b.created_at)));
    let rest: Vec<Task> = ordered.iter().filter(|t| t.id != task_id).cloned().collect();
    let insert_at = match before_task_id {
      None => rest.len(),
      Some(before_id) => match rest.iter().position(|t| t.id == before_id) {
        Some(index) => index,
        None => return,
      },
    };
    let mut final_order = rest;
    final_order.insert(insert_at, task);
    for (index, entry) in final_order.into_iter().enumerate() {
      let patch = TaskPatch {
        title: None, notes: None, project_id: None, due_date: None, reminder_at: None,
        priority: None, sort_order: Some(index as i64), base_revision: None,
      };
      self.apply_update(&entry.id, &patch, now, effects);
    }
  }

  /// `task:reorder-queue` — whole-queue rewrite; validates every id first.
  pub fn reorder_queue(&mut self, ids: &[String], now: u64, effects: &mut TaskEffects) -> Result<(), String> {
    let mut listed = std::collections::HashSet::new();
    for id in ids {
      if !listed.insert(id.clone()) {
        return Err("顺序里有重复项".into());
      }
      let Some(task) = self.get_task(id) else {
        return Err("任务不存在".into());
      };
      if task.parent_id.is_some() {
        return Err("只能调整主任务顺序".into());
      }
      if task.status != "open" {
        return Err("只能调整未完成任务顺序".into());
      }
      if let Some(project_id) = &task.project_id {
        if !is_project_writable(self.get_project(project_id)) {
          return Err("清单只读".into());
        }
      }
    }
    // Unlisted open roots keep their current relative order at the tail.
    let mut tail: Vec<Task> = self
      .tasks
      .iter()
      .filter(|task| task.status == "open" && !listed.contains(&task.id) && is_current_task(task, &self.projects))
      .cloned()
      .collect();
    order_simple_queue(&mut tail);
    let full_order: Vec<String> = ids.iter().cloned().chain(tail.iter().map(|t| t.id.clone())).collect();
    // Persist sortOrder only — never revision/updatedAt (a reorder is not an
    // edit; an open drawer must not become a stale write).
    let mut changed = false;
    for (index, id) in full_order.into_iter().enumerate() {
      let sort_order = (index * 10) as i64;
      if let Some(task) = self.tasks.iter_mut().find(|t| t.id == id) {
        if task.sort_order != sort_order {
          task.sort_order = sort_order;
          changed = true;
          effects.upserted.push(task.clone());
        }
      }
    }
    if changed {
      self.mark_persist();
    }
    let _ = now;
    Ok(())
  }

  pub fn set_active_task(&mut self, id: Option<&str>) {
    let valid = id.filter(|id| {
      self
        .tasks
        .iter()
        .any(|task| task.id == *id && task.status != "done" && task.status != "archived")
    });
    self.active_task_id = valid.map(str::to_string);
    self.mark_persist();
  }

  // ── Undo ──────────────────────────────────────────────────────────────────

  fn purge_expired_undo(&mut self, now: u64) {
    let before = self.undo.len();
    self.undo.retain(|record| record.expires_at >= now);
    if self.undo.len() != before {
      self.mark_persist();
    }
  }

  #[allow(clippy::too_many_arguments)]
  fn create_undo(
    &mut self,
    kind: &str,
    task_title: &str,
    tasks: Vec<Task>,
    remove_ids: Vec<String>,
    active_task_id: Option<String>,
    now: u64,
    effects: &mut TaskEffects,
  ) {
    self.purge_expired_undo(now);
    let record = UndoRecord {
      operation_id: uuid::Uuid::new_v4().to_string(),
      kind: kind.to_string(),
      task_title: task_title.to_string(),
      expires_at: now + UNDO_WINDOW_MS,
      tasks,
      remove_ids,
      active_task_id,
    };
    effects.undo = Some(UndoState {
      operation_id: record.operation_id.clone(),
      kind: record.kind.clone(),
      task_title: record.task_title.clone(),
      expires_at: record.expires_at,
    });
    self.undo.push(record);
    self.mark_persist();
  }

  pub fn undo_state(&mut self, now: u64) -> Option<UndoState> {
    self.purge_expired_undo(now);
    self.undo
      .iter()
      .filter(|record| record.expires_at >= now)
      .max_by_key(|record| record.expires_at)
      .map(|record| UndoState {
        operation_id: record.operation_id.clone(),
        kind: record.kind.clone(),
        task_title: record.task_title.clone(),
        expires_at: record.expires_at,
      })
  }

  /// Undo restores/removes whole trees — the caller broadcasts the full list.
  pub fn undo(&mut self, operation_id: &str, now: u64, effects: &mut TaskEffects) -> bool {
    let Some(index) = self.undo.iter().position(|record| record.operation_id == operation_id) else {
      self.purge_expired_undo(now);
      return false;
    };
    if self.undo[index].expires_at < now {
      self.purge_expired_undo(now);
      return false;
    }
    let record = self.undo.remove(index);
    for id in &record.remove_ids {
      self.tasks.retain(|t| &t.id != id);
      effects.removed.push(id.clone());
    }
    for task in &record.tasks {
      // Restore exactly as snapshotted (same revision, same dates).
      match self.tasks.iter().position(|t| t.id == task.id) {
        Some(index) => self.tasks[index] = task.clone(),
        None => self.tasks.push(task.clone()),
      }
      effects.upserted.push(task.clone());
    }
    if let Some(active) = &record.active_task_id {
      if self.tasks.iter().any(|t| &t.id == active) {
        self.active_task_id = Some(active.clone());
      }
    }
    effects.replaced = true;
    self.mark_persist();
    self.validate_active();
    true
  }

  // ── Projects ──────────────────────────────────────────────────────────────

  pub fn create_project(&mut self, value: &Value, now: u64, effects: &mut TaskEffects) -> Result<(), String> {
    let name = value.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if name.is_empty() {
      return Err("请输入清单名称".into());
    }
    let seed = serde_json::json!({
      "id": uuid::Uuid::new_v4().to_string(),
      "name": name,
      "status": value.get("status").cloned().unwrap_or(Value::String("active".into())),
      "sortOrder": self.next_project_sort_order(),
      "createdAt": now,
      "updatedAt": now,
    });
    let Some(project) = sanitize_project(&seed, now) else {
      return Err("请输入清单名称".into());
    };
    self.projects.push(project.clone());
    self.mark_persist();
    effects.projects_upserted.push(project.clone());
    effects.projects_replaced = true;
    Ok(())
  }

  pub fn update_project(&mut self, id: &str, value: &Value, now: u64, effects: &mut TaskEffects) -> Result<(), String> {
    let Some(current) = self.get_project(id).cloned() else { return Ok(()) };
    let mut seed = serde_json::to_value(&current).unwrap_or(Value::Null);
    let obj = seed.as_object_mut().expect("project serializes to an object");
    if let Some(Value::String(name)) = value.get("name") {
      if name.trim().is_empty() {
        return Err("请输入清单名称".into());
      }
      obj.insert("name".into(), Value::String(name.clone()));
    }
    if let Some(status) = value.get("status").and_then(Value::as_str) {
      if ["active", "onHold", "completed", "archived"].contains(&status) {
        obj.insert("status".into(), Value::String(status.to_string()));
      }
    }
    obj.insert("updatedAt".into(), Value::Number(now.into()));
    let Some(next) = sanitize_project(&seed, now) else { return Ok(()) };
    if let Some(index) = self.projects.iter().position(|p| p.id == id) {
      self.projects[index] = next.clone();
    }
    self.mark_persist();
    effects.projects_upserted.push(next);
    effects.projects_replaced = true;
    Ok(())
  }

  pub fn delete_project(&mut self, id: &str, now: u64, effects: &mut TaskEffects) {
    if self.get_project(id).is_none() {
      return;
    }
    let detached: Vec<Task> = self.tasks.iter().filter(|t| t.project_id.as_deref() == Some(id)).cloned().collect();
    self.tasks.iter_mut().for_each(|task| {
      if task.project_id.as_deref() == Some(id) {
        task.project_id = None;
        task.updated_at = now;
        task.revision += 1;
      }
    });
    self.projects.retain(|p| p.id != id);
    self.mark_persist();
    effects.projects_removed.push(id.to_string());
    effects.projects_replaced = true;
    for task in detached {
      if let Some(fresh) = self.get_task(&task.id) {
        effects.upserted.push(fresh.clone());
      }
    }
    self.validate_active();
  }

  pub fn take_persist_pending(&mut self) -> bool {
    std::mem::replace(&mut self.persist_pending, false)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn core() -> TaskCore {
    TaskCore::new()
  }

  fn create_root(core: &mut TaskCore, title: &str) -> Task {
    let input = SimpleCreateInput { title: title.into(), notes: None, project_id: None, due_date: None, reminder_at: None };
    let mut effects = TaskEffects::default();
    core.create_task(&input, 1_000, &mut effects)
  }

  #[test]
  fn transaction_keeps_state_and_existing_file_when_write_fails() {
    let dir = std::env::temp_dir().join(format!("eyeprotect-task-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    let path = dir.join("tasks.json");
    let mut tasks = core();
    let input = SimpleCreateInput { title: "保留".into(), notes: None, project_id: None, due_date: None, reminder_at: None };
    tasks.transact(&path, |candidate, effects| {
      candidate.create_task(&input, 1_000, effects);
      Ok(())
    }).unwrap();
    let before = std::fs::read(&path).unwrap();
    // Occupy the temporary filename so a new write fails while the old file
    // is still present. The transaction must not publish its candidate.
    let tmp = dir.join("tasks.json.tmp");
    std::fs::create_dir(&tmp).unwrap();
    let result = tasks.transact(&path, |candidate, effects| {
      candidate.create_task(&input, 2_000, effects);
      Ok(())
    });
    assert!(result.is_err());
    assert_eq!(tasks.tasks.len(), 1);
    assert_eq!(std::fs::read(&path).unwrap(), before);
    std::fs::remove_dir(&tmp).unwrap();
    std::fs::remove_file(&path).unwrap();
    std::fs::remove_dir(&dir).unwrap();
  }

  #[test]
  fn load_rejects_a_damaged_store_instead_of_silently_dropping_rows() {
    let invalid = serde_json::json!({"version": 1, "tasks": [{"id": "broken"}], "projects": []});
    assert!(TaskCore::load_checked(Some(invalid), 1_000).is_err());
    let valid = serde_json::json!({"version": 1, "tasks": [{"id": "ok", "title": "保留"}], "projects": []});
    assert_eq!(TaskCore::load_checked(Some(valid), 1_000).unwrap().tasks.len(), 1);
  }

  #[test]
  fn stale_write_is_rejected_by_base_revision() {
    let mut core = core();
    let task = create_root(&mut core, "draft");
    let patch = TaskPatch {
      title: Some("v2".into()), notes: None, project_id: None, due_date: None,
      reminder_at: None, priority: None, sort_order: None, base_revision: Some(task.revision + 5),
    };
    let mut effects = TaskEffects::default();
    assert!(core.update_task(&task.id, &patch, 2_000, &mut effects).is_err());
    assert_eq!(core.get_task(&task.id).unwrap().title, "draft");
    let patch = TaskPatch {
      title: Some("v2".into()), notes: None, project_id: None, due_date: None,
      reminder_at: None, priority: None, sort_order: None, base_revision: Some(task.revision),
    };
    assert!(core.update_task(&task.id, &patch, 2_000, &mut effects).is_ok());
    assert_eq!(core.get_task(&task.id).unwrap().title, "v2");
    assert_eq!(core.get_task(&task.id).unwrap().revision, task.revision + 1);
  }

  #[test]
  fn root_with_open_steps_refuses_done() {
    let mut core = core();
    let root = create_root(&mut core, "root");
    let mut effects = TaskEffects::default();
    core.create_step(&root.id, "step", 1_500, &mut effects).unwrap();
    assert!(core.set_task_status(&root.id, "done", 2_000, &mut effects).is_err());
    // A step alone toggles freely.
    let step = core.tasks.iter().find(|t| t.parent_id.is_some()).unwrap().clone();
    assert!(core.set_task_status(&step.id, "done", 2_500, &mut effects).is_ok());
    assert!(core.set_task_status(&root.id, "done", 3_000, &mut effects).is_ok());
  }

  #[test]
  fn complete_tree_checks_revisions_and_undo_restores() {
    let mut core = core();
    let root = create_root(&mut core, "tree");
    let mut effects = TaskEffects::default();
    core.create_step(&root.id, "s1", 1_100, &mut effects).unwrap();
    let step = core.tasks.iter().find(|t| t.parent_id.is_some()).unwrap().clone();
    let mut revisions = HashMap::new();
    revisions.insert(root.id.clone(), root.revision);
    revisions.insert(step.id.clone(), step.revision + 1); // stale step
    assert!(core.complete_task_tree(&root.id, &revisions, 1_200, &mut effects).is_err());
    *revisions.get_mut(&step.id).unwrap() = step.revision;
    assert!(core.complete_task_tree(&root.id, &revisions, 1_200, &mut effects).is_ok());
    assert!(effects.undo.is_some());
    // Undo restores both rows to open with their original revisions.
    let undo = effects.undo.clone().unwrap();
    let mut undo_effects = TaskEffects::default();
    assert!(core.undo(&undo.operation_id, 1_500, &mut undo_effects));
    let restored_root = core.get_task(&root.id).unwrap().clone();
    assert_eq!(restored_root.status, "open");
    assert_eq!(restored_root.revision, root.revision);
  }

  #[test]
  fn queue_reorder_keeps_tail_and_skips_revision() {
    let mut core = core();
    let a = create_root(&mut core, "a");
    let b = create_root(&mut core, "b");
    let c = create_root(&mut core, "c");
    let mut effects = TaskEffects::default();
    // c completed: sinks out of the reorderable set but stays in the queue.
    core.set_task_status(&c.id, "done", 2_000, &mut effects).unwrap();
    let revisions_before: Vec<u64> = core.tasks.iter().map(|t| t.revision).collect();
    core.reorder_queue(&[b.id.clone(), a.id.clone()], 3_000, &mut effects).unwrap();
    assert_eq!(core.get_task(&a.id).unwrap().sort_order, 10);
    assert_eq!(core.get_task(&b.id).unwrap().sort_order, 0);
    // A completed task is not part of the reorderable queue: it keeps its
    // original manual order (the tail only re-appends OPEN roots).
    assert_eq!(core.get_task(&c.id).unwrap().sort_order, 3);
    assert_eq!(core.tasks.iter().map(|t| t.revision).collect::<Vec<_>>(), revisions_before);
  }

  #[test]
  fn delete_undo_window_expires() {
    let mut core = core();
    let task = create_root(&mut core, "gone");
    let mut effects = TaskEffects::default();
    core.delete_task(&task.id, 1_000, &mut effects);
    assert!(core.tasks.is_empty());
    let undo = core.undo_state(1_500).unwrap();
    assert!(core.undo(&undo.operation_id, 5_000, &mut TaskEffects::default()));
    assert_eq!(core.tasks.len(), 1);
    // A second delete's undo expires after 10 s.
    core.delete_task(&task.id, 10_000, &mut effects);
    assert!(core.undo_state(30_000).is_none());
  }

  #[test]
  fn project_delete_detaches_tasks() {
    let mut core = core();
    let mut effects = TaskEffects::default();
    core.create_project(&serde_json::json!({ "name": "工作" }), 1_000, &mut effects).unwrap();
    let project_id = core.projects[0].id.clone();
    let input = SimpleCreateInput { title: "t".into(), notes: None, project_id: Some(project_id.clone()), due_date: None, reminder_at: None };
    core.create_task(&input, 1_100, &mut effects);
    core.delete_project(&project_id, 2_000, &mut effects);
    assert!(core.projects.is_empty());
    assert!(core.tasks[0].project_id.is_none());
  }
}
