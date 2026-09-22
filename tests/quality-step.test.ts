import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../src/main/logger';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

test('main logger exposes leveled logging without throwing', () => {
  assert.equal(typeof logger.info, 'function');
  assert.equal(typeof logger.warn, 'function');
  assert.equal(typeof logger.error, 'function');
  logger.info('quality step smoke');
  logger.warn('quality step smoke');
  logger.error('quality step smoke');
});

test('blocking window.confirm is gone from renderer views', () => {
  for (const path of [
    'src/renderer/src/views/WorkbenchView.tsx',
    'src/renderer/src/views/BubbleView.tsx',
    'src/renderer/src/views/PetView.tsx',
  ]) {
    assert.ok(!read(path).includes('window.confirm'), `${path} still uses window.confirm`);
  }
});

test('confirm dialog is wired into the views with interactive actions', () => {
  for (const path of [
    'src/renderer/src/views/WorkbenchView.tsx',
    'src/renderer/src/views/BubbleView.tsx',
  ]) {
    assert.ok(read(path).includes('ConfirmDialog'), `${path} missing ConfirmDialog`);
  }
});

test('danger confirms focus cancel by default and label destructive actions', () => {
  const dialog = read('src/renderer/src/components/ConfirmDialog.tsx');
  assert.ok(dialog.includes(`variant={danger ? 'danger' : 'primary'}`), 'danger confirm should use danger styling');
  assert.ok(dialog.includes('autoFocus={danger}'), 'danger confirm should focus cancel first');
  for (const path of [
    'src/renderer/src/views/WorkbenchView.tsx',
    'src/renderer/src/views/BubbleView.tsx',
    'src/renderer/src/views/PetView.tsx',
  ]) {
    assert.ok(!read(path).includes('是否一起完成'), `${path} still uses the vague confirm copy`);
  }
  assert.ok(read('src/renderer/src/views/WorkbenchView.tsx').includes('danger: true'), 'delete confirms should be danger');
});

test('task rows do not toggle details from inline controls', () => {
  const view = read('src/renderer/src/views/WorkbenchView.tsx');
  assert.ok(view.includes('stopPropagation'), 'inline task controls should stop row expansion');
  assert.ok(view.includes('已设置提醒'), 'rows with reminderAt should show a reminder marker');
});

test('task editor resyncs external updates and disables pristine saves', () => {
  const view = read('src/renderer/src/views/WorkbenchView.tsx');
  assert.ok(view.includes('[task.id, task.revision]'), 'draft should resync on external revision change');
  assert.ok(view.includes('!dirty'), 'save should disable when nothing changed');
});

test('task drafts survive unmount and surface unsaved state', () => {
  const view = read('src/renderer/src/views/WorkbenchView.tsx');
  assert.ok(view.includes('taskDrafts'), 'parent must keep per-task drafts across collapse');
  assert.ok(view.includes('有未保存修改'), 'dirty drafts must be labeled');
  assert.ok(view.includes('步骤名称失焦即自动保存'), 'steps must declare independent autosave');
});

test('today stats avoid the misleading completion percentage', () => {
  const view = read('src/renderer/src/views/WorkbenchView.tsx');
  assert.ok(view.includes('当前清单待办'), 'pending count must name its scope');
  assert.ok(view.includes('今日完成'), 'today completed count must stay visible');
  assert.ok(!view.includes('progressPercent'), 'misleading progress percent is retired');
  assert.ok(!view.includes('今日完成率'), 'completion-rate copy is retired');
});

test('bubble hooks stay unconditional and can locate a task', () => {
  const bubble = read('src/renderer/src/views/BubbleView.tsx');
  const confirmAt = bubble.indexOf('useConfirm()');
  const preAlertReturn = bubble.indexOf('if (preAlert) return');
  assert.ok(confirmAt >= 0 && preAlertReturn > confirmAt, 'useConfirm must run before early returns');
  assert.ok(bubble.includes("openWorkbench('today', task.id)"), 'bubble task click must pass focusTaskId');
});

test('alert keyboard keeps control semantics and remembers rest mode', () => {
  const alert = read('src/renderer/src/views/AlertView.tsx');
  assert.ok(alert.includes("closest('button"), 'Enter/Space on buttons must not hijack rest shortcuts');
  assert.ok(alert.includes('REST_MODE_STORAGE_KEY'), 'rest mode preference must persist');
  assert.ok(!alert.includes('setRelaxMode(random)'), 'new reminders must not force a random mode');
});

test('core task actions stay discoverable with labels', () => {
  const view = read('src/renderer/src/views/WorkbenchView.tsx');
  const css = read('src/renderer/src/styles/simple.css');
  assert.ok(view.includes('开始专注这项任务'), 'focus action needs a tooltip');
  assert.ok(view.includes('放到浮窗'), 'pin action needs a tooltip');
  assert.ok(!css.includes('opacity: 0;\n  transition: opacity'), 'row actions must not hide by default');
  assert.ok(css.includes('simple-check-hit'), 'checkbox needs an expanded hit target');
  assert.ok(css.includes('simple-live-strip'), 'workbench needs a live focus/pause strip');
});

test('bubble actions meet a usable hit target', () => {
  const css = read('src/renderer/src/styles.css');
  assert.ok(css.includes('min-height: 36px'), 'bubble actions regressed below 36px');
});

test('pet keeps a focus entry point via context menu', () => {
  const index = read('src/main/index.ts');
  assert.ok(index.includes('pomodoro') && index.includes('window:pet:context-menu'), 'pet context menu provides focus entry');
});

test('logger persists warn/error through the injectable sink', async () => {
  const { setLoggerSink } = await import('../src/main/logger');
  const received: Array<{ level: string; message: string }> = [];
  setLoggerSink((level, message) => received.push({ level, message }));
  const { logger } = await import('../src/main/logger');
  logger.info('info-only');
  logger.warn('persisted-warning');
  logger.error('persisted-error', new Error('detail'));
  setLoggerSink(null);
  assert.deepEqual(received.map((entry) => entry.level), ['warn', 'error']);
  assert.ok(received[1].message.includes('persisted-error'));
});

test('main index wires the logger sink to the reminder trace', () => {
  assert.ok(read('src/main/index.ts').includes('setLoggerSink'), 'logger sink must be installed at startup');
});

test('pet motion toggle exists end to end', () => {
  assert.ok(read('src/shared/types.ts').includes('petMotion'), 'Settings.petMotion missing');
  assert.ok(read('src/main/settings.ts').includes('petMotion'), 'sanitizeSettings must carry petMotion');
  assert.ok(read('src/renderer/src/features/pet/PetCharacter.tsx').includes('motion'), 'PetCharacter must honor motion prop');
  assert.ok(read('src/renderer/src/views/PetView.tsx').includes('settings.petMotion'), 'PetView must pass the setting through');
  assert.ok(read('src/renderer/src/features/simple/SimpleSettings.tsx').includes('petMotion'), 'Settings UI must expose the toggle');
});

test('alert and bubble share the lede copy source', () => {
  assert.ok(read('src/renderer/src/views/AlertView.tsx').includes('restLede('));
  assert.ok(read('src/renderer/src/features/reminders/ReminderBubble.tsx').includes('restLede('));
  assert.ok(!read('src/renderer/src/features/reminders/ReminderBubble.tsx').includes('准备好后开始这次休息'), 'bubble must not carry a private lede copy');
});

test('alert snooze no longer mutates global settings inline', () => {
  const alert = read('src/renderer/src/views/AlertView.tsx');
  assert.ok(!alert.includes('saveSettings({ snoozeMinutes'), 'snooze select must not write settings from the reminder surface');
  assert.ok(read('src/renderer/src/features/simple/SimpleSettings.tsx').includes('snoozeMinutes'), 'default snooze lives in settings');
});
