// Verify a damaged task store is retained and prevents an unsafe empty start.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { delay } from './lib/cdp.mjs';

const root = resolve(tmpdir());
const dir = resolve(await mkdtemp(join(root, 'eyeprotect-corrupt-smoke-')));
const exe = process.env.EYEPROTECT_TAURI_EXE || resolve('src-tauri/target/release/eyeprotect.exe');
const original = '{ corrupt task data';
await writeFile(join(dir, 'settings.json'), JSON.stringify({ hotkeysEnabled: false }));
await writeFile(join(dir, 'tasks.json'), original);
const child = spawn(exe, [], {
  env: { ...process.env, EYEPROTECT_DATA_DIR: dir, EYEPROTECT_SMOKE: '1', WEBVIEW2_USER_DATA_FOLDER: join(dir, 'webview') },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false
});
let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
child.stdout.on('data', () => {});
try {
  const deadline = Date.now() + 12000;
  while (!stderr.includes('[startup]') && Date.now() < deadline && child.exitCode === null) await delay(100);
  assert.match(stderr, /\[startup\]/, 'the app must report the data read error');
  assert.equal(await readFile(join(dir, 'tasks.json'), 'utf8'), original);
  console.log('[smoke:tauri-startup-recovery] PASS: corrupt task data was preserved and startup refused');
} finally {
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { child.kill(); }
  await delay(1500);
  if (dirname(dir).toLowerCase() !== root.toLowerCase() || !basename(dir).startsWith('eyeprotect-corrupt-smoke-')) throw new Error(`Unexpected temporary path: ${dir}`);
  await rm(dir, { recursive: true, force: true });
}
