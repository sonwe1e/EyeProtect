/**
 * Captures the reminder surfaces (alert window + bubble) from a RUNNING app.
 *
 * The pre-existing capture scripts (capture-ui-snapshots.mjs,
 * smoke-reminder-experience.mjs) still assert pre-refactor selectors such as
 * `.alert-panel` / `.alert-actions` / `.procedural-character` and no longer
 * match the renderer, so they fail before they capture anything. This script
 * targets the current markup.
 *
 * Usage:
 *   npx electron . --remote-debugging-port=9336 --in-process-gpu
 *   node scripts/capture-reminder-surfaces.mjs 9336 artifacts/reminder-capture
 *
 * Notes:
 * - `--in-process-gpu` matters on machines where the GPU process cannot start
 *   (headless/CI/non-interactive sessions): without it Chromium aborts with
 *   "GPU process isn't usable. Goodbye.".
 * - Launch with `--user-data-dir` and `EYEPROTECT_DATA_DIR` pointing at a
 *   scratch directory so the run never touches real user data.
 * - `reminderMode` is hardcoded to 'focused' in the main process (see
 *   getEffectiveMode in src/main/index.ts), so the gentle/pre-alert bubble is
 *   unreachable by default. Set CAPTURE_GENTLE=1 and temporarily relax that
 *   override if you need those frames.
 * - The settings the script changes are read first and restored at the end.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { call, delay, evaluate, waitForTarget, waitForTargetGone } from './lib/cdp.mjs';

const port = Number(process.argv[2] ?? 9336);
const endpoint = `http://127.0.0.1:${port}`;
const output = resolve(process.argv[3] ?? 'artifacts/reminder-capture');
const wantGentle = process.env.CAPTURE_GENTLE === '1';
mkdirSync(output, { recursive: true });

const capture = async (target, name) => {
  const frame = await call(target, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(resolve(output, `${name}.png`), Buffer.from(frame.data, 'base64'));
  console.log(`  ${name}.png`);
};
/** Runtime.evaluate has no top-level await, so every expression is an async IIFE. */
const run = (target, body) => evaluate(target, `(async () => { ${body} })()`);

const pet = await waitForTarget(endpoint, '#pet', 15_000);
const before = JSON.parse(await run(pet, `return JSON.stringify(await window.eyeProtect.getSettings());`));
console.log(`pet ready (theme=${before.theme}, reminderMode=${before.reminderMode})`);

const dismiss = async (id) => {
  if (!id) return;
  await run(pet, `await window.eyeProtect.reminderAction('skip', ${JSON.stringify(id)});`);
  await waitForTargetGone(endpoint, '#alert', 10_000).catch(() => {});
  await waitForTargetGone(endpoint, '#bubble', 10_000).catch(() => {});
  await delay(600);
};

console.log('alert window');
await run(pet, `await window.eyeProtect.saveSettings({ theme: 'light', reminderMode: 'focused', eyeRestSeconds: 20, petAppearance: 'cat' });`);
await run(pet, `await window.eyeProtect.testReminder('eye');`);
const alert = await waitForTarget(endpoint, '#alert', 15_000);
await delay(1200);
await capture(alert, 'alert-light-ready');

let id = await run(pet, `const s = await window.eyeProtect.getReminderStatus(); return s.activeReminder?.id ?? null;`);
await run(pet, `await window.eyeProtect.beginHealthRest(${JSON.stringify(id)});`);
await delay(1500);
await capture(alert, 'alert-light-resting');

await run(pet, `await window.eyeProtect.saveSettings({ theme: 'dark' });`);
await delay(1200);
await capture(alert, 'alert-dark-resting');
await run(pet, `await window.eyeProtect.saveSettings({ theme: 'light' });`);
await delay(500);
await dismiss(id);

await run(pet, `await window.eyeProtect.testReminder('combined');`);
const combined = await waitForTarget(endpoint, '#alert', 15_000);
await delay(1000);
id = await run(pet, `const s = await window.eyeProtect.getReminderStatus(); return s.activeReminder?.id ?? null;`);
await run(pet, `await window.eyeProtect.beginHealthRest(${JSON.stringify(id)});`);
await delay(1500);
await capture(combined, 'alert-light-combined');
await dismiss(id);

console.log('bubble — todo preview (the surface users actually see)');
await run(pet, `await window.eyeProtect.saveSettings({ theme: 'light', todoBubbleEnabled: true, preAlertSeconds: 0 });`);
const ids = await run(pet, `
  for (const task of await window.eyeProtect.getTasks()) await window.eyeProtect.deleteTask(task.id);
  await window.eyeProtect.createTask({ title: '修改论文第三章', context: 'desk', plannedAt: Date.now() });
  await window.eyeProtect.createTask({ title: '去打印室取材料', context: 'away', plannedAt: Date.now() });
  await window.eyeProtect.createTask({ title: '回复导师邮件', context: 'desk', plannedAt: Date.now() });
  return JSON.stringify((await window.eyeProtect.getTasks()).slice(0, 3).map((task) => task.id));
`);
await run(pet, `await window.eyeProtect.saveSettings({ todoBubbleTaskIds: ${ids} });`);
await run(pet, `await window.eyeProtect.restartCycle();`);
const bubble = await waitForTarget(endpoint, '#bubble', 20_000);
await delay(1500);
await capture(bubble, 'bubble-todo-light');
await run(pet, `await window.eyeProtect.saveSettings({ theme: 'dark' });`);
await delay(1200);
await capture(bubble, 'bubble-todo-dark');
await run(pet, `await window.eyeProtect.saveSettings({ theme: 'light' });`);
await delay(400);

if (wantGentle) {
  console.log('bubble — gentle reminder');
  await run(pet, `await window.eyeProtect.saveSettings({ reminderMode: 'gentle', todoBubbleEnabled: false });`);
  await delay(600);
  const status = JSON.parse(await run(pet, `await window.eyeProtect.testReminder('eye'); const s = await window.eyeProtect.getReminderStatus(); return JSON.stringify({ mode: s.activeReminder?.mode ?? null });`));
  if (status.mode !== 'gentle') {
    console.log('  skipped: the main process is not honouring reminderMode (getEffectiveMode is hardcoded to focused)');
  } else {
    const gentle = await waitForTarget(endpoint, '#bubble', 20_000);
    await delay(1500);
    await capture(gentle, 'bubble-gentle-ready');
    id = await run(pet, `const s = await window.eyeProtect.getReminderStatus(); return s.activeReminder?.id ?? null;`);
    await run(pet, `await window.eyeProtect.beginHealthRest(${JSON.stringify(id)});`);
    await delay(1800);
    await capture(gentle, 'bubble-gentle-resting');
    await run(pet, `await window.eyeProtect.saveSettings({ theme: 'dark' });`);
    await delay(1200);
    await capture(gentle, 'bubble-gentle-dark');
    await dismiss(id);
  }
}

console.log('restoring settings');
await run(pet, `await window.eyeProtect.saveSettings({
  theme: ${JSON.stringify(before.theme)},
  reminderMode: ${JSON.stringify(before.reminderMode)},
  eyeRestSeconds: ${before.eyeRestSeconds},
  petAppearance: ${JSON.stringify(before.petAppearance)},
  todoBubbleEnabled: ${before.todoBubbleEnabled},
  todoBubbleTaskIds: ${JSON.stringify(before.todoBubbleTaskIds)},
  preAlertSeconds: ${before.preAlertSeconds}
});`);
await run(pet, `await window.eyeProtect.restartCycle();`);
console.log(`done -> ${output}`);
