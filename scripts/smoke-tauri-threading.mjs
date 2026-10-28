// Deterministic lock-inversion test for an isolated, debug Tauri build.
// The negative control deliberately freezes its own disposable process; the
// second run verifies that the real settings command completes in that race.
// Build with a distinct Tauri identifier, then set EYEPROTECT_TAURI_EXE.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { delay, evaluate, getAvailablePort, waitFor, waitForTarget } from './lib/cdp.mjs';

const exe = process.env.EYEPROTECT_TAURI_EXE;
if (!exe || !resolve(exe).toLowerCase().includes(`${join('target', 'debug')}`.toLowerCase())) {
  throw new Error('Set EYEPROTECT_TAURI_EXE to an isolated debug build.');
}
const tempRoot = resolve(tmpdir());

async function exercise(negativeControl) {
  const dataDir = resolve(await mkdtemp(join(tempRoot, 'eyeprotect-thread-smoke-')));
  await writeFile(join(dataDir, 'settings.json'), JSON.stringify({ hotkeysEnabled: false }));
  const port = await getAvailablePort();
  const child = spawn(exe, [], {
    env: {
      ...process.env,
      EYEPROTECT_SMOKE: '1',
      EYEPROTECT_DATA_DIR: dataDir,
      WEBVIEW2_USER_DATA_FOLDER: join(dataDir, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
  try {
    const pet = await waitForTarget(`http://127.0.0.1:${port}`, '#pet', 20_000);
    await waitFor(pet, `typeof window.eyeProtect === 'object'`);
    await evaluate(pet, `window.__threadRace = window.__TAURI_INTERNALS__.invoke('smoke_hold_core_and_query_window'); true`);
    await waitFor(pet, `window.__TAURI_INTERNALS__.invoke('smoke_core_held')`, 5_000);
    if (negativeControl) {
      await evaluate(pet, `window.__TAURI_INTERNALS__.invoke('smoke_blocking_core_read').catch(() => {}); true`);
      await delay(1_100);
      let timedOut = false;
      try {
        await evaluate(pet, `window.__TAURI_INTERNALS__.invoke('smoke_core_held')`, 1_200);
      } catch (error) {
        if (!String(error.message).includes('timed out')) throw error;
        timedOut = true;
      }
      assert.ok(timedOut, 'the negative control must reproduce the event-thread deadlock');
      console.log('[smoke:tauri-threading] old synchronous read reproduced the lock inversion');
    } else {
      const result = await evaluate(pet, `(async () => {
        const [settings] = await Promise.all([window.eyeProtect.getSettings(), window.__threadRace]);
        return { companion: settings.petCompanion, held: await window.__TAURI_INTERNALS__.invoke('smoke_core_held') };
      })()`, 5_000);
      assert.equal(result.companion, 'fighter');
      assert.equal(result.held, false);
      console.log('[smoke:tauri-threading] real settings read and window query both completed');
    }
  } catch (error) {
    throw new Error(`${error.message}${stderr ? `\nstderr: ${stderr}` : ''}`);
  } finally {
    if (child.exitCode === null && child.pid) {
      if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); }
        catch { child.kill(); }
      } else child.kill();
    }
    await delay(1_000);
    if (dirname(dataDir).toLowerCase() !== tempRoot.toLowerCase() || !basename(dataDir).startsWith('eyeprotect-thread-smoke-')) {
      throw new Error(`Refusing to remove unexpected temporary directory: ${dataDir}`);
    }
    await rm(dataDir, { recursive: true, force: true });
  }
}

await exercise(true);
await exercise(false);
console.log('[smoke:tauri-threading] PASS');
