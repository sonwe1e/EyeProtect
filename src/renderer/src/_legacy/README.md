# Legacy renderer archive

This tree holds UI that was removed from the simplified product path
(待办 / 完成记录 / 设置 + 桌宠 / 气泡 / 休息遮罩 / 番茄钟).

- **Do not import** anything under `_legacy/` from active views, hooks, or features.
- **Not typechecked**: `tsconfig.json` excludes this directory. Archived code may
  reference removed `window.eyeProtect` methods (planning/focus/section IPC).
- Pure helpers that still have unit tests stay in
  `src/renderer/src/features/tasks/` (`todaySections`, `planLayout`,
  `taskReorder`, `taskRowMetadata`, `focusCompletion`, `todayViewModel`).
- Disposition authority: `docs/architecture.md` §遗留面清单 / §主进程与 preload 收口结论.
- Deleting this tree is a separate change: update architecture docs and any
  contract scripts that still reference these paths first.

Active settings UI: `src/renderer/src/features/simple/SimpleSettings.tsx`.

