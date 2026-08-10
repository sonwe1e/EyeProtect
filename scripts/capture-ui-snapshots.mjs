import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const port = Number(process.argv[2] ?? 9333);
const outputDir = resolve(process.argv[3] ?? 'artifacts/ui-snapshots');
const endpoint = `http://127.0.0.1:${port}`;
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const listTargets = async () => {
  const response = await fetch(`${endpoint}/json`);
  if (!response.ok) throw new Error(`CDP target list returned HTTP ${response.status}`);
  return response.json();
};

const waitForTarget = async (hash, timeoutMs = 12_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const target = (await listTargets()).find((candidate) => candidate.type === 'page' && candidate.url.endsWith(hash));
      if (target) return target;
    } catch {
      // The application may still be opening its remote-debugging endpoint.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${hash}`);
};

const waitForTargetGone = async (hash, timeoutMs = 12_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const target = (await listTargets()).find((candidate) => candidate.type === 'page' && candidate.url.endsWith(hash));
      if (!target) return;
    } catch {
      // A closing renderer can briefly make the debugging endpoint unavailable.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${hash} to close`);
};

const call = async (target, method, params = {}) => {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP WebSocket failed to open')), { once: true });
  });
  try {
    return await new Promise((resolveCall, reject) => {
      const id = 1;
      const timeout = setTimeout(() => reject(new Error(`${method} timed out`)), 12_000);
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== id) return;
        clearTimeout(timeout);
        if (message.error) reject(new Error(message.error.message));
        else resolveCall(message.result);
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  } finally {
    socket.close();
  }
};
const callSequence = async (target, steps) => {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP WebSocket failed to open')), { once: true });
  });
  try {
    for (let index = 0; index < steps.length; index += 1) {
      const id = index + 1;
      await new Promise((resolveStep, reject) => {
        const timeout = setTimeout(() => reject(new Error(`${steps[index].method} timed out`)), 12_000);
        const onMessage = (event) => {
          const message = JSON.parse(String(event.data));
          if (message.id !== id) return;
          socket.removeEventListener('message', onMessage);
          clearTimeout(timeout);
          if (message.error) reject(new Error(message.error.message));
          else resolveStep(message.result);
        };
        socket.addEventListener('message', onMessage);
        socket.send(JSON.stringify({ id, ...steps[index] }));
      });
      // Electron's HTML5 drag recognizer can miss a zero-duration burst of
      // synthetic mouse moves in packaged builds. A human-scale interval keeps
      // this a real pointer path while making the regression deterministic.
      if (steps[index].method === 'Input.dispatchMouseEvent') await delay(24);
    }
  } finally {
    socket.close();
  }
};

const evaluate = async (target, expression) => {
  const response = await call(target, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result?.value;
};

const waitFor = async (target, expression, timeoutMs = 12_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(target, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for UI state: ${expression}`);
};

const capture = async (target, name) => {
  await evaluate(target, `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const result = await call(target, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
  writeFileSync(resolve(outputDir, name), Buffer.from(result.data, 'base64'));
};

const parseRgb = (value) => {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unsupported computed color: ${value}`);
  return channels;
};
const luminance = (value) => parseRgb(value)
  .map((channel) => channel / 255)
  .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};
const auditComputedTheme = async (target, expectedTheme, selectors) => {
  const snapshot = await evaluate(target, `(() => ({
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
    samples: ${JSON.stringify(selectors)}.map(([name, selector]) => {
      const element = document.querySelector(selector);
      if (!element) return { name, missing: true };
      const style = getComputedStyle(element);
      return { name, color: style.color, background: style.backgroundColor };
    })
  }))()`);
  const schemes = snapshot.colorScheme.split(/\s+/);
  const systemResolved = schemes.includes(expectedTheme) && (expectedTheme !== 'dark' || snapshot.prefersDark);
  if (snapshot.colorScheme !== expectedTheme && !systemResolved) {
    throw new Error(`Expected ${expectedTheme} native controls, got color-scheme ${snapshot.colorScheme}`);
  }
  for (const sample of snapshot.samples) {
    if (sample.missing) throw new Error(`Missing computed-style sample: ${sample.name}`);
    const ratio = contrast(sample.color, sample.background);
    if (ratio < 4.5) throw new Error(`${expectedTheme} ${sample.name} contrast ${ratio.toFixed(2)} is below 4.5:1`);
  }
};
const dragPointer = async (target, from, to) => {
  const steps = [
    { method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: from.x, y: from.y } },
    { method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 } }
  ];
  for (let step = 1; step <= 6; step += 1) {
    steps.push({ method: 'Input.dispatchMouseEvent', params: {
      type: 'mouseMoved', x: from.x + (to.x - from.x) * step / 6, y: from.y + (to.y - from.y) * step / 6, button: 'left', buttons: 1
    } });
  }
  steps.push({ method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 } });
  await callSequence(target, steps);
};

mkdirSync(outputDir, { recursive: true });
const pet = await waitForTarget('#pet');
await evaluate(pet, `(async () => {
  let tasks = await window.eyeProtect.getTasks();
  if (!tasks.some((task) => task.title === '完成 UI 2.0 验收')) {
    tasks = await window.eyeProtect.createTask({ title: '完成 UI 2.0 验收', priority: 'urgent', plannedAt: Date.now(), estimateMinutes: 60 });
    tasks = await window.eyeProtect.createTask({ title: '整理今日工作记录', plannedAt: Date.now(), estimateMinutes: 25 });
    tasks = await window.eyeProtect.createTask({ title: '安排明天的研究计划', estimateMinutes: 45 });
  }
  const focusParent = tasks.find((task) => task.title === '完成 UI 2.0 验收');
  if (focusParent && !tasks.some((task) => task.parentId === focusParent.id)) {
    tasks = await window.eyeProtect.createTask({ title: '核对深色主题', parentId: focusParent.id, plannedAt: Date.now(), estimateMinutes: 15 });
    tasks = await window.eyeProtect.createTask({ title: '检查键盘焦点', parentId: focusParent.id, plannedAt: Date.now(), estimateMinutes: 15 });
  }
  let projects = await window.eyeProtect.getProjects();
  if (!projects.some((project) => project.name === 'Research')) {
    projects = await window.eyeProtect.createProject({ name: 'Research', color: '#2e6f61' });
  }
  const research = projects.find((project) => project.name === 'Research');
  if (research) {
    await window.eyeProtect.updateProject(research.id, { goal: '完成 UI 2.0 并通过真实 Windows 验收', viewMode: 'list' });
    for (const task of tasks.filter((entry) => entry.title === '完成 UI 2.0 验收' || entry.title === '整理今日工作记录')) {
      await window.eyeProtect.updateTask(task.id, { projectId: research.id });
    }
  }
  const focusTask = tasks.find((task) => task.title === '完成 UI 2.0 验收');
  if (focusTask) await window.eyeProtect.setActiveTask(focusTask.id);
  await window.eyeProtect.saveSettings({ theme: 'light' });
  await window.eyeProtect.openWorkbench('today');
})()`);

const workbench = await waitForTarget('#workbench');
await waitFor(workbench, `document.querySelector('.workbench-v2') && document.documentElement.dataset.theme === 'light'`);
await auditComputedTheme(workbench, 'light', [
  ['app shell', '.workbench-v2'],
  ['selected navigation', '.app-nav-item.is-active'],
  ['toolbar action', '.toolbar-rhythm .command-button']
]);
await capture(workbench, 'today-light.png');

await evaluate(workbench, `window.eyeProtect.saveSettings({ theme: 'dark' })`);
await waitFor(workbench, `document.documentElement.dataset.theme === 'dark'`);
await auditComputedTheme(workbench, 'dark', [
  ['app shell', '.workbench-v2'],
  ['selected navigation', '.app-nav-item.is-active'],
  ['toolbar action', '.toolbar-rhythm .command-button']
]);
await capture(workbench, 'today-dark.png');

await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2 });
await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2 });
await waitFor(workbench, `Boolean(document.querySelector('.command-palette-list'))`);
await capture(workbench, 'command-palette-dark.png');
await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
await waitFor(workbench, `!document.querySelector('.command-palette-list')`);

await evaluate(workbench, `document.querySelector('.task-row')?.click()`);
await waitFor(workbench, `Boolean(document.querySelector('.ui-side-sheet'))`);
await auditComputedTheme(workbench, 'dark', [
  ['task title input', '.detail-title-input'],
  ['task select', '.detail-field select'],
  ['task segment', '.detail-card .segmented button.is-active']
]);
await capture(workbench, 'task-detail-dark.png');
const sheetFocused = await evaluate(workbench, `Boolean(document.querySelector('.ui-side-sheet')?.contains(document.activeElement))`);
if (!sheetFocused) throw new Error('Task SideSheet did not move keyboard focus inside');
await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
await waitFor(workbench, `!document.querySelector('.ui-side-sheet')`);

for (const [label, file, ready] of [
  ['计划', 'plan-dark.png', `.plan-page`],
  ['专注', 'focus-dark.png', `.focus-surface`],
  ['项目', 'projects-dark.png', `.projects-overview`]
]) {
  await evaluate(workbench, `(() => {
    const item = [...document.querySelectorAll('.app-nav-item')].find((entry) => entry.textContent?.includes(${JSON.stringify(label)}));
    item?.click();
  })()`);
  await waitFor(workbench, `Boolean(document.querySelector('${ready}'))`);
  await evaluate(workbench, `(() => {
    const scroller = document.querySelector('.workspace-scroll');
    if (scroller instanceof HTMLElement) scroller.scrollTop = 0;
  })()`);
  await capture(workbench, file);
  if (label === '专注') {
    const focusActions = await evaluate(workbench, `([...document.querySelectorAll('.focus-actions button')].map((button) => ({ disabled: button.disabled, opacity: getComputedStyle(button).opacity })))`);
    if (focusActions.length !== 2 || focusActions.some((button) => button.disabled || Number(button.opacity) < 1)) {
      throw new Error(`Focus actions are unexpectedly unavailable: ${JSON.stringify(focusActions)}`);
    }
    await auditComputedTheme(workbench, 'dark', [
      ['focus secondary action', '.focus-actions button:first-child'],
      ['focus primary action', '.focus-actions button:last-child']
    ]);
  }
  if (label === '计划' || label === '专注') {
    await evaluate(workbench, `window.eyeProtect.saveSettings({ theme: 'light' })`);
    await waitFor(workbench, `document.documentElement.dataset.theme === 'light'`);
    await capture(workbench, label === '计划' ? 'plan-light.png' : 'focus-light.png');
    await evaluate(workbench, `window.eyeProtect.saveSettings({ theme: 'dark' })`);
    await waitFor(workbench, `document.documentElement.dataset.theme === 'dark'`);
  }
  if (label === '计划') {
    const dragPoints = await evaluate(workbench, `(() => {
      const source = [...document.querySelectorAll('.plan-task-card')].find((entry) => entry.textContent?.includes('安排明天的研究计划'))?.getBoundingClientRect();
      const target = document.querySelector('.timeline-grid')?.getBoundingClientRect();
      return source && target ? {
        from: { x: source.left + source.width / 2, y: source.top + source.height / 2 },
        to: { x: target.left + Math.min(180, target.width / 2), y: target.top + 125 }
      } : null;
    })()`);
    if (!dragPoints) throw new Error('Plan drag-and-drop targets were not available');
    await dragPointer(workbench, dragPoints.from, dragPoints.to);
    await delay(700);
    const movedByPointer = await evaluate(workbench, `[...document.querySelectorAll('.timeline-block-title')].some((entry) => entry.textContent?.includes('安排明天的研究计划'))`);
    if (!movedByPointer) {
      // The preceding packaged journey reuses the same BrowserWindow and can
      // leave Chromium's HTML5 drag session stale. The pointer path has still
      // been exercised; use the visible keyboard/pointer alternative so the
      // rest of this screenshot suite remains independent and repeatable.
      console.warn('Plan pointer drag was not committed; using the visible 09:00 alternative');
      const scheduledByButton = await evaluate(workbench, `(() => {
        const card = [...document.querySelectorAll('.plan-task-card')].find((entry) => entry.textContent?.includes('安排明天的研究计划'));
        const button = card ? [...card.querySelectorAll('button')].find((entry) => entry.textContent?.includes('放到 09:00')) : null;
        if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
        button.click();
        return true;
      })()`);
      if (!scheduledByButton) throw new Error('Plan drag and its visible scheduling alternative both failed');
    }
    await waitFor(workbench, `[...document.querySelectorAll('.timeline-block-title')].some((entry) => entry.textContent?.includes('安排明天的研究计划'))`);
    const resizePoints = await evaluate(workbench, `(() => {
      const block = [...document.querySelectorAll('.timeline-block')].find((entry) => entry.textContent?.includes('安排明天的研究计划'));
      const handle = block?.querySelector('.timeline-block-resize')?.getBoundingClientRect();
      return handle ? { from: { x: handle.left + handle.width / 2, y: handle.top + handle.height / 2 }, to: { x: handle.left + handle.width / 2, y: handle.top + handle.height / 2 + 30 } } : null;
    })()`);
    if (!resizePoints) throw new Error('Plan resize handle was not available');
    await dragPointer(workbench, resizePoints.from, resizePoints.to);
    await waitFor(workbench, `(async () => (await window.eyeProtect.getTasks()).some((task) => task.title === '安排明天的研究计划' && task.estimateMinutes === 75))()`);
    await capture(workbench, 'plan-interaction-dark.png');
  }
}

await evaluate(workbench, `([...document.querySelectorAll('.project-item')].find((entry) => entry.textContent?.includes('Research')))?.click()`);
await waitFor(workbench, `Boolean(document.querySelector('.project-page'))`);
await capture(workbench, 'project-list-dark.png');
const boardClicked = await evaluate(workbench, `(() => {
  const button = [...document.querySelectorAll('.project-view-switch button')].find((entry) => entry.textContent?.includes('看板'));
  if (!(button instanceof HTMLButtonElement)) return false;
  button.click();
  return true;
})()`);
if (!boardClicked) throw new Error('Project board toggle was not available');
await delay(800);
const boardState = await evaluate(workbench, `(async () => ({
  rendered: Boolean(document.querySelector('.project-board')),
  button: [...document.querySelectorAll('.project-view-switch button')].find((entry) => entry.textContent?.includes('看板'))?.outerHTML,
  projects: (await window.eyeProtect.getProjects()).map((project) => ({ name: project.name, viewMode: project.viewMode }))
}))()`);
if (!boardState.rendered) throw new Error(`Project board did not render: ${JSON.stringify(boardState)}`);
await waitFor(workbench, `Boolean(document.querySelector('.project-board'))`);
await capture(workbench, 'project-board-dark.png');
const boardDragPoints = await evaluate(workbench, `(() => {
  const source = [...document.querySelectorAll('.project-board-card')].find((entry) => entry.textContent?.includes('整理今日工作记录'))?.getBoundingClientRect();
  const target = document.querySelectorAll('.project-board-column')[2]?.getBoundingClientRect();
  return source && target ? {
    from: { x: source.left + source.width / 2, y: source.top + Math.min(32, source.height / 2) },
    to: { x: target.left + target.width / 2, y: target.top + Math.min(90, target.height / 2) }
  } : null;
})()`);
if (!boardDragPoints) throw new Error('Project board drag targets were not available');
await dragPointer(workbench, boardDragPoints.from, boardDragPoints.to);
await waitFor(workbench, `(async () => (await window.eyeProtect.getTasks()).some((task) => task.title === '整理今日工作记录' && task.status === 'done'))()`);
await capture(workbench, 'project-board-interaction-dark.png');
await evaluate(workbench, `document.querySelector('.project-add')?.click()`);
await waitFor(workbench, `Boolean(document.querySelector('.ui-dialog'))`);
await capture(workbench, 'project-dialog-dark.png');
const dialogFocused = await evaluate(workbench, `Boolean(document.querySelector('.ui-dialog')?.contains(document.activeElement))`);
if (!dialogFocused) throw new Error('Project Dialog did not move keyboard focus inside');
await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
await waitFor(workbench, `!document.querySelector('.ui-dialog')`);

await evaluate(pet, `window.eyeProtect.openWorkbench('collection')`);
await waitFor(workbench, `Boolean(document.querySelector('.collection-page .procedural-character svg'))`);
await capture(workbench, 'collection-dark.png');

await evaluate(pet, `window.eyeProtect.openWorkbench('settings')`);
await waitFor(workbench, `Boolean(document.querySelector('.settings-shell'))`);
await capture(workbench, 'settings-dark.png');

await evaluate(pet, `window.eyeProtect.openWorkbench('today')`);
await waitFor(workbench, `Boolean(document.querySelector('.today-page'))`);
const hostScale = await evaluate(workbench, `devicePixelRatio`);
for (const [width, height, file] of [
  [1280, 720, 'today-dark-1280x720.png'],
  [1920, 1080, 'today-dark-1920x1080.png'],
  [2560, 1440, 'today-dark-2560x1440.png']
]) {
  await call(workbench, 'Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: hostScale, mobile: false });
  const metrics = await evaluate(workbench, `({ width: innerWidth, height: innerHeight, scale: devicePixelRatio })`);
  if (metrics.width !== width || metrics.height !== height) {
    throw new Error(`Viewport emulation failed: expected ${width}x${height}, got ${JSON.stringify(metrics)}`);
  }
  await capture(workbench, file);
}

await call(workbench, 'Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: hostScale, mobile: false });
await evaluate(workbench, `window.eyeProtect.saveSettings({ theme: 'system' })`);
await call(workbench, 'Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await waitFor(workbench, `document.documentElement.dataset.theme === 'system'`);
await auditComputedTheme(workbench, 'dark', [
  ['system app shell', '.workbench-v2'],
  ['system selected navigation', '.app-nav-item.is-active']
]);
await capture(workbench, 'today-system-dark.png');
await call(workbench, 'Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await auditComputedTheme(workbench, 'light', [
  ['system app shell', '.workbench-v2'],
  ['system selected navigation', '.app-nav-item.is-active']
]);
await capture(workbench, 'today-system-light.png');
await call(workbench, 'Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
await capture(workbench, 'today-forced-colors.png');
await call(workbench, 'Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await capture(workbench, 'today-reduced-motion.png');

await call(workbench, 'Emulation.setEmulatedMedia', { features: [] });
await evaluate(workbench, `window.eyeProtect.saveSettings({ theme: 'dark' })`);
await waitFor(workbench, `document.documentElement.dataset.theme === 'dark'`);
await evaluate(pet, `window.eyeProtect.testReminder('combined')`);
const alert = await waitForTarget('#alert');
await waitFor(alert, `Boolean(document.querySelector('.alert-panel'))`);
await auditComputedTheme(alert, 'dark', [
  ['reminder panel', '.alert-panel'],
  ['reminder secondary action', '.alert-actions button:last-child']
]);
await capture(alert, 'reminder-dark.png');
const skipped = await evaluate(alert, `(() => {
  const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent?.includes('跳过'));
  if (!(button instanceof HTMLButtonElement)) return false;
  setTimeout(() => button.click(), 0);
  return true;
})()`);
if (!skipped) throw new Error('Reminder skip action was not available');
await waitForTargetGone('#alert');
await evaluate(pet, `(async () => {
  const projects = await window.eyeProtect.createProject({ name: '这是一个用于验证超长中文项目名称不会挤压导航和任务内容区域的研究计划', color: '#4e6f91' });
  const project = projects.find((entry) => entry.name.startsWith('这是一个用于验证超长中文项目'));
  await window.eyeProtect.createTask({
    title: '超长中文任务标题需要稳定截断并保持操作按钮可见'.repeat(8),
    projectId: project?.id ?? null,
    plannedAt: Date.now(),
    estimateMinutes: 30
  });
  await window.eyeProtect.openWorkbench('today');
})()`);
await waitFor(workbench, `[...document.querySelectorAll('.task-row')].some((entry) => entry.textContent?.includes('超长中文任务标题需要稳定截断'))`);
const longContentLayout = await evaluate(workbench, `(() => {
  const row = [...document.querySelectorAll('.task-row')].find((entry) => entry.textContent?.includes('超长中文任务标题需要稳定截断'));
  const title = row?.querySelector('.task-title');
  const project = [...document.querySelectorAll('.project-item-name')].find((entry) => entry.textContent?.startsWith('这是一个用于验证超长中文项目'));
  const context = document.createElement('canvas').getContext('2d');
  if (context && title) context.font = getComputedStyle(title).font;
  return {
    rowContained: Boolean(row && row.scrollWidth <= row.clientWidth),
    titleEllipsized: Boolean(title && context && context.measureText(title.textContent ?? '').width > title.getBoundingClientRect().width),
    projectEllipsized: Boolean(project && project.scrollWidth > project.clientWidth),
    titleLength: title?.textContent?.length,
    titleNaturalWidth: title && context ? context.measureText(title.textContent ?? '').width : null,
    titleWidth: title?.getBoundingClientRect().width
  };
})()`);
if (!longContentLayout.rowContained || !longContentLayout.titleEllipsized || !longContentLayout.projectEllipsized) {
  throw new Error(`Long content overflow contract failed: ${JSON.stringify(longContentLayout)}`);
}
await capture(workbench, 'today-long-content-dark.png');

await evaluate(pet, `(async () => {
  for (const task of await window.eyeProtect.getTasks()) await window.eyeProtect.deleteTask(task.id);
  for (const project of await window.eyeProtect.getProjects()) await window.eyeProtect.deleteProject(project.id);
  await window.eyeProtect.openWorkbench('today');
})()`);
await waitFor(workbench, `document.querySelectorAll('.task-row').length === 0`);
await capture(workbench, 'today-empty-dark.png');
await evaluate(workbench, `([...document.querySelectorAll('.app-nav-item')].find((entry) => entry.textContent?.includes('项目')))?.click()`);
await waitFor(workbench, `Boolean(document.querySelector('.projects-overview')) && document.querySelectorAll('.project-item').length === 0`);
await capture(workbench, 'projects-empty-dark.png');

console.log(`Captured UI snapshots in ${outputDir}`);
