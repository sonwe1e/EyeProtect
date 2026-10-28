import { spawn, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { evaluate, getAvailablePort, waitFor, waitForTarget } from './lib/cdp.mjs';

const root = resolve(tmpdir());
const dir = resolve(await mkdtemp(join(root, 'eyeprotect-write-probe-')));
const port = await getAvailablePort();
await writeFile(join(dir, 'settings.json'), JSON.stringify({ hotkeysEnabled: false }));
const child = spawn(process.env.EYEPROTECT_TAURI_EXE || resolve('src-tauri/target/release/eyeprotect.exe'), [], {
  env: { ...process.env, EYEPROTECT_DATA_DIR: dir, EYEPROTECT_SMOKE: '1', WEBVIEW2_USER_DATA_FOLDER: join(dir, 'webview'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  stdio: 'ignore', windowsHide: false
});
try {
  const pet = await waitForTarget(`http://127.0.0.1:${port}`, '#pet', 20000);
  await waitFor(pet, "typeof window.eyeProtect === 'object'", 15000);
  await mkdir(join(dir, 'tasks.json'));
  const task = await evaluate(pet, `(async () => { try { const items = await window.eyeProtect.createTask({title: 'write failure probe'}); return { ok: true, count: items.length }; } catch (e) { return { ok: false, error: String(e) }; } })()`);
  await rm(join(dir, 'settings.json'));
  await mkdir(join(dir, 'settings.json'));
  const settings = await evaluate(pet, `(async () => { try { const value = await window.eyeProtect.saveSettings({snoozeMinutes: 7}); return { ok: true, snoozeMinutes: value.snoozeMinutes }; } catch (e) { return { ok: false, error: String(e) }; } })()`);
  console.log(JSON.stringify({ task, settings, taskFileIsDirectory: (await stat(join(dir, 'tasks.json'))).isDirectory(), settingsFileIsDirectory: (await stat(join(dir, 'settings.json'))).isDirectory() }));
  assert.equal(task.ok, false, 'task write failure must reject the command');
  assert.equal(settings.ok, false, 'settings write failure must reject the command');
  assert.equal((await evaluate(pet, 'window.eyeProtect.getTasks()')).length, 0);
  assert.notEqual((await evaluate(pet, 'window.eyeProtect.getSettings()')).snoozeMinutes, 7);
  console.log('[smoke:tauri-write-failure] PASS');
} finally {
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { child.kill(); }
  await new Promise((done) => setTimeout(done, 1500));
  if (dirname(dir).toLowerCase() !== root.toLowerCase() || !basename(dir).startsWith('eyeprotect-write-probe-')) throw new Error(`Unexpected temporary path: ${dir}`);
  await rm(dir, { recursive: true, force: true });
}
