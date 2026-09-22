import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { getAvailablePort, call, delay, evaluate, waitFor, waitForTarget, openSession } from './lib/cdp.mjs';

const scale = Number(process.argv[2] ?? 1);
const output = resolve(`artifacts/pet-ui/${scale}`);
const runtime = resolve(output, `run-${Date.now()}`);
mkdirSync(output, { recursive: true });
const port = await getAvailablePort();
const packaged = process.argv.includes('--packaged');
const child = spawn(resolve(packaged ? 'release/win-unpacked/EyeProtect.exe' : 'node_modules/electron/dist/electron.exe'), [
  ...(!packaged ? ['.'] : []), `--remote-debugging-port=${port}`, `--force-device-scale-factor=${scale}`,
  `--user-data-dir=${resolve(runtime, 'profile')}`, '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-background-timer-throttling'
], { windowsHide: true, env: { ...process.env, EYEPROTECT_SMOKE: '1', EYEPROTECT_DATA_DIR: resolve(runtime, 'data') } });
let log = '';
child.stderr.on('data', (data) => { log += data; });
const capture = async (page, name) => {
  const result = await call(page, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve(output, `${name}.png`), Buffer.from(result.data, 'base64'));
};
try {
  const endpoint = `http://127.0.0.1:${port}`;
  const pet = await waitForTarget(endpoint, '#pet');
  const session = await openSession(pet);
  await session.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await waitFor(pet, 'Boolean(window.eyeProtect)');
  await evaluate(pet, `window.eyeProtect.saveSettings({ eyeEnabled: false, walkEnabled: false })`);
  await evaluate(pet, `window.eyeProtect.openWorkbench('settings')`);
  const workbench = await waitForTarget(endpoint, '#workbench');
  await waitFor(workbench, `Boolean(document.querySelector('.simple-settings'))`);
  for (const theme of ['light', 'dark']) {
    await evaluate(pet, `window.eyeProtect.saveSettings({ theme: '${theme}' })`);
    await waitFor(workbench, `document.documentElement.dataset.theme === '${theme}'`);
    const geometry = await evaluate(workbench, `(() => {
      const button = document.querySelector('.simple-setting-switch');
      const track = button.querySelector('.simple-setting-switch-track');
      const b = button.getBoundingClientRect(), t = track.getBoundingClientRect();
      const css = getComputedStyle(button);
      return { width: b.width, height: b.height, track: t.width, padding: css.padding, background: css.backgroundColor,
        contained: t.left >= b.left && t.right <= b.right, overflow: document.querySelector('.simple-workbench').scrollWidth > innerWidth };
    })()`);
    assert.deepEqual(geometry, { width: 44, height: 44, track: 44, padding: '0px', background: 'rgba(0, 0, 0, 0)', contained: true, overflow: false });
    await capture(workbench, `settings-${theme}`);
    await evaluate(workbench, `document.querySelector('#settings-appearance').scrollIntoView()`);
    await delay(100);
    await capture(workbench, `characters-${theme}`);
    await evaluate(workbench, `document.querySelector('.simple-workbench').scrollTo(0, 0)`);
  }
  await evaluate(workbench, `document.querySelector('.simple-setting-switch').focus()`);
  await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await waitFor(workbench, `document.querySelector('.simple-setting-switch').getAttribute('aria-checked') === 'true'`);
  assert.equal(await evaluate(workbench, `(() => {
    const t = document.querySelector('.simple-setting-switch-track').getBoundingClientRect();
    const h = document.querySelector('.simple-setting-switch-handle').getBoundingClientRect();
    return h.left >= t.left && h.right <= t.right && h.top >= t.top && h.bottom <= t.bottom;
  })()`), true);

  // 奋斗猫 is the only pet: pixel fallback, motion toggles, custom GIF at root.
  await evaluate(pet, `window.eyeProtect.saveSettings({ petMotion: true })`);
  await waitFor(pet, `document.querySelector('.pixel-animal')?.dataset.animal === 'cat'`);
  await capture(pet, 'fendou-cat-idle');
  await evaluate(pet, `document.querySelector('.pet-drag-surface').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))`);
  await waitFor(pet, `Number(document.querySelector('.pixel-animal')?.dataset.frame) >= 2`);
  await capture(pet, 'fendou-cat-react');
  await session.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await evaluate(pet, `document.querySelector('.pet-drag-surface').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))`);
  await delay(450);
  assert.equal(await evaluate(pet, `document.querySelector('.pixel-animal').dataset.frame`), '0');
  await session.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await evaluate(pet, `window.eyeProtect.saveSettings({ petMotion: false })`);
  await delay(450);
  assert.equal(await evaluate(pet, `document.querySelector('.pixel-animal').dataset.frame`), '0');

  await evaluate(pet, `window.eyeProtect.saveSettings({ petMotion: true, reminderMode: 'guided' })`);
  const reminder = await evaluate(pet, `window.eyeProtect.testReminder('eye')`);
  const alert = await waitForTarget(endpoint, '#alert');
  await waitFor(alert, `Boolean(document.querySelector('.pixel-animal'))`);
  await evaluate(alert, `[...document.querySelectorAll('.rest-mode-btn')].find(button => button.textContent.includes('萌宠小憩')).click()`);
  await evaluate(alert, `window.eyeProtect.beginHealthRest('${reminder.activeReminder.id}')`);
  await waitFor(alert, `document.querySelector('.pixel-animal').dataset.action === 'sleep'`);
  await capture(alert, 'rest-sleep');
  await evaluate(pet, `window.eyeProtect.reminderAction('skip', '${reminder.activeReminder.id}')`);
  await waitFor(pet, `document.hidden === false`);

  // User GIFs in custom-pet root personalize 奋斗猫.
  const customDir = resolve(runtime, 'data/custom-pet');
  mkdirSync(customDir, { recursive: true });
  writeFileSync(resolve(customDir, 'idle.gif'), Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  await evaluate(pet, `window.eyeProtect.saveSettings({ petMotion: false })`);
  await waitFor(pet, `Boolean(document.querySelector('img.pet-image') || document.querySelector('canvas.pet-image'))`);
  const custom = await evaluate(pet, `window.eyeProtect.getCustomPetAssets()`);
  assert.equal(custom.hasCustomPet, true);
  assert.equal(custom.idles.length, 1);
  console.log(`Settings geometry, keyboard switch, 奋斗猫 and reduced motion passed at ${scale}.`);
  session.close();
} finally {
  writeFileSync(resolve(output, 'app.log'), log);
  if (child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
}
