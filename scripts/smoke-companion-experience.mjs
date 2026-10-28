import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { getAvailablePort, call, delay, evaluate, waitFor, waitForTarget, openSession } from './lib/cdp.mjs';

const scale = Number(process.argv[2] ?? 1);
const output = resolve(`artifacts/companion-ui/${scale}`);
const runtime = resolve(output, `run-${Date.now()}`);
mkdirSync(output, { recursive: true });
const port = await getAvailablePort();
const packaged = process.argv.includes('--packaged');
const child = spawn(resolve(packaged ? 'release/win-unpacked/EyeProtect.exe' : 'node_modules/electron/dist/electron.exe'), [
  ...(!packaged ? ['.'] : []), `--remote-debugging-port=${port}`, `--force-device-scale-factor=${scale}`, `--user-data-dir=${resolve(runtime, 'profile')}`,
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'
], { windowsHide: true, env: { ...process.env, EYEPROTECT_SMOKE: '1', EYEPROTECT_DATA_DIR: resolve(runtime, 'data') } });
let log = '';
child.stderr.on('data', data => { log += data; });
const capture = async (page, name, viewport) => {
  const frame = await call(page, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, ...(viewport ? {clip: {x: 0, y: 0, ...viewport, scale: 1}} : {}) });
  writeFileSync(resolve(output, `${name}.png`), Buffer.from(frame.data, 'base64'));
};
try {
  const endpoint = `http://127.0.0.1:${port}`;
  const pet = await waitForTarget(endpoint, '#pet');
  const session = await openSession(pet);
  await session.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await waitFor(pet, `document.querySelector('img.pet-image')?.naturalWidth > 100`);
  assert.equal((await evaluate(pet, 'window.eyeProtect.getSettings()')).petCompanion, 'fighter');
  assert.match(await evaluate(pet, `document.querySelector('img.pet-image').src`), /assets\/pets\/fighter\/idle\.gif$/);
  await capture(pet, 'original-fighter');
  await evaluate(pet, `window.eyeProtect.saveSettings({ eyeEnabled: false, walkEnabled: false, eyeRestSeconds: 30 })`);
  await evaluate(pet, `window.eyeProtect.openWorkbench('settings')`);
  const workbench = await waitForTarget(endpoint, '#workbench');
  await waitFor(workbench, `document.querySelectorAll('[data-companion-option]').length === 4`);
  await evaluate(workbench, `document.querySelector('[href="#settings-appearance"]').click()`);
  await waitFor(workbench, `document.querySelector('.simple-workbench').scrollTop > 0`);
  assert.equal(await evaluate(workbench, `location.hash`), '#workbench', 'section navigation must preserve the trusted renderer route');
  assert.ok(await evaluate(workbench, `document.querySelector('#settings-appearance').getBoundingClientRect().top >= document.querySelector('.simple-header').getBoundingClientRect().bottom`), 'settings anchors must not hide headings behind the sticky header');
  assert.equal(await evaluate(workbench, `document.activeElement === document.querySelector('#settings-appearance h2')`), true, 'section navigation should move keyboard focus to the heading');
  await evaluate(workbench, `document.querySelector('.simple-companion-picker').scrollIntoView({block: 'center'})`);
  await capture(workbench, 'companion-picker');
  for (const companion of ['otter', 'penguin']) {
    await waitFor(workbench, `document.querySelector('[data-companion-option="${companion}"]').disabled === false`);
    await evaluate(workbench, `document.querySelector('[data-companion-option="${companion}"]').focus()`);
    await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' });
    await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await waitFor(pet, `document.querySelector('.illustrated-pet')?.dataset.companion === '${companion}'`);
    assert.equal((await evaluate(pet, 'window.eyeProtect.getSettings()')).petCompanion, companion);
    await capture(pet, `${companion}-idle`);
    await evaluate(pet, `document.querySelector('.pet-drag-surface').dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 1}))`);
    await waitFor(pet, `document.querySelector('.illustrated-pet')?.dataset.action === 'react' && Number(document.querySelector('.illustrated-pet').dataset.frame) >= 3`);
    await capture(pet, `${companion}-interaction`);
    assert.ok(await evaluate(pet, `(() => { const b = document.querySelector('.illustrated-pet svg').getBBox(); return b.x >= 0 && b.y >= 0 && b.x+b.width <= 64 && b.y+b.height <= 64; })()`));
    await evaluate(pet, `window.eyeProtect.saveSettings({petMotion: false, petScale: .5})`);
    await waitFor(pet, `innerWidth === 100 && document.querySelector('.illustrated-pet')?.dataset.frame === '0'`);
    await capture(pet, `${companion}-small`);
    await evaluate(pet, `window.eyeProtect.saveSettings({petMotion: true, petScale: 1})`);
  }
  // The empty workbench should show the chosen companion. Pixel idle changes
  // whole frames instead of interpolating between grid positions.
  await evaluate(pet, `window.eyeProtect.saveSettings({petCompanion: 'otter', petMotion: true})`);
  await waitFor(pet, `document.querySelector('.illustrated-pet')?.dataset.companion === 'otter' && document.querySelector('.illustrated-pet')?.dataset.action === 'idle'`);
  await evaluate(pet, `window.eyeProtect.openWorkbench('today')`);
  await waitFor(workbench, `document.querySelector('.simple-empty-animal .illustrated-pet')?.dataset.companion === 'otter'`);
  assert.ok(await evaluate(pet, `(async () => {
    const body = document.querySelector('.illustrated-pet-body');
    const initial = body.getAttribute('transform');
    for (let i = 0; i < 35; i += 1) {
      if (body.getAttribute('transform') !== initial) return true;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  })()`), 'pixel idle should advance through whole-grid breathing frames');

  // Test the actual completion feedback, including the pseudo-element, under
  // the system motion preference; the static completed state must remain.
  const workbenchSession = await openSession(workbench);
  await workbenchSession.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await evaluate(pet, `window.eyeProtect.createTask({title: '动画偏好测试'})`);
  await waitFor(workbench, `Boolean(document.querySelector('.simple-queue-check input'))`);
  const motionTask = (await evaluate(pet, 'window.eyeProtect.getTasks()')).find(task => task.title === '动画偏好测试');
  await evaluate(workbench, `window.__originalScrollIntoView = Element.prototype.scrollIntoView; window.__scrollOptions = []; Element.prototype.scrollIntoView = function(options) { window.__scrollOptions.push(options); }`);
  await evaluate(pet, `window.eyeProtect.openWorkbench('today', ${JSON.stringify(motionTask.id)})`);
  await waitFor(workbench, `window.__scrollOptions.length > 0`);
  assert.equal(await evaluate(workbench, `window.__scrollOptions.at(-1).behavior`), 'smooth', 'task navigation should locate the requested task');
  await evaluate(workbench, `window.__scrollOptions = []`);
  await workbenchSession.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await evaluate(workbench, `document.querySelector('.simple-queue-check input').click()`);
  await waitFor(workbench, `Boolean(document.querySelector('.simple-queue-check.did-celebrate'))`);
  assert.equal(await evaluate(workbench, `getComputedStyle(document.querySelector('.simple-queue-check.did-celebrate .simple-queue-dot'), '::before').animationName`), 'none');
  assert.ok(await evaluate(workbench, `Boolean(document.querySelector('.simple-queue-check.is-done'))`));
  await evaluate(pet, `window.eyeProtect.openWorkbench('today', ${JSON.stringify(motionTask.id)})`);
  await waitFor(workbench, `window.__scrollOptions.length > 0`);
  assert.equal(await evaluate(workbench, `window.__scrollOptions.at(-1).behavior`), 'auto', 'task navigation must not smooth-scroll under reduced motion');
  await evaluate(workbench, `Element.prototype.scrollIntoView = window.__originalScrollIntoView`);
  const longTasks = await evaluate(pet, `window.eyeProtect.createTask({title: '长标题 ' + 'UnbrokenTitle'.repeat(16)})`);
  const longTask = longTasks.find(task => task.title.startsWith('长标题'));
  await evaluate(pet, `window.eyeProtect.createStep(${JSON.stringify(longTask.id)}, '长步骤 ' + 'UnbrokenStep'.repeat(18))`);
  await waitFor(workbench, `Boolean(document.querySelector('[data-task-id="${longTask.id}"] .simple-step-chip'))`);
  assert.ok(await evaluate(workbench, `(() => {
    const shell = document.querySelector('.simple-workbench');
    const row = document.querySelector('[data-task-id="${longTask.id}"]');
    const chip = row.querySelector('.simple-step-chip').getBoundingClientRect();
    return shell.scrollWidth <= shell.clientWidth + 1 && chip.right <= row.getBoundingClientRect().right + 1;
  })()`), 'long unbroken step names must wrap within the workbench');
  workbenchSession.close();

  await evaluate(pet, `window.eyeProtect.saveSettings({ petCompanion: 'fighter', petMotion: false })`);
  await waitFor(pet, `document.querySelector('canvas.pet-image')?.width > 100`);
  assert.ok(await evaluate(pet, `(() => { const c = document.querySelector('canvas.pet-image'); return c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i) => i%4 === 3 && v > 0); })()`), 'frozen GIF must contain artwork');
  await delay(200);
  assert.equal(await evaluate(pet, `document.querySelectorAll('img.pet-image').length`), 0);
  await evaluate(pet, `window.eyeProtect.saveSettings({ petMotion: true })`);
  await session.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await waitFor(pet, `Boolean(document.querySelector('canvas.pet-image'))`);
  await session.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  session.close();

  await evaluate(pet, `window.eyeProtect.saveSettings({petCompanion: 'otter'})`);
  const reminder = await evaluate(pet, `window.eyeProtect.testReminder('eye')`);
  const alert = await waitForTarget(endpoint, '#alert');
  await waitFor(alert, `document.querySelector('.rest-duration strong')?.textContent !== '00:00' && document.querySelector('.illustrated-pet')?.dataset.companion === 'otter'`);
  await waitFor(alert, `Boolean(document.querySelector('.rest-prop-animated'))`);
  await evaluate(alert, `Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'))`);
  await waitFor(alert, `!document.querySelector('.rest-prop-animated')`);
  await evaluate(alert, `delete document.hidden; document.dispatchEvent(new Event('visibilitychange'))`);
  assert.ok((await evaluate(pet, 'window.eyeProtect.getReminderStatus()')).activeReminder.restStartedAt);
  assert.equal(await evaluate(alert, `document.querySelectorAll('[role="tab"]').length`), 0);
  await capture(alert, 'rest-default');
  const restSession = await openSession(alert);
  const metrics = [];
  for (const viewport of [{width:1440,height:960}, {width:480,height:440}]) {
    for (const readingScale of [1, 1.5]) {
      await evaluate(pet, `window.eyeProtect.saveSettings({restReadingScale: ${readingScale}})`);
      await waitFor(alert, `getComputedStyle(document.querySelector('.simple-rest')).getPropertyValue('--rest-reading-scale').trim() === '${readingScale}'`);
      await waitFor(workbench, `Number(getComputedStyle(document.querySelector('.simple-workbench')).zoom) === ${readingScale}`);
      // The size preference also resizes the native window. Emulate after that
      // resize settles, then assert the viewport really being audited.
      await delay(150);
      await restSession.call('Emulation.setDeviceMetricsOverride', {...viewport, deviceScaleFactor: scale, mobile: false});
      await waitFor(alert, `innerWidth === ${viewport.width} && innerHeight === ${viewport.height}`);
      assert.equal(await evaluate(pet, `innerWidth`), 200, 'reading size must not change the desktop-pet window');
      assert.ok(await evaluate(workbench, `(() => { const box = document.querySelector('.simple-workbench').getBoundingClientRect(); return box.width <= innerWidth+1 && box.height <= innerHeight+1; })()`), 'enlarged workbench must retain its scroll viewport');
      const layout = await evaluate(alert, `(() => {
        const card = document.querySelector('.rest-card'); const title = document.querySelector('.rest-title'); const footer = document.querySelector('.rest-away-footer'); const note = document.querySelector('.rest-offscreen-note');
        return {width: innerWidth, height: innerHeight, titleSize: parseFloat(getComputedStyle(title).fontSize), scroll: card.scrollHeight > card.clientHeight+2, collision: note.getBoundingClientRect().bottom > footer.getBoundingClientRect().top+1};
      })()`);
      metrics.push({...layout, readingScale});
      assert.equal(layout.scroll, false, `rest card must fit: ${JSON.stringify(layout)}`);
      assert.equal(layout.collision, false, `rest copy must not cover actions: ${JSON.stringify(layout)}`);
      await capture(alert, `rest-${viewport.width}-${readingScale}`, viewport);
    }
  }
  restSession.close();
  await evaluate(pet, `window.eyeProtect.reminderAction('skip', '${reminder.activeReminder.id}')`);
  writeFileSync(resolve(output, 'metrics.json'), JSON.stringify(metrics, null, 2));
  console.log(`Original GIF, distinct companions, motion controls and readable rest passed at ${scale * 100}%.`);
} catch (error) {
  try {
    const page = await waitForTarget(`http://127.0.0.1:${port}`, '#pet', 1000);
    await capture(page, 'failure');
    console.log(await evaluate(page, `({ html: document.querySelector('.pet-character')?.innerHTML, hidden: document.hidden, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches })`));
  } catch {}
  throw error;
} finally {
  writeFileSync(resolve(output, 'app.log'), log);
  if (child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
}
