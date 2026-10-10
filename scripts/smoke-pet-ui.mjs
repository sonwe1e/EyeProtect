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
  const workbenchSession = await openSession(workbench);
  const artwork = [];
  await workbenchSession.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
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
  await waitFor(pet, `document.querySelector('.pixel-animal')?.dataset.action === 'idle' && Number(document.querySelector('.pixel-animal')?.dataset.frame) >= 10`);
  await capture(pet, 'fendou-cat-idle');
  await waitFor(pet, `document.querySelector('.pixel-animal')?.dataset.action === 'idle' && Number(document.querySelector('.pixel-animal')?.dataset.frame) % 50 === 43`);
  await capture(pet, 'fendou-cat-blink');
  await evaluate(pet, `window.eyeProtect.saveSettings({ petScale: 0.5 })`);
  await waitFor(pet, `innerWidth === 80`);
  await capture(pet, 'fendou-cat-small');
  await evaluate(pet, `window.eyeProtect.saveSettings({ petScale: 1 })`);
  await evaluate(pet, `document.querySelector('.pet-drag-surface').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))`);
  await waitFor(pet, `document.querySelector('.pixel-animal')?.dataset.action === 'react' && Number(document.querySelector('.pixel-animal')?.dataset.frame) >= 2`);
  await capture(pet, 'fendou-cat-react');

  // Selection goes through the real command layer and reaches every cat surface.
  await evaluate(workbench, `document.querySelector('[data-outfit-option="coffee"]').focus()`);
  await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await waitFor(pet, `document.querySelector('.pixel-animal')?.dataset.outfit === 'coffee'`);
  for (const outfit of ['classic', 'coffee', 'explorer', 'stargazer']) {
    await waitFor(workbench, `document.querySelector('[data-outfit-option="${outfit}"]')?.disabled === false`);
    await evaluate(workbench, `document.querySelector('[data-outfit-option="${outfit}"]').click()`);
    await waitFor(pet, `document.querySelector('.pixel-animal')?.dataset.outfit === '${outfit}'`);
    assert.equal((await evaluate(pet, `window.eyeProtect.getSettings()`)).petOutfit, outfit);
    await waitFor(workbench, `document.querySelector('.simple-pet-try-button')?.disabled === false`);
    await evaluate(workbench, `document.querySelector('.simple-pet-try-button').click()`);
    await waitFor(workbench, `document.querySelector('[aria-pressed="true"] .pixel-animal')?.dataset.action === 'react' && [3, 4, 5].includes(Number(document.querySelector('[aria-pressed="true"] .pixel-animal')?.dataset.frame))`);
    await evaluate(pet, `document.querySelector('.pet-drag-surface').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))`);
    await waitFor(pet, `document.querySelector('.pixel-animal')?.dataset.action === 'react' && [3, 4, 5].includes(Number(document.querySelector('.pixel-animal')?.dataset.frame))`);
    assert.equal(await evaluate(pet, `(() => {
      const box = document.querySelector('.pixel-animal svg').getBBox();
      return box.x >= 0 && box.y >= 0 && box.x + box.width <= 64 && box.y + box.height <= 64;
    })()`), true, `${outfit} interaction must fit the artwork grid`);
    await capture(pet, `outfit-${outfit}-interaction`);
    const interaction = await evaluate(pet, `document.querySelector('.pixel-animal svg').outerHTML`);
    await evaluate(pet, `window.eyeProtect.saveSettings({ petMotion: false, petScale: 0.5 })`);
    await waitFor(pet, `innerWidth === 80 && document.querySelector('.pixel-animal')?.dataset.frame === '0'`);
    await capture(pet, `outfit-${outfit}-small`);
    const idle = await evaluate(pet, `document.querySelector('.pixel-animal svg').outerHTML`);
    const name = await evaluate(workbench, `document.querySelector('[data-outfit-option="${outfit}"] .simple-pet-name').textContent`);
    const action = await evaluate(workbench, `document.querySelector('.simple-pet-try-button').textContent.trim().replace('试试动作：', '')`);
    artwork.push({ name, action, idle, interaction });
    await evaluate(pet, `window.eyeProtect.saveSettings({ petMotion: true, petScale: 1 })`);
  }
  await evaluate(workbench, `document.querySelector('#settings-appearance').scrollIntoView()`);
  await capture(workbench, 'outfit-picker');
  await waitFor(workbench, `document.querySelector('[aria-pressed="true"] .pixel-animal')?.dataset.action === 'idle'`);
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
  assert.equal(await evaluate(alert, `document.querySelector('.pixel-animal').dataset.outfit`), 'stargazer');
  await evaluate(alert, `[...document.querySelectorAll('.rest-mode-btn')].find(button => button.textContent.includes('萌宠小憩')).click()`);
  await evaluate(alert, `window.eyeProtect.beginHealthRest('${reminder.activeReminder.id}')`);
  await waitFor(alert, `['gaze', 'blink', 'sleep', 'breathe', 'walk', 'stretch'].includes(document.querySelector('.pixel-animal').dataset.action)`);
  await capture(alert, 'rest-step-action');
  await evaluate(pet, `window.eyeProtect.reminderAction('skip', '${reminder.activeReminder.id}')`);
  await waitFor(pet, `document.hidden === false`);

  // User GIFs in custom-pet root personalize 奋斗猫.
  const customDir = resolve(runtime, 'data/custom-pet');
  mkdirSync(customDir, { recursive: true });
  writeFileSync(resolve(customDir, 'idle.gif'), Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  await evaluate(pet, `window.dispatchEvent(new Event('focus'))`);
  await evaluate(pet, `window.eyeProtect.saveSettings({ petMotion: false })`);
  await waitFor(pet, `Boolean(document.querySelector('img.pet-image') || document.querySelector('canvas.pet-image'))`);
  const custom = await evaluate(pet, `window.eyeProtect.getCustomPetAssets()`);
  assert.equal(custom.hasCustomPet, true);
  assert.equal(custom.idles.length, 1);
  // A review image uses the actual idle and interaction SVGs captured above.
  await evaluate(workbench, `(() => {
    const proof = document.createElement('section');
    proof.id = 'outfit-proof';
    proof.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;width:1040px;padding:32px;background:#fff9ed;color:#34303d;font-family:Microsoft YaHei,sans-serif;box-sizing:border-box';
    proof.innerHTML = '<h1 style="margin:0 0 8px;font-size:24px">奋斗猫的四套装扮</h1><p style="margin:0 0 24px;font-size:14px">同一只橘猫，换一身衣服，也换一个小小的回应。</p><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">' +
      ${JSON.stringify(artwork)}.map(item => '<article style="padding:16px;text-align:center;background:#f1eadc;border-radius:16px"><h2 style="font-size:17px;margin:0 0 12px">' + item.name + '</h2><div style="width:160px;height:160px;margin:auto">' + item.idle + '</div><p style="font-size:12px;margin:4px 0 20px">待机造型</p><div style="width:128px;height:128px;margin:auto">' + item.interaction + '</div><p style="font-size:13px;margin:8px 0 0">' + item.action + '</p></article>').join('') + '</div>';
    proof.querySelectorAll('svg').forEach(svg => { svg.style.cssText = 'width:100%;height:100%;image-rendering:pixelated'; });
    document.body.append(proof);
  })()`);
  const proofRect = await evaluate(workbench, `(() => { const r = document.querySelector('#outfit-proof').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 }; })()`);
  const proofScreenshot = await call(workbench, 'Page.captureScreenshot', { format: 'png', clip: proofRect });
  writeFileSync(resolve(output, 'outfit-overview.png'), Buffer.from(proofScreenshot.data, 'base64'));
  console.log(`Settings geometry, keyboard switch, all outfits, rest steps and reduced motion passed at ${scale}.`);
  workbenchSession.close();
  session.close();
} finally {
  writeFileSync(resolve(output, 'app.log'), log);
  if (child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
}
