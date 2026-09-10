import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { getAvailablePort, call, delay, evaluate, waitFor, waitForTarget, waitForTargetGone } from './lib/cdp.mjs';

const scale = Number(process.argv[2] ?? 1);
const output = resolve(process.argv[3] ?? `artifacts/simple-${scale}`);
const emergency = process.argv.includes('--emergency');
const phase = process.argv.includes('--ui-only') ? 'ui' : 'all';
const runtime = resolve(output, `run-${Date.now()}`);
const port = await getAvailablePort();
const endpoint = `http://127.0.0.1:${port}`;
mkdirSync(output, { recursive: true });
// CI runners have no interactive desktop, so Chromium treats the frameless pet
// window as occluded/backgrounded: it stops compositing and stops applying
// window moves mid-drag (the pet moved once, then `screenX` froze for all 50
// steps). These switches keep the packaged app fully active under test.
const CI_SWITCHES = [
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling'
];
const launch = () => spawn(resolve('release/win-unpacked/EyeProtect.exe'), [
  `--remote-debugging-port=${port}`, `--force-device-scale-factor=${scale}`, `--user-data-dir=${resolve(runtime, 'profile')}`, ...CI_SWITCHES, ...(emergency ? ['--eyeprotect-smoke-emergency'] : [])
], { windowsHide: true, env: { ...process.env, EYEPROTECT_SMOKE: '1', EYEPROTECT_DATA_DIR: resolve(runtime, 'data') } });
let child = launch();
let log = '';
child.stderr.on('data', (data) => { log += data; });
const capture = async (target, name) => {
  const frame = await call(target, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(resolve(output, `${name}.png`), Buffer.from(frame.data, 'base64'));
};
const fill = async (target, selector, value) => evaluate(target, `(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  if (!input) throw new Error('Missing field: ' + ${JSON.stringify(selector)});
  const prototype = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
const click = async (target, text, deferred = false) => evaluate(target, `(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!button) throw new Error('Missing button ' + ${JSON.stringify(text)}); if (${deferred}) setTimeout(() => button.click(), 50); else button.click(); })()`);
const metrics = { scale, phase };
try {
  const pet = await waitForTarget(endpoint, '#pet');
  await waitFor(pet, `Boolean(document.querySelector('.pet-drag-surface'))`);
  await evaluate(pet, `window.eyeProtect.saveSettings({ theme: 'light', eyeIntervalMinutes: 240, walkIntervalMinutes: 240, eyeRestSeconds: 12, todoBubbleTaskIds: [] })`);
  await evaluate(pet, `window.eyeProtect.openWorkbench('today')`);
  const workbench = await waitForTarget(endpoint, '#workbench');
  await waitFor(workbench, `document.querySelector('.simple-add') !== null`);
  assert.equal(await evaluate(workbench, `document.querySelectorAll('.app-sidebar, .ui-side-sheet').length`), 0);
  await fill(workbench, '[aria-label="添加任务"]', '整理今天的工作');
  await evaluate(workbench, `document.querySelector('[aria-label="添加任务"]').focus()`);
  await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await waitFor(workbench, `document.querySelectorAll('.simple-task').length === 1`);
  const root = (await evaluate(pet, 'window.eyeProtect.getTasks()'))[0];
  assert.equal(root.dueDate, null); assert.equal(root.reminderAt, null);
  await evaluate(workbench, `document.querySelector('.simple-task-name').click()`);
  await waitFor(workbench, `document.querySelector('.simple-task-fields') !== null`);
  const date = await evaluate(pet, `(() => { const d = new Date(); return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); })()`);
  await fill(workbench, '.simple-task-fields input[type="date"]', date);
  await fill(workbench, '.simple-task-fields textarea', '只记录需要做的事，减少来回切换。');
  await click(workbench, '保存修改');
  await waitFor(pet, `(async () => (await window.eyeProtect.getTasks())[0].dueDate === ${JSON.stringify(date)})()`);
  await fill(workbench, '[aria-label="添加步骤"]', '整理反馈');
  await click(workbench, '添加步骤');
  await waitFor(workbench, `document.querySelectorAll('.simple-step').length === 1`);
  assert.equal(await evaluate(workbench, 'document.querySelectorAll(".simple-task").length'), 1, 'steps must not duplicate into main list');
  await capture(workbench, 'task-expanded');
  await evaluate(workbench, `document.querySelector('[aria-label="放到浮窗"]').click()`);
  let bubble = await waitForTarget(endpoint, '#bubble');
  await waitFor(bubble, `document.querySelectorAll('.bubble-task-row').length === 1`);
  await capture(bubble, 'manual-task-bubble');
  await evaluate(workbench, `document.querySelector('.simple-step input[type="checkbox"]').click()`);
  await waitFor(workbench, `document.querySelector('.simple-step input').checked === true`);
  await evaluate(workbench, `document.querySelector('.simple-task-row > input').click()`);
  await waitFor(workbench, `document.querySelectorAll('.simple-task').length === 0`);
  await click(workbench, '完成记录');
  await waitFor(workbench, `document.querySelectorAll('.simple-history-row').length === 1`);
  await capture(workbench, 'completion-history');
  await click(workbench, '撤销');
  await click(workbench, '待办');
  await waitFor(workbench, `document.querySelectorAll('.simple-task').length === 1`);
  const restored = await evaluate(pet, 'window.eyeProtect.getTasks()');
  assert.equal(restored.find(t => t.parentId)?.status, 'done', 'undo must preserve the previously completed step');
  await click(workbench, '＋清单');
  await fill(workbench, '[aria-label="清单名称"]', '工作');
  await click(workbench, '保存清单');
  await waitFor(workbench, `document.querySelector('[aria-label="清单筛选"]').selectedOptions[0].textContent === '工作'`);
  await fill(workbench, '[aria-label="添加任务"]', '完成设计初稿'); await click(workbench, '添加');
  await waitFor(workbench, `document.querySelectorAll('.simple-task').length === 1`);
  await fill(workbench, '[aria-label="清单筛选"]', 'all');
  await waitFor(workbench, `document.querySelectorAll('.simple-task').length === 2`);
  await evaluate(workbench, `document.querySelector('[aria-expanded="true"]')?.click()`);
  await capture(workbench, 'task-home');
  await evaluate(workbench, `document.querySelector('[aria-label="设置"]').click()`);
  await waitFor(workbench, `document.querySelector('.simple-settings') !== null`);
  assert.deepEqual(await evaluate(workbench, `[...document.querySelectorAll('.simple-settings > section > h2')].map(el => el.textContent)`), ['休息提醒', '桌面外观', '应用']);
  await capture(workbench, 'settings');
  console.log('Task UI, completion, undo and settings passed.');
  if (phase === 'all') {
    await evaluate(pet, `window.eyeProtect.closeWorkbench()`);
    // Center the pet in the work area: CI runners are small, so at 1.25x/1.5x
    // device scale the work area is only a few hundred DIP wide and a hardcoded
    // position parks the pet so close to an edge that the bubble is clamped and
    // the sweep has no room.
    const workArea = await evaluate(pet, `({ left: screen.availLeft, top: screen.availTop, width: screen.availWidth, height: screen.availHeight })`);
    const petSize = await evaluate(pet, `({ width: innerWidth, height: innerHeight })`);
    const petHome = {
      x: Math.round(workArea.left + (workArea.width - petSize.width) / 2),
      y: Math.round(workArea.top + (workArea.height - petSize.height) / 2)
    };
    await evaluate(pet, `window.eyeProtect.movePetWindow({ x: ${petHome.x}, y: ${petHome.y} })`);
    // Fail here, not 50 steps later, if the pet cannot be placed for the sweep.
    // The expression carries the geometry so a CI failure is self-explaining.
    await waitFor(pet, `(Math.abs(screenX - ${petHome.x}) <= 2 && Math.abs(screenY - ${petHome.y}) <= 2) /* want ${petHome.x},${petHome.y} in ${JSON.stringify(workArea)} */`, 6_000);
    await evaluate(pet, `window.eyeProtect.preparePomodoro(${JSON.stringify(root.id)}, false)`);
    bubble = await waitForTarget(endpoint, '#bubble');
    await waitFor(bubble, `document.querySelector('[aria-label="专注分钟数"]') !== null`);
    await fill(bubble, '[aria-label="专注分钟数"]', '1');
    await click(bubble, '开始计时');
    assert.equal((await evaluate(pet, 'window.eyeProtect.getPomodoro()')).phase, 'focus');
    await waitFor(bubble, `document.querySelector('.pomodoro-clock') !== null`);
    await capture(bubble, 'pomodoro-running');
    await delay(1100);
    assert.ok((await evaluate(pet, 'window.eyeProtect.getPomodoro()')).remainingMs < 59500);
    const reminder = await evaluate(pet, `window.eyeProtect.testReminder('eye')`);
    const alert = emergency ? await waitForTarget(endpoint, (page) => page.url.startsWith('data:text/html'), 'emergency') : await waitForTarget(endpoint, '#alert');
    await waitFor(alert, emergency ? `document.querySelector('#start') !== null` : `document.querySelector('.simple-rest') !== null`);
    if (!emergency) {
      // The rest card is an "art stage + reading panel": stage with the pixel
      // companion and the reminder kind, panel with the copy, the micro-break
      // activity picked by the main process, the countdown and the actions.
      await waitFor(alert, `document.querySelector('.rest-card .rest-stage-art .pixel-animal') !== null`);
      // Settings arrive over IPC after the first paint; wait for the panel to
      // reflect the saved rest length before asserting on the copy.
      await waitFor(alert, `document.querySelector('.rest-ring-text strong')?.textContent === '00:12'`);
      const chrome = await evaluate(alert, `(() => ({
        badge: document.querySelector('.rest-kind-badge')?.textContent ?? '',
        title: document.querySelector('#rest-title')?.textContent ?? '',
        caption: document.querySelector('.rest-stage-caption')?.textContent ?? '',
        primary: document.querySelector('.rest-actions button.primary')?.textContent ?? '',
        timer: document.querySelector('.rest-ring-text strong')?.textContent ?? '',
        activities: [...document.querySelectorAll('.rest-activities .activity-guide')].map((entry) => entry.textContent ?? '')
      }))()`);
      assert.equal(chrome.badge, '护眼提醒', 'the stage must label the reminder kind');
      assert.equal(chrome.title, '让眼睛休息一下', 'the panel must carry the reminder title');
      assert.equal(chrome.primary, '开始休息', 'the primary action must start the rest');
      assert.equal(chrome.caption, '远望 · 眨眼 · 放松', 'the stage caption must match the kind');
      assert.equal(chrome.timer, '00:12', 'the ready state previews the configured rest length');
      assert.equal(chrome.activities.length, 1, 'an eye reminder must show its picked micro-break activity');
      assert.ok(chrome.activities[0].includes('步'), `activity guide must show its pacing, got ${chrome.activities[0]}`);
      await capture(alert, 'rest-ready');
      await evaluate(pet, `window.eyeProtect.saveSettings({ theme: 'dark' })`);
      await waitFor(alert, `document.documentElement.dataset.theme === 'dark'`);
      assert.equal(await evaluate(alert, `getComputedStyle(document.documentElement).colorScheme`), 'dark', 'the alert must follow the dark theme');
      await capture(alert, 'rest-dark');
      await evaluate(pet, `window.eyeProtect.saveSettings({ theme: 'light' })`);
      await waitFor(alert, `document.documentElement.dataset.theme === 'light'`);
    } else {
      await capture(alert, 'rest-ready');
    }
    assert.equal((await evaluate(pet, 'window.eyeProtect.getPomodoro()')).running, true, 'pending prompt alone must not pause focus');
    await click(alert, '开始休息');
    await waitFor(pet, `(async () => !(await window.eyeProtect.getPomodoro()).running)()`);
    const paused = await evaluate(pet, 'window.eyeProtect.getPomodoro()');
    if (!emergency) {
      await waitFor(alert, `[...document.querySelectorAll('button')].some(b => b.textContent === '完成休息')`);
      const resting = await evaluate(alert, `(() => ({
        ringLabel: document.querySelector('.rest-ring-text span')?.textContent ?? '',
        lede: document.querySelector('.rest-lede')?.textContent ?? '',
        completeDisabled: [...document.querySelectorAll('button')].find(b => b.textContent === '完成休息')?.disabled ?? null
      }))()`);
      assert.equal(resting.ringLabel, '剩余', 'the running countdown must label its ring');
      assert.match(resting.lede, /^还有 \d+ 秒/, 'the running countdown must be visible as text');
      assert.equal(resting.completeDisabled, true, 'focused mode must enforce the rest wait');
    }
    // The rest window is 12s below; waitFor's default budget is shorter.
    await waitFor(alert, `[...document.querySelectorAll('button')].some(b => b.textContent === '${emergency ? '完成' : '完成休息'}' && !b.disabled)`, 30_000);
    if (!emergency) {
      const finished = await evaluate(alert, `(() => ({
        ringLabel: document.querySelector('.rest-ring-text span')?.textContent ?? '',
        lede: document.querySelector('.rest-lede')?.textContent ?? ''
      }))()`);
      assert.equal(finished.ringLabel, '已到时间', 'the ring must settle once the rest window closed');
      assert.equal(finished.lede, '这次休息时间已到', 'the panel must announce the finished rest');
    }
    await capture(alert, 'rest-finished');
    await click(alert, emergency ? '完成' : '完成休息', true);
    await waitFor(pet, `(async () => !(await window.eyeProtect.getReminderStatus()).activeReminder)()`);
    assert.equal((await evaluate(pet, 'window.eyeProtect.getPomodoro()')).remainingMs, paused.remainingMs);
    bubble = await waitForTarget(endpoint, '#bubble');
    await waitFor(bubble, `document.body?.textContent.includes('继续')`);
    await capture(bubble, 'pomodoro-paused');
    await click(bubble, '继续');
    metrics.drag = [];
    let unclamped = 0;
    const start = await evaluate(pet, '({ x: screenX, y: screenY, width: innerWidth, height: innerHeight })');
    const petRect = () => evaluate(pet, '({ x: screenX, y: screenY, width: innerWidth, height: innerHeight })');
    const bubbleRect = () => evaluate(bubble, '({ x: screenX, y: screenY, width: innerWidth, height: innerHeight })');
    // The pet and the bubble live in different renderers, so their positions can
    // only be read one after the other. Sampling until two consecutive reads
    // agree stops a comparison from pairing the pet's old position with the
    // bubble's new one — on a loaded CI runner that read gap is easily longer
    // than the 25 ms between drag steps.
    const settledGeometry = async () => {
      let previous = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const p = await petRect();
        const b = await bubbleRect();
        if (previous && previous.p.x === p.x && previous.p.y === p.y && previous.b.x === b.x && previous.b.y === b.y) {
          return { p, b, settled: true };
        }
        previous = { p, b };
        await delay(25);
      }
      return { ...previous, settled: false };
    };
    // The injected pointer is expressed in client coordinates of a 160 px
    // window. If the window has not caught up with the previous move yet, that
    // coordinate lands outside the window and Chromium clamps it, which
    // silently shrinks the sweep (CI produced <= 15 distinct positions that
    // way). Wait for the window to stop before converting the next target.
    const settledPetX = async () => {
      let previous = await evaluate(pet, 'screenX');
      for (let attempt = 0; attempt < 15; attempt += 1) {
        await delay(20);
        const next = await evaluate(pet, 'screenX');
        if (next === previous) return next;
        previous = next;
      }
      return previous;
    };
    await call(pet, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: 80, y: 80, button: 'left', buttons: 1, clickCount: 1 });
    // The drag only starts once the pointer moves past its 4 px threshold, and
    // the surface only reports it when pointer capture actually engaged. Check
    // that explicitly: without it a runner where the drag never starts fails
    // later as "the pet did not sweep", which hides the real cause.
    await call(pet, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: 92, y: 80, button: 'left', buttons: 1 });
    await waitFor(pet, `document.querySelector('.pet-drag-surface').classList.contains('is-dragging') /* pet ${JSON.stringify(petHome)} workArea ${JSON.stringify(workArea)} */`, 6_000);
    for (let step = 1; step <= 50; step += 1) {
      const dx = Math.round(Math.sin(step / 50 * Math.PI * 2) * 180);
      const currentX = await settledPetX();
      const clientX = start.x + 80 + dx - currentX;
      await call(pet, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: clientX, y: 80, button: 'left', buttons: 1 });
      await delay(25);
      const { p, b, settled } = await settledGeometry();
      assert.equal(p.width, start.width); assert.equal(p.height, start.height);
      // The bubble centers under the pet but never leaves the work area, so on
      // small displays the expected center is the clamped one — asserting the
      // unclamped pet center would fail against correct behavior.
      const petCenter = p.x + p.width / 2;
      const bubbleCenter = b.x + b.width / 2;
      const minCenter = workArea.left + b.width / 2;
      const maxCenter = workArea.left + workArea.width - b.width / 2;
      const expectedCenter = Math.min(Math.max(petCenter, minCenter), maxCenter);
      assert.ok(
        Math.abs(bubbleCenter - expectedCenter) <= 2,
        `bubble must follow the pet at step ${step} (settled=${settled}): pet=${JSON.stringify(p)} bubble=${JSON.stringify(b)} expectedCenter=${expectedCenter} workArea=${JSON.stringify(workArea)}`
      );
      if (Math.abs(petCenter - expectedCenter) < 0.5) unclamped += 1;
      metrics.drag.push({ p, b, settled, expectedCenter, clientX });
    }
    await call(pet, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: 80, y: 80, button: 'left', buttons: 0, clickCount: 1 });
    const distinctPetX = new Set(metrics.drag.map(entry => entry.p.x)).size;
    assert.ok(
      distinctPetX > 15,
      `the drag must sweep the pet, got ${distinctPetX} distinct x ${JSON.stringify([...new Set(metrics.drag.map(entry => entry.p.x))])} from home ${JSON.stringify(petHome)} in work area ${JSON.stringify(workArea)}; client x ${JSON.stringify(metrics.drag.map(entry => entry.clientX))}`
    );
    // Following must be exercised, not just clamping: most steps have to be
    // unclamped, otherwise a frozen bubble could pass the loop above.
    assert.ok(unclamped > 15, `bubble following must be exercised on unclamped steps, got ${unclamped}/50`);
    console.log('Health pause/resume and continuous drag passed.');
    if (process.argv.includes('--wait-finish')) {
      console.log('Waiting for the real one-minute timer to finish.');
      await waitFor(pet, `(async () => (await window.eyeProtect.getPomodoro()).phase === 'focus-finished')()`, 90000);
      await waitFor(bubble, `document.body?.textContent.includes('本轮专注结束')`);
      await capture(bubble, 'pomodoro-finished');
      writeFileSync(resolve(output, 'real-timer-end.json'), JSON.stringify(await evaluate(pet, 'window.eyeProtect.getPomodoro()'), null, 2));
      await click(bubble, '开始休息 5 分钟');
      assert.equal((await evaluate(pet, 'window.eyeProtect.getPomodoro()')).phase, 'break');
      await capture(bubble, 'pomodoro-short-rest');
    }
    await evaluate(pet, `window.eyeProtect.pomodoroAction('pause')`);
    metrics.paused = await evaluate(pet, 'window.eyeProtect.getPomodoro()');
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    // The relaunched app takes the single-instance lock, so the old process has
    // to release it first; a lost race makes the new instance exit immediately
    // and the pet target never appears. Wait for the exit, then retry once.
    const waitForExit = async () => {
      const deadline = Date.now() + 15_000;
      while (child.exitCode === null && Date.now() < deadline) await delay(200);
    };
    const restart = async () => {
      await waitForExit();
      child = launch();
      child.stderr.on('data', (data) => { log += data; });
      return waitForTarget(endpoint, '#pet', 45_000);
    };
    let restarted;
    try {
      restarted = await restart();
    } catch (error) {
      console.log(`Relaunch did not expose the pet window (${error.message}); retrying once.`);
      if (child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      restarted = await restart();
    }
    await waitFor(restarted, `Boolean(window.eyeProtect)`, 20_000);
    metrics.restarted = await evaluate(restarted, 'window.eyeProtect.getPomodoro()');
    assert.equal(metrics.restarted.running, false); assert.equal(metrics.restarted.remainingMs, metrics.paused.remainingMs);
    await evaluate(restarted, `window.eyeProtect.pomodoroAction('stop')`);
    await waitFor(restarted, `document.querySelector('[title="开始番茄钟"]') !== null`);
    await evaluate(restarted, `document.querySelector('[title="开始番茄钟"]').click()`);
    bubble = await waitForTarget(endpoint, '#bubble');
    await waitFor(bubble, `document.querySelector('[aria-label="专注分钟数"]') !== null`);
    assert.equal((await evaluate(restarted, 'window.eyeProtect.getPomodoro()')).taskId, null);
    await waitFor(bubble, `document.querySelector('[aria-label="专注分钟数"]')?.value === '1'`);
    await capture(bubble, 'pomodoro-ready');
    await click(bubble, '返回待办');
  }
  writeFileSync(resolve(output, 'metrics.json'), JSON.stringify(metrics, null, 2));
  console.log(`Simple experience ${phase} passed at ${scale * 100}%`);
} catch (error) {
  try { const page = await waitForTarget(endpoint, '#workbench', 1000); await capture(page, 'failure'); console.log(await evaluate(page, 'document.body.innerText')); } catch {}
  throw error;
} finally {
  writeFileSync(resolve(output, 'app.log'), log);
  if (child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
}
