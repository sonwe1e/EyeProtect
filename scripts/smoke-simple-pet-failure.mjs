import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { getAvailablePort, delay, evaluate, listTargets, waitFor, waitForTarget } from './lib/cdp.mjs';

const output = resolve('artifacts/simple-pet-failure');
const runtime = resolve(output, `run-${Date.now()}`);
mkdirSync(output, { recursive: true });
const port = await getAvailablePort();
const child = spawn(resolve('release/win-unpacked/EyeProtect.exe'), [
  `--remote-debugging-port=${port}`, '--eyeprotect-smoke-pet-failure', `--user-data-dir=${resolve(runtime, 'profile')}`
], { windowsHide: true, env: { ...process.env, EYEPROTECT_SMOKE: '1', EYEPROTECT_DATA_DIR: resolve(runtime, 'data') } });
let log = '';
child.stderr.on('data', (data) => { log += data; });
try {
  const endpoint = `http://127.0.0.1:${port}`;
  const workbench = await waitForTarget(endpoint, '#workbench');
  await waitFor(workbench, `document.querySelector('.simple-workbench') !== null`);
  await delay(1500);
  assert.equal((await listTargets(endpoint)).some((page) => page.url.endsWith('#pet')), false);
  const tasks = await evaluate(workbench, `window.eyeProtect.createTask({ title: '桌宠失效仍可记任务' })`);
  assert.equal(tasks.length, 1);
  const status = await evaluate(workbench, `window.eyeProtect.testReminder('eye')`);
  assert.ok(status.activeReminder);
  const alert = await waitForTarget(endpoint, '#alert');
  await waitFor(alert, `document.querySelector('.simple-rest') !== null`);
  await evaluate(workbench, `window.eyeProtect.reminderAction('skip', ${JSON.stringify(status.activeReminder.id)})`);
  await waitFor(workbench, `(async () => !(await window.eyeProtect.getReminderStatus()).activeReminder)()`);
  console.log('Pet startup failure leaves tasks and independent health reminders operational.');
} finally {
  writeFileSync(resolve(output, 'app.log'), log);
  if (child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
}
