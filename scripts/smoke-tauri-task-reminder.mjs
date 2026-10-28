// Exercise a real Tauri task reminder with isolated data and WebView2 profile.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { delay, evaluate, getAvailablePort, waitFor, waitForTarget } from './lib/cdp.mjs';

const root = resolve(tmpdir());
const dir = resolve(await mkdtemp(join(root, 'eyeprotect-reminder-smoke-')));
const exe = process.env.EYEPROTECT_TAURI_EXE || resolve('src-tauri/target/release/eyeprotect.exe');
await writeFile(join(dir, 'settings.json'), JSON.stringify({ hotkeysEnabled: false }));
let child;

async function start() {
  const port = await getAvailablePort();
  const profile = join(dir, `webview-${port}`);
  await mkdir(profile);
  child = spawn(exe, [], {
    env: { ...process.env, EYEPROTECT_DATA_DIR: dir, EYEPROTECT_SMOKE: '1', WEBVIEW2_USER_DATA_FOLDER: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
    stdio: 'ignore', windowsHide: false
  });
  const pet = await waitForTarget(`http://127.0.0.1:${port}`, '#pet', 20000);
  await waitFor(pet, "typeof window.eyeProtect === 'object'", 15000);
  return pet;
}

async function stop() {
  if (!child) return;
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { child.kill(); }
  child = null;
  await delay(1500);
}

async function waitForDelivery() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const store = JSON.parse(await readFile(join(dir, 'task-reminders.json'), 'utf8'));
      const delivery = store.deliveries.find((item) => item.body.includes('提醒冒烟测试'));
      if (delivery?.status === 'sent' || delivery?.status === 'failed') return delivery;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await delay(250);
  }
  throw new Error('task reminder was not dispatched');
}

try {
  const pet = await start();
  await evaluate(pet, `window.eyeProtect.createTask({title:'提醒冒烟测试', reminderAt: Date.now() + 2500})`);
  const delivery = await waitForDelivery();
  assert.equal(delivery.status, 'sent', 'Windows notification API must accept the reminder');
  await stop();
  await start();
  await delay(2500);
  const restored = JSON.parse(await readFile(join(dir, 'task-reminders.json'), 'utf8'));
  assert.equal(restored.deliveries.filter((item) => item.id === delivery.id && item.status === 'sent').length, 1);
  console.log('[smoke:tauri-task-reminder] PASS: Windows accepted the reminder and the sent occurrence survived restart');
} finally {
  await stop();
  if (dirname(dir).toLowerCase() !== root.toLowerCase() || !basename(dir).startsWith('eyeprotect-reminder-smoke-')) throw new Error(`Unexpected temporary path: ${dir}`);
  await rm(dir, { recursive: true, force: true });
}
