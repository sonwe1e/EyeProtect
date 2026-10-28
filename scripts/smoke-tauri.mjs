// Tauri build smoke: launch the packaged Rust shell, drive the REAL React
// renderer over CDP (WebView2 remote debugging), and verify the core loop
// end-to-end: bridge installed → pet renders → invoke round-trip → workbench
// opens → task persists to the fresh data store.
//
// Usage: npm run smoke:tauri
// Prereq: npm run build:tauri (or a prior cargo build --release).
// Override the binary with EYEPROTECT_TAURI_EXE=path/to/eyeprotect.exe.

import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { delay, evaluate, getAvailablePort, openSession, waitFor, waitForTarget } from './lib/cdp.mjs';

// A private WebView2 profile keeps this run isolated without terminating other
// instances that may belong to a different test or user session.

const fail = (message) => {
  console.error(`[smoke:tauri] FAIL: ${message}`);
  process.exitCode = 1;
};

const defaultExe = join(process.cwd(), 'src-tauri', 'target', 'release', 'eyeprotect.exe');
const exe = process.env.EYEPROTECT_TAURI_EXE ?? defaultExe;
if (!existsSync(exe)) {
  fail(`application not found at ${exe} — run npm run build:tauri first`);
  process.exit(process.exitCode);
}

const tempRoot = resolve(tmpdir());
const dataDir = resolve(await mkdtemp(join(tempRoot, 'eyeprotect-tauri-smoke-')));
// Keep isolated smoke instances from registering machine-wide shortcuts.
await writeFile(join(dataDir, 'settings.json'), JSON.stringify({ hotkeysEnabled: false }));
const outputDir = resolve('artifacts', 'codex-tauri-ui');
await mkdir(outputDir, { recursive: true });
const port = process.env.EYEPROTECT_TAURI_CDP_PORT
  ? Number(process.env.EYEPROTECT_TAURI_CDP_PORT)
  : await getAvailablePort();

console.log(`[smoke:tauri] launching ${exe}`);
console.log(`[smoke:tauri] data dir ${dataDir}, CDP port ${port}`);
const child = spawn(exe, [], {
  env: {
    ...process.env,
    EYEPROTECT_DATA_DIR: dataDir,
    EYEPROTECT_SMOKE: '1',
    WEBVIEW2_USER_DATA_FOLDER: join(dataDir, 'webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: false
});
let stderrTail = '';
child.stderr.on('data', (chunk) => {
  stderrTail = (stderrTail + chunk.toString()).slice(-2_000);
});
child.stdout.on('data', () => {});

const endpoint = `http://127.0.0.1:${port}`;
const capture = async (target, name) => {
  const session = await openSession(target);
  try {
    const screenshot = await session.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(join(outputDir, `${name}.png`), Buffer.from(screenshot.data, 'base64'));
  } finally {
    session.close();
  }
};
let workbench;
try {
  // 1. The pet window loads the SPA and the Tauri bridge installs before render.
  const pet = await waitForTarget(endpoint, '#pet', 20_000);
  // The bridge installs via a dynamic import: poll instead of probing once.
  await waitFor(pet, 'typeof window.eyeProtect === \'object\'', 15_000);
  await waitFor(pet, '!!document.querySelector(\'main.pet-shell\')', 12_000);
  await evaluate(pet, `window.eyeProtect.saveSettings({ petMotion: false })`);
  await waitFor(pet, `document.querySelector('canvas.pet-image')?.width > 0`);
  assert.ok(await evaluate(pet, `(() => {
    const canvas = document.querySelector('canvas.pet-image');
    return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0);
  })()`), 'the static GIF snapshot must contain the companion artwork');
  await evaluate(pet, `window.eyeProtect.saveSettings({ petMotion: true })`);
  console.log('[smoke:tauri] pet window renders the React shell');

  // 2. Invoke round-trip: settings read + write.
  const interval = await evaluate(pet, '((async () => (await window.eyeProtect.getSettings()).eyeIntervalMinutes)())');
  if (interval !== 20) throw new Error(`unexpected default eyeIntervalMinutes: ${interval}`);
  const saved = await evaluate(pet, '((async () => (await window.eyeProtect.saveSettings({ snoozeMinutes: 7 })).snoozeMinutes)())');
  if (saved !== 7) throw new Error(`settings save did not apply: ${saved}`);
  console.log('[smoke:tauri] settings invoke round-trip ok');

  // 3. Reminder status exposes the running scheduler.
  const status = await evaluate(pet, '((async () => await window.eyeProtect.getReminderStatus())())');
  if (typeof status.nextEyeAt !== 'number' || status.activeReminder !== null) {
    throw new Error(`unexpected reminder status: ${JSON.stringify(status).slice(0, 200)}`);
  }
  console.log('[smoke:tauri] reminder scheduler responds');

  // 4. Open the workbench and create a task through the real command layer.
  // Fire-and-forget: the invoke resolves only after the window is built.
  await evaluate(pet, 'void window.eyeProtect.openWorkbench(\'today\'); true');
  workbench = await waitForTarget(endpoint, '#workbench', 25_000);
  await waitFor(workbench, '!!document.querySelector(\'#root\') && document.querySelector(\'#root\').children.length > 0', 12_000);
  await waitFor(workbench, `Boolean(document.querySelector('.simple-empty-state'))`);
  await evaluate(workbench, `window.eyeProtect.getWorkbenchSection()`);
  await delay(250);
  await evaluate(workbench, `document.querySelector('[aria-label="设置"]').click()`);
  await waitFor(workbench, `Boolean(document.querySelector('[href="#settings-appearance"]'))`);
  await evaluate(workbench, `document.querySelector('[href="#settings-appearance"]').click()`);
  await waitFor(workbench, `document.activeElement === document.querySelector('#settings-appearance h2')`);
  assert.equal(await evaluate(workbench, `location.hash`), '#workbench');
  assert.ok(await evaluate(workbench, `document.querySelector('#settings-appearance').getBoundingClientRect().top >= document.querySelector('.simple-header').getBoundingClientRect().bottom`));
  await waitFor(workbench, `Boolean(document.querySelector('[data-companion-option="otter"]:not(:disabled)'))`);
  await evaluate(workbench, `document.querySelector('.simple-companion-picker').scrollIntoView({block: 'center'})`);
  await capture(workbench, 'companion-picker');
  await evaluate(workbench, `document.querySelector('[data-companion-option="otter"]').click()`);
  await waitFor(pet, `document.querySelector('.illustrated-pet')?.dataset.companion === 'otter'`);
  const petSession = await openSession(pet);
  await petSession.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await waitFor(pet, `!document.hidden && document.querySelector('.illustrated-pet')?.dataset.action === 'idle'`);
  assert.ok(await evaluate(pet, `(async () => {
    const body = document.querySelector('.illustrated-pet-body');
    const initial = body.getAttribute('transform');
    for (let i = 0; i < 35; i += 1) {
      if (body.getAttribute('transform') !== initial) return true;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  })()`), 'Tauri pixel idle should advance through whole-grid breathing frames');
  await petSession.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await waitFor(pet, `document.querySelector('.illustrated-pet')?.dataset.frame === '0'`);
  assert.equal(await evaluate(pet, `getComputedStyle(document.querySelector('.illustrated-pet-body')).transitionDuration`), '0s');
  petSession.close();
  console.log('[smoke:tauri] repeatedly switching companions, including pixel');
  for (const companion of ['fighter', 'pixel', 'otter', 'pixel', 'penguin', 'pixel', 'fighter', 'pixel']) {
    await waitFor(workbench, `Boolean(document.querySelector('[data-companion-option="${companion}"]:not(:disabled)'))`);
    await evaluate(workbench, `document.querySelector('[data-companion-option="${companion}"]').click()`);
    if (companion === 'pixel') {
      // The freshly mounted pixel artwork reports its silhouette while the
      // backend is resizing the pet window. Exercise overlapping reports.
      await evaluate(pet, `Promise.all(Array.from({length: 16}, (_, i) => window.eyeProtect.reportPetArtworkBounds({top: .1 + i / 1000, bottom: .9})))`, 6_000);
    }
    await waitFor(workbench, `Boolean(document.querySelector('[data-companion-option="${companion}"][aria-pressed="true"]:not(:disabled)'))`, 8_000);
    assert.equal((await evaluate(pet, `window.eyeProtect.getSettings()`, 3_000)).petCompanion, companion);
    assert.ok(await evaluate(workbench, `window.eyeProtect.getReminderStatus()`, 3_000));
    if (companion === 'pixel') {
      await waitFor(pet, `Boolean(document.querySelector('.pet-character .pixel-animal'))`, 8_000);
      await evaluate(pet, `document.querySelector('.pet-drag-surface').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))`);
      await waitFor(pet, `document.querySelector('.pixel-animal')?.dataset.action === 'react'`, 8_000);
      assert.equal((await evaluate(workbench, `window.eyeProtect.getSettings()`, 3_000)).petCompanion, 'pixel');
    }
  }
  await waitFor(workbench, `document.querySelectorAll('[data-outfit-option]').length === 4`);
  await evaluate(workbench, `document.querySelector('.simple-pet-outfits').scrollIntoView({block: 'center'})`);
  await capture(workbench, 'pixel-outfits');
  for (const outfit of ['coffee', 'explorer', 'stargazer', 'classic']) {
    await waitFor(workbench, `Boolean(document.querySelector('[data-outfit-option="${outfit}"]:not(:disabled)'))`);
    await evaluate(workbench, `document.querySelector('[data-outfit-option="${outfit}"]').click()`);
    await waitFor(workbench, `Boolean(document.querySelector('[data-outfit-option="${outfit}"][aria-pressed="true"]:not(:disabled)'))`);
    await waitFor(pet, `document.querySelector('.pet-character .pixel-animal')?.dataset.outfit === '${outfit}'`);
    await evaluate(pet, `document.querySelector('.pet-drag-surface').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))`);
    await waitFor(pet, `document.querySelector('.pet-character .pixel-animal')?.dataset.action === 'react'`);
    assert.equal((await evaluate(workbench, `window.eyeProtect.getSettings()`)).petOutfit, outfit);
  }
  await evaluate(workbench, `document.querySelector('[data-companion-option="otter"]').click()`);
  await waitFor(pet, `document.querySelector('.illustrated-pet')?.dataset.companion === 'otter'`, 8_000);
  console.log('[smoke:tauri] pixel companion selection and click remain responsive');
  await evaluate(workbench, `document.querySelector('nav[aria-label="主导航"] button').click()`);
  await waitFor(workbench, `document.querySelector('.simple-empty-animal .illustrated-pet')?.dataset.companion === 'otter'`);
  await capture(workbench, 'empty');
  await evaluate(workbench, `(() => {
    const input = document.querySelector('[aria-label="添加任务"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Tauri 冒烟任务');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(workbench, `Boolean(document.querySelector('.simple-composer button.primary:not(:disabled)'))`);
  await evaluate(workbench, `document.querySelector('.simple-composer button.primary').click()`);
  await waitFor(workbench, `Boolean(document.querySelector('.simple-queue-row'))`);
  const created = await evaluate(workbench, 'window.eyeProtect.getTasks()');
  if (created.length !== 1) throw new Error(`createTask returned ${created.length} rows`);
  const titles = await evaluate(workbench, '((async () => (await window.eyeProtect.getTasks()).map((task) => task.title))())');
  if (!titles.includes('Tauri 冒烟任务')) throw new Error('created task not visible in task list');
  // A visible task bubble causes both artwork-bounds reports and window
  // geometry queries during switching. Exercise the formerly risky overlap.
  await evaluate(workbench, `window.eyeProtect.saveSettings({todoBubbleEnabled: true, todoBubbleTaskIds: [${JSON.stringify(created[0].id)}]})`);
  const bubble = await waitForTarget(endpoint, '#bubble', 25_000);
  await waitFor(bubble, `Boolean(document.querySelector('#root')?.children.length)`);
  await evaluate(workbench, `document.querySelector('[aria-label="设置"]').click()`);
  await waitFor(workbench, `Boolean(document.querySelector('[data-companion-option="pixel"]:not(:disabled)'))`);
  for (let i = 0; i < 16; i += 1) {
    const companion = i % 2 === 0 ? 'pixel' : ['fighter', 'otter', 'penguin'][Math.floor(i / 2) % 3];
    await evaluate(workbench, `document.querySelector('[data-companion-option="${companion}"]').click()`);
    await evaluate(pet, `Promise.all(Array.from({length: 8}, (_, n) => window.eyeProtect.reportPetArtworkBounds({top: .1 + n / 1000, bottom: .9})))`, 6_000);
    await waitFor(workbench, `Boolean(document.querySelector('[data-companion-option="${companion}"][aria-pressed="true"]:not(:disabled)'))`, 8_000);
    const live = await evaluate(pet, `Promise.all([window.eyeProtect.getSettings(), window.eyeProtect.getReminderStatus()])`, 6_000);
    assert.equal(live[0].petCompanion, companion);
    assert.ok(live[1]);
  }
  await evaluate(workbench, `document.querySelector('[data-companion-option="otter"]').click()`);
  await waitFor(pet, `document.querySelector('.illustrated-pet')?.dataset.companion === 'otter'`);
  await evaluate(workbench, `document.querySelector('nav[aria-label="主导航"] button').click()`);
  console.log('[smoke:tauri] companion switching with a visible task bubble stays responsive');
  await waitFor(workbench, `Boolean(document.querySelector('.simple-queue-row'))`);
  await capture(workbench, 'workbench');
  await evaluate(workbench, `window.__originalScrollIntoView = Element.prototype.scrollIntoView; window.__focusedTasks = []; Element.prototype.scrollIntoView = function(options) { window.__focusedTasks.push({ id: this.id, behavior: options.behavior }); }`);
  await evaluate(pet, `void window.eyeProtect.openWorkbench('today', ${JSON.stringify(created[0].id)}); true`);
  await waitFor(workbench, `window.__focusedTasks.some(item => item.id === ${JSON.stringify(`simple-task-${created[0].id}`)})`);
  assert.ok(await evaluate(workbench, `Boolean(document.querySelector('[data-task-id="${created[0].id}"] .simple-task-fields'))`));
  await evaluate(workbench, `Element.prototype.scrollIntoView = window.__originalScrollIntoView; document.querySelector('[data-task-id="${created[0].id}"] .simple-task-name').click()`);
  const longTasks = await evaluate(workbench, `window.eyeProtect.createTask({title: '长标题 ' + 'UnbrokenTitle'.repeat(16)})`);
  const longTask = longTasks.find(task => task.title.startsWith('长标题'));
  await evaluate(workbench, `window.eyeProtect.createStep(${JSON.stringify(longTask.id)}, '长步骤 ' + 'UnbrokenStep'.repeat(18))`);
  await waitFor(workbench, `Boolean(document.querySelector('[data-task-id="${longTask.id}"] .simple-step-chip'))`);
  const workbenchSession = await openSession(workbench);
  await workbenchSession.call('Emulation.setDeviceMetricsOverride', { width: 520, height: 650, deviceScaleFactor: 1, mobile: false });
  await evaluate(workbench, `document.querySelector('[data-task-id="${longTask.id}"]').scrollIntoView({block:'center'})`);
  assert.ok(await evaluate(workbench, `(() => {
    const shell = document.querySelector('.simple-workbench');
    const row = document.querySelector('[data-task-id="${longTask.id}"]');
    const chip = row.querySelector('.simple-step-chip').getBoundingClientRect();
    return shell.scrollWidth <= shell.clientWidth + 1 && chip.right <= row.getBoundingClientRect().right + 1;
  })()`), 'long step names must wrap within the Tauri workbench');
  await capture(workbench, 'long-content');
  await workbenchSession.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await evaluate(workbench, `document.querySelector('.simple-queue-row input[type="checkbox"]').click()`);
  await waitFor(workbench, `Boolean(document.querySelector('.simple-queue-check.did-celebrate'))`);
  assert.equal(await evaluate(workbench, `getComputedStyle(document.querySelector('.simple-queue-check.did-celebrate .simple-queue-dot'), '::before').animationName`), 'none');
  workbenchSession.close();
  await evaluate(pet, `void window.eyeProtect.testReminder('eye'); true`);
  const alert = await waitForTarget(endpoint, '#alert', 25_000);
  await waitFor(alert, `Boolean(document.querySelector('.rest-title'))`);
  await capture(alert, 'alert');
  await waitFor(alert, `Boolean(document.querySelector('.rest-prop-animated'))`);
  await evaluate(alert, `Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'))`);
  await waitFor(alert, `!document.querySelector('.rest-prop-animated')`);
  await evaluate(alert, `delete document.hidden; document.dispatchEvent(new Event('visibilitychange'))`);
  console.log('[smoke:tauri] workbench renders, task create + list round-trip ok');
  console.log('[smoke:tauri] settings navigation, task targeting, companion motion, long text, reduced motion and alert render verified');

  // 5. Kill the app, then verify persistence in the fresh data store.
} catch (error) {
  if (workbench) {
    try {
      console.error('[smoke:tauri] workbench state', await evaluate(workbench, `({hash:location.hash, focus:document.activeElement?.outerHTML.slice(0, 300), hasFocus:document.hasFocus(), settings:!!document.querySelector('.simple-settings'), scrollTop:document.querySelector('.simple-workbench')?.scrollTop})`));
    } catch {}
  }
  fail(`${error.message}${stderrTail ? `\nstderr: ${stderrTail}` : ''}`);
} finally {
  // Kill the app AND its WebView2 child processes (plain kill() orphans them).
  if (process.platform === 'win32' && child.pid) {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      child.kill();
    }
  } else {
    child.kill();
  }
  await delay(1_500);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await delay(500);
  }
}

if (!process.exitCode) {
  try {
    const settings = JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8'));
    if (settings.snoozeMinutes !== 7) throw new Error(`settings.json snoozeMinutes = ${settings.snoozeMinutes}, expected 7`);
    const store = JSON.parse(await readFile(join(dataDir, 'tasks.json'), 'utf8'));
    if (!store.tasks.some((task) => task.title === 'Tauri 冒烟任务')) {
      const files = await readdir(dataDir);
      throw new Error(`task not persisted; files: ${files.join(', ')}`);
    }
    console.log('[smoke:tauri] persistence verified (settings.json + tasks.json)');
    console.log('[smoke:tauri] PASS');
  } catch (error) {
    fail(`persistence check failed: ${error.message}`);
  }
}
if (dirname(dataDir).toLowerCase() !== tempRoot.toLowerCase() || !basename(dataDir).startsWith('eyeprotect-tauri-smoke-')) {
  throw new Error(`Refusing to remove unexpected temporary directory: ${dataDir}`);
}
await rm(dataDir, { recursive: true, force: true });
