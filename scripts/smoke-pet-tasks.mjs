import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { call, delay, evaluate, waitFor, waitForTarget, waitForTargetGone } from './lib/cdp.mjs';

// Each run owns its application process and isolated data/userData directories.
const scale = Number(process.argv[2] ?? 1);
const output = resolve(process.argv[3] ?? `artifacts/pet-tasks-${scale}`);
const port = 9430 + Math.round(scale * 100);
const endpoint = `http://127.0.0.1:${port}`;
mkdirSync(output, { recursive: true });
const runDirectory = resolve(output, `run-${Date.now()}`);
const launch = () => spawn(resolve('release/win-unpacked/EyeProtect.exe'), [
  `--remote-debugging-port=${port}`, `--force-device-scale-factor=${scale}`,
  `--user-data-dir=${resolve(runDirectory, 'profile')}`
], { windowsHide: true, env: { ...process.env, EYEPROTECT_SMOKE: '1', EYEPROTECT_DATA_DIR: resolve(runDirectory, 'data') } });
let child = launch();
let log = '';
child.stderr.on('data', (data) => { log += data; });
const capture = async (target, name) => {
  const result = await call(target, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(resolve(output, `${name}.png`), Buffer.from(result.data, 'base64'));
};
const metrics = {};
try {
  const pet = await waitForTarget(endpoint, '#pet');
  await waitFor(pet, `Boolean(document.querySelector('.pet-drag-surface'))`);
  await evaluate(pet, `window.eyeProtect.saveSettings({ theme: 'light', petScale: 1, petAppearance: 'cat', todoBubbleTaskIds: [], todoBubbleEnabled: true, eyeIntervalMinutes: 240, walkIntervalMinutes: 240 })`);
  const ids = await evaluate(pet, `(async () => {
    const titles = ['整理今天的工作计划', '完成项目设计初稿', '检查反馈并更新任务', '读一小节喜欢的书'];
    for (const title of titles) await window.eyeProtect.createTask({ title });
    return (await window.eyeProtect.getTasks()).filter(t => titles.includes(t.title)).slice(-4).map(t => t.id);
  })()`);
  assert.equal(ids.length, 4);
  await evaluate(pet, `window.eyeProtect.movePetWindow({ x: 550, y: 470 })`);
  for (const count of [1, 3, 4]) {
    await evaluate(pet, `window.eyeProtect.saveSettings({ todoBubbleTaskIds: ${JSON.stringify(ids.slice(0, count))} })`);
    const bubble = await waitForTarget(endpoint, '#bubble');
    await waitFor(bubble, `document.querySelectorAll('.bubble-task-row').length === ${count}`);
    await delay(300);
    metrics[`rows${count}`] = await evaluate(bubble, `({ x: screenX, y: screenY, width: innerWidth, height: innerHeight, listHeight: document.querySelector('.bubble-list').clientHeight, scrollHeight: document.querySelector('.bubble-list').scrollHeight })`);
    await capture(bubble, `bubble-${count}`);
  }
  assert.ok(metrics.rows1.height < metrics.rows3.height);
  assert.equal(metrics.rows3.height, metrics.rows4.height);
  assert.ok(metrics.rows4.scrollHeight > metrics.rows4.listHeight);
  for (const animal of ['cat', 'dog', 'rabbit']) {
    await evaluate(pet, `window.eyeProtect.saveSettings({ petAppearance: '${animal}' })`);
    await waitFor(pet, `document.querySelector('[data-animal="${animal}"]') !== null`);
    await call(pet, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: -40, y: -40 });
    await delay(100);
    await capture(pet, animal);
  }
  await evaluate(pet, `window.eyeProtect.saveSettings({ petAppearance: 'cat' })`);
  await call(pet, 'Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await call(pet, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: 80, y: 80, button: 'left', buttons: 1, clickCount: 1 });
  await call(pet, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: 80, y: 80, button: 'left', buttons: 0, clickCount: 1 });
  await delay(250);
  assert.equal(await evaluate(pet, `document.querySelector('[data-animal]').dataset.frame`), '0');
  assert.equal(await evaluate(pet, `getComputedStyle(document.querySelector('.pixel-animal')).animationName`), 'none');
  await call(pet, 'Emulation.setEmulatedMedia', { features: [] });
  await delay(1200);
  const bubble = await waitForTarget(endpoint, '#bubble');
  // The height capability must ignore calls from other application windows.
  const heightBefore = await evaluate(bubble, 'innerHeight');
  await evaluate(pet, 'window.eyeProtect.reportBubbleHeight(580)');
  assert.equal(await evaluate(bubble, 'innerHeight'), heightBefore);
  await evaluate(bubble, `(async () => { for (const value of [null, -1, 10000, '200']) await window.eyeProtect.reportBubbleHeight(value); })()`);
  assert.equal(await evaluate(bubble, 'innerHeight'), heightBefore);
  metrics.drag = [];
  const record = process.argv.includes('--record');
  const start = await evaluate(pet, `({ x: screenX, y: screenY, width: innerWidth, height: innerHeight })`);
  await call(pet, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: 80, y: 80, button: 'left', buttons: 1, clickCount: 1 });
  for (let step = 1; step <= 90; step += 1) {
    const current = await evaluate(pet, `({ x: screenX, y: screenY })`);
    const dx = Math.round(220 * Math.sin(step / 90 * Math.PI * 2));
    const dy = Math.round(60 * Math.sin(step / 90 * Math.PI * 4));
    await call(pet, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + 80 + dx - current.x, y: start.y + 80 + dy - current.y, button: 'left', buttons: 1 });
    await delay(20);
    const p = await evaluate(pet, `({ x: screenX, y: screenY, width: innerWidth, height: innerHeight, dragging: document.querySelector('.is-dragging') !== null })`);
    const b = await evaluate(bubble, `({ x: screenX, y: screenY, width: innerWidth, height: innerHeight })`);
    assert.equal(p.width, start.width);
    assert.equal(p.height, start.height);
    assert.ok(Math.abs(b.x + b.width / 2 - p.x - p.width / 2) <= 2, JSON.stringify({ p, b }));
    assert.ok(Math.abs(b.y + b.height - p.y - p.height / 8) <= 2, JSON.stringify({ p, b }));
    metrics.drag.push({ pet: p, bubble: b });
    if (record) {
      const petFrame = await call(pet, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const bubbleFrame = await call(bubble, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const frame = await evaluate(pet, `(async () => {
        const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 600;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#eef1f4'; ctx.fillRect(0, 0, 1000, 600);
        ctx.fillStyle = '#526b78'; ctx.font = '18px sans-serif'; ctx.fillText('EyeProtect · 实际窗口逐帧采集 / 按屏幕坐标合成', 40, 45);
        for (const [data, x, y, width, height] of ${JSON.stringify([
          [petFrame.data, p.x - start.x + 420, p.y - start.y + 350, p.width, p.height],
          [bubbleFrame.data, b.x - start.x + 420, b.y - start.y + 350, b.width, b.height]
        ])}) {
          const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode(); ctx.drawImage(img, x, y, width, height);
        }
        return canvas.toDataURL('image/png').split(',')[1];
      })()`);
      writeFileSync(resolve(output, `drag-${String(step).padStart(3, '0')}.png`), Buffer.from(frame, 'base64'));
    }
  }
  await call(pet, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: 80, y: 80, button: 'left', buttons: 0, clickCount: 1 });
  if (record) {
    const encoded = spawnSync('ffmpeg', ['-y', '-framerate', '15', '-start_number', '1', '-i', resolve(output, 'drag-%03d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', resolve(output, 'drag-follow.mp4')], { windowsHide: true, encoding: 'utf8' });
    assert.equal(encoded.status, 0, encoded.stderr);
  }
  assert.ok(new Set(metrics.drag.map(entry => entry.pet.x)).size > 20, 'real pointer drag must move the pet');
  await evaluate(pet, `window.eyeProtect.movePetWindow({ x: 0, y: 0 })`);
  await waitFor(bubble, `document.documentElement.dataset.bubblePlacement === 'below'`);
  await capture(bubble, 'bubble-below');
  await evaluate(pet, `window.eyeProtect.movePetWindow({ x: 550, y: 470 })`);
  await evaluate(pet, `window.eyeProtect.openWorkbench('pet-tasks')`);
  const workbench = await waitForTarget(endpoint, '#workbench');
  await waitFor(workbench, `document.querySelector('.pet-tasks-page') !== null`);
  await capture(workbench, 'task-picker');
  const originalIds = await evaluate(workbench, `(async () => (await window.eyeProtect.getSettings()).todoBubbleTaskIds)()`);
  await evaluate(workbench, `document.querySelector('button[aria-label^="下移 "]').click()`);
  await waitFor(workbench, `(async () => (await window.eyeProtect.getSettings()).todoBubbleTaskIds[0] === ${JSON.stringify(originalIds[1])})()`);
  await evaluate(workbench, `document.querySelector('.pet-task-choices input[type="checkbox"]').click()`);
  await waitFor(workbench, `(async () => (await window.eyeProtect.getSettings()).todoBubbleTaskIds.length === 3)()`);
  await waitFor(bubble, `document.querySelectorAll('.bubble-task-row').length === 3`);
  await evaluate(pet, `window.eyeProtect.openWorkbench('collection')`);
  await waitFor(workbench, `document.querySelector('.builtin-animal-grid') !== null`);
  await capture(workbench, 'animal-collection');
  await evaluate(pet, `window.eyeProtect.closeWorkbench()`);
  await evaluate(pet, `window.eyeProtect.saveSettings({ todoBubbleTaskIds: ${JSON.stringify([ids[0]])} })`);
  await waitFor(bubble, `document.querySelectorAll('.bubble-complete').length === 1`);
  await evaluate(bubble, `document.querySelector('.bubble-complete').click()`);
  await waitFor(bubble, `document.querySelector('.bubble-title')?.textContent.includes('已完成')`);
  await waitForTargetGone(endpoint, '#bubble');
  await evaluate(pet, `window.eyeProtect.setTaskStatus(${JSON.stringify(ids[0])}, 'open')`);
  const restored = await waitForTarget(endpoint, '#bubble');
  await waitFor(restored, `document.querySelectorAll('.bubble-task-row').length === 1`);
  await evaluate(pet, `window.eyeProtect.saveSettings({ reminderMode: 'gentle' })`);
  const reminder = await evaluate(pet, `window.eyeProtect.testReminder('eye')`);
  await waitFor(restored, `document.querySelector('.bubble-reminder') !== null`);
  await evaluate(pet, `window.eyeProtect.reminderAction('skip', ${JSON.stringify(reminder.activeReminder.id)})`);
  const afterReminder = await waitForTarget(endpoint, '#bubble');
  await waitFor(afterReminder, `document.querySelectorAll('.bubble-task-row').length === 1`);
  await evaluate(pet, `window.eyeProtect.saveSettings({ todoBubbleTaskIds: [] })`);
  await waitForTargetGone(endpoint, '#bubble');
  await evaluate(pet, `window.eyeProtect.saveSettings({ todoBubbleTaskIds: ${JSON.stringify(ids.slice(0, 3))}, todoBubbleEnabled: false, petAppearance: 'rabbit' })`);
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  await delay(400);
  child = launch();
  child.stderr.on('data', (data) => { log += data; });
  const restarted = await waitForTarget(endpoint, '#pet');
  await waitFor(restarted, `document.querySelector('[data-animal="rabbit"]') !== null`);
  const restoredSettings = await evaluate(restarted, 'window.eyeProtect.getSettings()');
  assert.deepEqual(restoredSettings.todoBubbleTaskIds, ids.slice(0, 3));
  assert.equal(restoredSettings.todoBubbleEnabled, false);
  await waitForTargetGone(endpoint, '#bubble');
  writeFileSync(resolve(output, 'metrics.json'), JSON.stringify(metrics, null, 2));
  console.log(`Pet tasks smoke passed at ${scale * 100}%: content sizing, pointer drag, selection, completion/undo, reminders and artwork.`);
} finally {
  writeFileSync(resolve(output, 'app.log'), log);
  if (child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
}
