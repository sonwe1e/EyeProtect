//! Small filesystem helpers: every persistent write is atomic (tmp + rename)
//! and every read is corruption-tolerant (quarantine + fallback), mirroring the
//! Electron stores' write discipline.

use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

/// Atomic JSON write; `pretty` matches the Electron stores' readable dumps.
pub fn write_json_atomic(path: &Path, value: &Value, pretty: bool) -> std::io::Result<()> {
  let body = if pretty {
    serde_json::to_string_pretty(value).map_err(std::io::Error::other)?
  } else {
    serde_json::to_string(value).map_err(std::io::Error::other)?
  };
  write_atomic(path, format!("{}\n", body).as_bytes())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)?;
  }
  let mut tmp: PathBuf = path.as_os_str().into();
  tmp.set_extension("json.tmp");
  fs::write(&tmp, bytes)?;
  // On Windows rename replaces an existing file. If it fails, leave the old
  // file in place: deleting it before retrying can destroy the last good copy.
  let result = fs::rename(&tmp, path);
  if result.is_err() {
    let _ = fs::remove_file(&tmp);
  }
  result
}

/// Commit a small set of files with best-effort rollback on any failed write.
/// Callers keep an independent recovery snapshot for a failed rollback/crash.
pub fn replace_json_files(files: &[(PathBuf, Value, bool)]) -> Result<(), String> {
  let mut originals = Vec::new();
  for (path, _, _) in files {
    match fs::read(path) {
      Ok(bytes) => originals.push(Some(bytes)),
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => originals.push(None),
      Err(error) => return Err(format!("无法读取原数据：{}", error)),
    }
  }
  for (index, (path, value, pretty)) in files.iter().enumerate() {
    if let Err(error) = write_json_atomic(path, value, *pretty) {
      let mut rollback_errors = Vec::new();
      for previous in (0..index).rev() {
        let previous_path = &files[previous].0;
        let result = match &originals[previous] {
          Some(bytes) => write_atomic(previous_path, bytes),
          None => fs::remove_file(previous_path),
        };
        if let Err(error) = result {
          rollback_errors.push(error.to_string());
        }
      }
      return if rollback_errors.is_empty() {
        Err(format!("无法写入数据，已恢复原文件：{}", error))
      } else {
        Err(format!("无法写入数据，部分文件未能恢复；请使用导入前快照：{}", rollback_errors.join("；")))
      };
    }
  }
  Ok(())
}

/// Read and parse JSON; a corrupt file is quarantined and reported as absent.
pub fn read_json(path: &Path) -> Option<Value> {
  let raw = match fs::read_to_string(path) {
    Ok(raw) => raw,
    Err(_) => return None,
  };
  match serde_json::from_str::<Value>(&raw) {
    Ok(value) => Some(value),
    Err(_) => {
      quarantine(path);
      None
    }
  }
}

/// Essential stores must never be treated as empty on read or parse failure:
/// a later write would overwrite data that may still be recoverable.
pub fn read_json_checked(path: &Path) -> Result<Option<Value>, String> {
  let raw = match fs::read_to_string(path) {
    Ok(raw) => raw,
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
    Err(error) => return Err(format!("无法读取 {}：{}", path.display(), error)),
  };
  serde_json::from_str(&raw).map(Some)
    .map_err(|error| format!("无法解析 {}：{}", path.display(), error))
}

/// Keep the broken file as evidence, best effort.
pub fn quarantine(path: &Path) {
  let mut evidence: PathBuf = path.as_os_str().into();
  let stamp = chrono::Local::now().timestamp_millis();
  let mut name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
  name.push_str(&format!(".corrupt-{}", stamp));
  evidence.set_file_name(name);
  let _ = fs::rename(path, evidence);
}

/// Read a JSON file into a typed value via sanitize-free serde.
pub fn read_typed<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
  let value = read_json(path)?;
  serde_json::from_value(value).ok()
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  #[test]
  fn failed_multi_file_write_restores_the_files_already_replaced() {
    let dir = std::env::temp_dir().join(format!("eyeprotect-backup-test-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&dir).unwrap();
    let tasks = dir.join("tasks.json");
    let settings = dir.join("settings.json");
    fs::write(&tasks, b"old tasks").unwrap();
    fs::write(&settings, b"old settings").unwrap();
    fs::create_dir(dir.join("settings.json.tmp")).unwrap();
    let result = replace_json_files(&[
      (tasks.clone(), json!({"new": "tasks"}), false),
      (settings.clone(), json!({"new": "settings"}), false),
    ]);
    assert!(result.is_err());
    assert_eq!(fs::read(&tasks).unwrap(), b"old tasks");
    assert_eq!(fs::read(&settings).unwrap(), b"old settings");
    fs::remove_dir(dir.join("settings.json.tmp")).unwrap();
    fs::remove_file(tasks).unwrap();
    fs::remove_file(settings).unwrap();
    fs::remove_dir(dir).unwrap();
  }

  #[test]
  fn checked_read_never_treats_invalid_or_unreadable_data_as_empty() {
    let dir = std::env::temp_dir().join(format!("eyeprotect-read-test-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&dir).unwrap();
    let path = dir.join("tasks.json");
    assert!(read_json_checked(&path).unwrap().is_none());
    fs::write(&path, b"{ broken").unwrap();
    assert!(read_json_checked(&path).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"{ broken");
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    assert!(read_json_checked(&path).is_err());
    fs::remove_dir(&path).unwrap();
    fs::remove_dir(&dir).unwrap();
  }
}
