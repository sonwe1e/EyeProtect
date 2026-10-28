import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { getAvailablePort, call, delay, evaluate, waitFor, waitForTarget, waitForTargetGone, openSession } from './lib/cdp.mjs';

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
const capture = async (target, name, viewport) => {
  const frame = await call(target, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, ...(viewport ? { clip: { x: 0, y: 0, ...viewport, scale: 1 } } : {}) });
  writeFileSync(resolve(output, `${name}.png`), Buffer.from(frame.data, 'base64'));
};
const fill = async (target, selector, value) => evaluate(target, `(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  if (!input) throw new Error('Missing field: ' + ${JSON.stringify(selector)});
  const prototype = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
const click = async (target, text, deferred = false) => {
  // Main-process data can arrive before the renderer clears command pending.
  // Match the enabled control a user can click, instead of losing the click.
  await waitFor(target, `(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); return Boolean(button && !button.disabled); })()`);
  return evaluate(target, `(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!button) throw new Error('Missing button ' + ${JSON.stringify(text)}); if (${deferred}) setTimeout(() => button.click(), 50); else button.click(); })()`);
};
const metrics = { scale, phase };
try {
  const pet = await waitForTarget(endpoint, '#pet');
  await waitFor(pet, `Boolean(document.querySelector('.pet-drag-surface'))`);
  await evaluate(pet, `window.__petReactions = []; window.eyeProtect.onPetReaction(event => window.__petReactions.push(event))`);
  await evaluate(pet, `window.eyeProtect.saveSettings({ theme: 'light', petCompanion: 'pixel', eyeIntervalMinutes: 240, walkIntervalMinutes: 240, eyeRestSeconds: 12, todoBubbleTaskIds: [] })`);
  await evaluate(pet, `window.eyeProtect.openWorkbench('today')`);
  const workbench = await waitForTarget(endpoint, '#workbench');
  await waitFor(workbench, `document.querySelector('.simple-add') !== null`);
  assert.equal(await evaluate(workbench, `document.querySelectorAll('.app-sidebar').length`), 0);
  // AC-01: today is one flat queue, so no date heading may exist on this page.
  assert.equal(await evaluate(workbench, `Boolean(document.querySelector('.simple-queue'))`), true, 'today must render the single queue sheet');
  assert.equal(await evaluate(workbench, `document.querySelectorAll('.simple-group').length`), 0, 'today must not group tasks by due date');
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
  // The save bumps revision, so the open editor resyncs and the inline due tag
  // re-renders. Wait for that commit before filling the new step's local draft.
  await waitFor(workbench, `document.querySelector('.simple-date-badge')?.title === ${JSON.stringify(`截止日期：${date}`)} && Boolean(document.querySelector('.simple-task-fields .simple-saved-hint'))`);
  await fill(workbench, '[aria-label="添加步骤"]', '整理反馈');
  await click(workbench, '添加步骤');
  // The step shows up twice on purpose: once as an inline chip in the row and
  // once as an editable line in the drawer. `.simple-step` only matches the
  // drawer line, `.simple-step-chip` only the row chip.
  await waitFor(workbench, `document.querySelectorAll('.simple-task-fields .simple-step').length === 1`);
  assert.equal(await evaluate(workbench, `document.querySelectorAll('.simple-queue-row .simple-step-chip').length`), 1, 'a new step must appear as an inline chip (AC-05)');
  assert.equal(await evaluate(workbench, 'document.querySelectorAll(".simple-task").length'), 1, 'steps must not duplicate into main list');
  await capture(workbench, 'task-expanded');
  await evaluate(workbench, `document.querySelector('[aria-label="放到浮窗"]').click()`);
  let bubble = await waitForTarget(endpoint, '#bubble');
  await waitFor(bubble, `document.querySelectorAll('.bubble-task-row').length === 1`);
  await capture(bubble, 'manual-task-bubble');
  await evaluate(workbench, `document.querySelector('.simple-task-fields .simple-step input[type="checkbox"]').click()`);
  await waitFor(workbench, `document.querySelector('.simple-task-fields .simple-step input').checked === true`);
  assert.equal(await evaluate(workbench, `document.querySelectorAll('.simple-queue-row .simple-step-chip.is-done').length`), 1, 'a completed step must stay visible in the row (AC-04)');
  await waitFor(pet, `window.__petReactions.filter(event => event.action === 'celebrate').length === 1`);
  await evaluate(workbench, `document.querySelector('.simple-task-row input[type="checkbox"]').click()`);
  // AC-06: a completed task sinks to the tail instead of leaving the queue, so
  // the row must still be there and marked done.
  await waitFor(workbench, `document.querySelectorAll('.simple-task.is-done').length === 1`);
  assert.equal(await evaluate(workbench, `document.querySelectorAll('.simple-task').length`), 1, 'the completed row stays in the queue');
  assert.match(await evaluate(workbench, `document.querySelector('.simple-queue-meta').textContent`), /^都做完了 · .+$/, 'an all-done queue says so in its header');
  assert.equal(await evaluate(pet, `window.__petReactions.filter(event => event.action === 'celebrate').length`), 1, 'a burst of completions does not replay pet celebrations');
  await click(workbench, '完成记录');
  await waitFor(workbench, `document.querySelectorAll('.simple-history-row').length === 1`);
  await waitFor(workbench, `document.querySelector('.simple-rest-week') !== null`);
  assert.equal(await evaluate(workbench, `document.querySelectorAll('.simple-rest-day').length`), 7);
  assert.match(await evaluate(workbench, `document.querySelector('.simple-rest-companion').textContent`), /自己的节奏/);
  await capture(workbench, 'completion-history');
  await click(workbench, '撤销');
  assert.equal(await evaluate(pet, `window.__petReactions.filter(event => event.action === 'celebrate').length`), 1, 'undo must not replay celebration');
  await click(workbench, '待办');
  await waitFor(workbench, `document.querySelectorAll('.simple-task').length === 1`);
  assert.equal(await evaluate(workbench, `document.querySelectorAll('.simple-task.is-done').length`), 0, 'undo must put the row back as an open queue item');
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
  assert.deepEqual(await evaluate(workbench, `[...document.querySelectorAll('.simple-settings > section > h2')].map(el => el.textContent)`), ['休息提醒', '喝水提醒', '桌面外观', '应用']);
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
    if (emergency) await evaluate(pet, `window.eyeProtect.saveSettings({ restReadingScale: 1.5 })`);
    const reminder = await evaluate(pet, `window.eyeProtect.testReminder('eye')`);
    const alert = emergency ? await waitForTarget(endpoint, (page) => page.url.startsWith('data:text/html'), 'emergency') : await waitForTarget(endpoint, '#alert');
    await waitFor(alert, emergency ? `document.querySelector('#start') !== null` : `document.querySelector('.simple-rest') !== null`);
    await waitFor(pet, `(async () => typeof (await window.eyeProtect.getReminderStatus()).activeReminder?.restStartedAt === 'number')()`);
    await waitFor(pet, `(async () => !(await window.eyeProtect.getPomodoro()).running)()`);
    const paused = await evaluate(pet, 'window.eyeProtect.getPomodoro()');
    if (!emergency) {
      await waitFor(alert, `Boolean(document.querySelector('.rest-stage-art .pixel-animal'))`);
      assert.equal(await evaluate(alert, `document.querySelectorAll('.rest-mode-bar').length`), 0, 'rest must not ask for a mode');
      assert.equal(await evaluate(alert, `[...document.querySelectorAll('button')].some(button => button.textContent.trim() === '开始休息')`), false);
      const title = await evaluate(alert, `document.querySelector('.rest-title').textContent`);
      const geometry = await evaluate(alert, `(() => {
        const title = document.querySelector('.rest-title'); const instruction = document.querySelector('.rest-instruction'); const card = document.querySelector('.rest-card');
        return { titleSize: parseFloat(getComputedStyle(title).fontSize), instructionSize: parseFloat(getComputedStyle(instruction).fontSize), scroll: card.scrollHeight > card.clientHeight + 2, width: innerWidth, height: innerHeight };
      })()`);
      assert.ok(geometry.titleSize >= 28 && geometry.instructionSize >= 18, `rest must be readable: ${JSON.stringify(geometry)}`);
      assert.equal(geometry.scroll, false, 'one-glance rest must fit without scrolling');
      await capture(alert, 'rest-ready');
      await evaluate(pet, `window.eyeProtect.saveSettings({ theme: 'dark' })`);
      await waitFor(alert, `document.documentElement.dataset.theme === 'dark'`);
      await capture(alert, 'rest-dark');
      await evaluate(pet, `window.eyeProtect.saveSettings({ theme: 'light' })`);
      metrics.restActionKeys = [];
      for (let step = 0; step < 3; step += 1) {
        await delay(2000);
        metrics.restActionKeys.push(await evaluate(alert, `document.querySelector('.pixel-animal')?.dataset.action`));
      }
      assert.equal(await evaluate(alert, `document.querySelector('.rest-title').textContent`), title, 'the instruction must remain stable while the user looks away');
    } else {
      await capture(alert, 'rest-ready');
      const restSession = await openSession(alert);
      const viewport = { width: 480, height: 440 };
      await restSession.call('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: scale, mobile: false });
      await waitFor(alert, `innerWidth === 480 && innerHeight === 440`);
      const geometry = await evaluate(alert, `(() => ({ scale: getComputedStyle(document.documentElement).getPropertyValue('--reading-scale').trim(), scroll: document.body.scrollHeight > innerHeight + 2, collision: document.querySelector('p').getBoundingClientRect().bottom > document.querySelector('.actions').getBoundingClientRect().top }))()`);
      assert.equal(geometry.scale, '1.5', 'emergency rest must respect reading size');
      assert.equal(geometry.scroll, false, 'enlarged emergency rest must fit a compact viewport');
      assert.equal(geometry.collision, false, 'emergency instruction must not cover actions');
      await capture(alert, 'rest-compact-large-reading', viewport);
      await restSession.call('Emulation.clearDeviceMetricsOverride');
      restSession.close();
    }
    await waitFor(alert, emergency ? `document.querySelector('#complete')?.disabled === false && document.querySelector('#start')?.hidden === true` : `Boolean(document.querySelector('.rest-away-card.is-finished'))`, 30000);
    await capture(alert, 'rest-finished');
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
    await call(pet, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: 92, y: 80, button: 'left', buttons: 1 });
    await waitFor(pet, `document.querySelector('.pet-drag-surface').classList.contains('is-dragging') /* home ${JSON.stringify(petHome)} workArea ${JSON.stringify(workArea)} */`, 6_000);
    await call(pet, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: 92, y: 80, button: 'left', buttons: 0, clickCount: 1 });
    const homeAfterNudge = await evaluate(pet, 'screenX');
    assert.ok(
      Math.abs(homeAfterNudge - petHome.x) <= 30,
      `one drag move must move the window: home ${petHome.x}, after nudge ${homeAfterNudge}`
    );
    // Each sweep step is a complete press → move → release. A CI runner has no
    // interactive desktop and stops applying continuous window moves after the
    // first one of a drag (measured: the pet moved once, then reported the same
    // screenX for all 50 steps). A fresh press re-arms the drag on every step,
    // which still exercises what this loop exists for: the window keeps its
    // size while it is dragged and the bubble keeps following it.
    for (let step = 1; step <= 50; step += 1) {
      const dx = Math.round(Math.sin(step / 50 * Math.PI * 2) * 180);
      const currentX = await settledPetX();
      const clientX = start.x + 80 + dx - currentX;
      await call(pet, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: 80, y: 80, button: 'left', buttons: 1, clickCount: 1 });
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
      await call(pet, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: clientX, y: 80, button: 'left', buttons: 0, clickCount: 1 });
    }
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
    // The pet's focus entry now lives in a native right-click menu, which CDP
    // cannot drive, so this asserts the entry survived the relaunch and then
    // follows the same free-focus call the menu item makes through the bubble.
    assert.equal(await evaluate(restarted, `typeof window.eyeProtect.showPetContextMenu`), 'function', 'the pet context-menu entry must survive a relaunch');
    await evaluate(restarted, `window.eyeProtect.preparePomodoro(null, true)`);
    bubble = await waitForTarget(endpoint, '#bubble');
    await waitFor(bubble, `document.querySelector('[aria-label="专注分钟数"]') !== null`);
    assert.equal((await evaluate(restarted, 'window.eyeProtect.getPomodoro()')).taskId, null);
    await waitFor(bubble, `document.querySelector('[aria-label="专注分钟数"]')?.value === '1'`);
    await capture(bubble, 'pomodoro-ready');
    await click(bubble, '返回待办');
  }
  if (phase === 'all') {
    const currentPet = await waitForTarget(endpoint, '#pet');
    await evaluate(currentPet, `window.eyeProtect.openWorkbench('review')`);
    const currentWorkbench = await waitForTarget(endpoint, '#workbench');
    await waitFor(currentWorkbench, `document.querySelector('.simple-rest-companion') !== null`);
    const before = await evaluate(currentWorkbench, `window.eyeProtect.getRestCompanion()`);
    const real = await evaluate(currentPet, `window.eyeProtect.triggerNow()`);
    const id = real.activeReminder.id;
    await waitFor(currentPet, `(async () => typeof (await window.eyeProtect.getReminderStatus()).activeReminder?.restStartedAt === 'number')()`);
    const deadline = await evaluate(currentPet, `(async () => (await window.eyeProtect.getReminderStatus()).activeReminder.unlockAt)()`);
    await delay(Math.max(0, deadline - Date.now()) + 2700);
    const ready = await evaluate(currentPet, `window.eyeProtect.getReminderStatus()`);
    assert.equal(ready.activeReminder, null, 'the real rest must finish without a click');
    await waitFor(currentWorkbench, `document.querySelector('.simple-rest-companion h2 small')?.textContent === '${before.completed + 1} 次'`);
    assert.equal((await evaluate(currentWorkbench, `window.eyeProtect.getRestCompanion()`)).completed, before.completed + 1);
    await capture(currentWorkbench, 'weekly-rest-completed');
    const skip = await evaluate(currentPet, `window.eyeProtect.triggerNow()`);
    await evaluate(currentPet, `window.eyeProtect.reminderAction('skip', ${JSON.stringify(skip.activeReminder.id)})`);
    const snooze = await evaluate(currentPet, `window.eyeProtect.triggerNow()`);
    await evaluate(currentPet, `window.eyeProtect.reminderAction('snooze', ${JSON.stringify(snooze.activeReminder.id)})`);
    assert.equal((await evaluate(currentWorkbench, `window.eyeProtect.getRestCompanion()`)).completed, before.completed + 1, 'skip and snooze must not create completed breaks');
    console.log('Real rest history and immediate weekly companion updates passed.');
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
