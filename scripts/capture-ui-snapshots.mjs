import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const port = Number(process.argv[2] ?? 9333);
const outputDir = resolve(process.argv[3] ?? 'artifacts/ui-snapshots');
const repeatFlag = process.argv.indexOf('--repeat');
const repeat = repeatFlag >= 0 ? Number(process.argv[repeatFlag + 1] ?? 1) : 1;

if (!Number.isInteger(repeat) || repeat < 1 || repeat > 10) {
  throw new Error('--repeat must be an integer between 1 and 10');
}

if (repeat > 1) {
  const metricSnapshots = [];
  const temporaryDirs = [];
  for (let pass = 1; pass <= repeat; pass += 1) {
    const passDir = pass === repeat ? outputDir : resolve(outputDir, `.repeat-${pass}`);
    if (pass !== repeat) temporaryDirs.push(passDir);
    const result = spawnSync(process.execPath, [process.argv[1], String(port), passDir], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'inherit'
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
    metricSnapshots.push(readFileSync(resolve(passDir, 'layout-metrics.json'), 'utf8'));
  }
  if (metricSnapshots.some((snapshot) => snapshot !== metricSnapshots[0])) {
    throw new Error('capture:ui repeat produced different layout metrics after fixture reset');
  }
  for (const directory of temporaryDirs) rmSync(directory, { recursive: true, force: true });
  console.log(`capture:ui completed ${repeat} identical fixture/layout passes`);
  process.exit(0);
}
const endpoint = `http://127.0.0.1:${port}`;
import { call, callSequence, delay, evaluate, listTargets, openSession, waitFor, waitForTarget, waitForTargetGone } from './lib/cdp.mjs';
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

const setViewport = async (target, width, height, deviceScaleFactor) => {
  await call(target, 'Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
  const metrics = await evaluate(target, `({ width: innerWidth, height: innerHeight, scale: devicePixelRatio })`);
  if (metrics.width !== width || metrics.height !== height) {
    throw new Error(`Viewport emulation failed: expected ${width}x${height}, got ${JSON.stringify(metrics)}`);
  }
};

const selectNavigation = async (target, label, readySelector) => {
  const selected = await evaluate(target, `(() => {
    const item = [...document.querySelectorAll('.app-nav-item')].find((entry) => entry.textContent?.includes(${JSON.stringify(label)}));
    if (!(item instanceof HTMLButtonElement)) return false;
    item.click();
    return true;
  })()`);
  if (!selected) throw new Error(`Navigation item was not available: ${label}`);
  await waitFor(target, `Boolean(document.querySelector(${JSON.stringify(readySelector)}))`);
  await evaluate(target, `(async () => {
    const workspace = document.querySelector('.workspace-scroll');
    const sidebar = document.querySelector('.app-sidebar');
    if (workspace instanceof HTMLElement) { workspace.scrollTop = 0; workspace.scrollLeft = 0; }
    if (sidebar instanceof HTMLElement) sidebar.scrollTop = 0;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
};

const collectLayoutMetrics = (target) => evaluate(target, `(() => {
  const rect = (selector) => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) return null;
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: bounds.width, height: bounds.height };
  };
  const workspace = document.querySelector('.workspace-scroll');
  const page = document.querySelector('.workspace-page');
  const board = document.querySelector('.project-board');
  const planLayout = document.querySelector('.plan-layout');
  const planBacklog = document.querySelector('.plan-backlog');
  const planTimeline = document.querySelector('.plan-timeline');
  const dateStrip = document.querySelector('.plan-day-switch');
  const row = document.querySelector('.task-row');
  return {
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    workspaceClientWidth: workspace?.clientWidth ?? null,
    workspaceScrollWidth: workspace?.scrollWidth ?? null,
    pageClientWidth: page?.clientWidth ?? null,
    pageScrollWidth: page?.scrollWidth ?? null,
    pageHeader: rect('.page-header'),
    planTitle: rect('.plan-page .page-header h1'),
    planDateStrip: rect('.plan-day-switch'),
    planColumnCount: planLayout instanceof HTMLElement ? getComputedStyle(planLayout).gridTemplateColumns.split(/\s+/).filter(Boolean).length : null,
    planColumnsShareRow: planBacklog instanceof HTMLElement && planTimeline instanceof HTMLElement
      ? Math.abs(planBacklog.getBoundingClientRect().top - planTimeline.getBoundingClientRect().top) < 2
      : null,
    planColumnsSideBySide: planBacklog instanceof HTMLElement && planTimeline instanceof HTMLElement
      ? planTimeline.getBoundingClientRect().left > planBacklog.getBoundingClientRect().right
      : null,
    planDateStripContained: dateStrip instanceof HTMLElement ? dateStrip.scrollWidth <= dateStrip.clientWidth : null,
    projectBoardClientWidth: board?.clientWidth ?? null,
    projectBoardScrollWidth: board?.scrollWidth ?? null,
    primaryNavCount: document.querySelectorAll('.primary-nav .app-nav-item').length,
    activePrimaryNavCount: document.querySelectorAll('.primary-nav .app-nav-item.is-active').length,
    taskRowHeight: row instanceof HTMLElement ? row.getBoundingClientRect().height : null
  };
})()`);

const assertPageLayout = (label, metrics) => {
  if (metrics.documentScrollWidth > metrics.documentClientWidth) {
    throw new Error(`${label}: document has horizontal overflow: ${JSON.stringify(metrics)}`);
  }
  if (metrics.workspaceScrollWidth > metrics.workspaceClientWidth) {
    throw new Error(`${label}: workspace has page-level horizontal overflow: ${JSON.stringify(metrics)}`);
  }
  if (metrics.pageScrollWidth > metrics.pageClientWidth) {
    throw new Error(`${label}: page has horizontal overflow: ${JSON.stringify(metrics)}`);
  }
  if (metrics.primaryNavCount !== 4 || metrics.activePrimaryNavCount !== 1) {
    throw new Error(`${label}: primary navigation contract failed: ${JSON.stringify(metrics)}`);
  }
};

mkdirSync(outputDir, { recursive: true });
const pet = await waitForTarget(endpoint, '#pet');
await waitFor(pet, `(async () => {
  const api = window.eyeProtect;
  const methods = ['getTasks', 'createTask', 'deleteTask', 'getProjects', 'createProject', 'deleteProject', 'updateProject', 'updateTask', 'setActiveTask', 'upsertDailyPlan', 'createTimeBlock', 'createProjectSection', 'startFocus', 'pauseFocus', 'saveSettings', 'openWorkbench', 'getCharacterCollection'];
  return Boolean(api) && methods.every((name) => typeof api[name] === 'function');
})()`);
await evaluate(pet, `(async () => {
  const focusStatus = await window.eyeProtect.getFocusStatus();
  if (focusStatus.session) await window.eyeProtect.pauseFocus();
  await window.eyeProtect.setActiveTask(null);
  for (const task of await window.eyeProtect.getTasks()) await window.eyeProtect.deleteTask(task.id);
  for (const project of await window.eyeProtect.getProjects()) await window.eyeProtect.deleteProject(project.id);

  let tasks = await window.eyeProtect.createTask({ title: '完成 UI 2.0 验收', priority: 'urgent', estimateMinutes: 60 });
  tasks = await window.eyeProtect.createTask({ title: '整理今日工作记录', estimateMinutes: 25 });
  tasks = await window.eyeProtect.createTask({ title: '安排明天的研究计划', estimateMinutes: 45 });
  const focusParent = tasks.find((task) => task.title === '完成 UI 2.0 验收');
  if (focusParent) {
    tasks = await window.eyeProtect.createTask({ title: '核对深色主题', parentId: focusParent.id, plannedAt: Date.now(), estimateMinutes: 15 });
    tasks = await window.eyeProtect.createTask({ title: '检查键盘焦点', parentId: focusParent.id, plannedAt: Date.now(), estimateMinutes: 15 });
  }
  const projects = await window.eyeProtect.createProject({ name: 'Research', color: '#2e6f61' });
  const research = projects.find((project) => project.name === 'Research');
  if (research) {
    await window.eyeProtect.updateProject(research.id, { goal: '完成 UI 2.0 并通过真实 Windows 验收', viewMode: 'list' });
    for (const task of tasks.filter((entry) => entry.title === '完成 UI 2.0 验收' || entry.title === '整理今日工作记录')) {
      await window.eyeProtect.updateTask(task.id, { projectId: research.id });
    }
    await window.eyeProtect.createProjectSection({ projectId: research.id, name: 'Doing' });
    await window.eyeProtect.createProjectSection({ projectId: research.id, name: 'Waiting' });
  }
  const focusTask = tasks.find((task) => task.title === '完成 UI 2.0 验收');
  const recordTask = tasks.find((task) => task.title === '整理今日工作记录');
  const localDate = new Date().toLocaleDateString('en-CA');
  if (focusTask) await window.eyeProtect.upsertDailyPlan({ taskId: focusTask.id, localDate, dailyRank: 1, plannedMinutes: 60 });
  if (recordTask) await window.eyeProtect.upsertDailyPlan({ taskId: recordTask.id, localDate, plannedMinutes: 25 });
  if (focusTask) {
    const start = new Date();
    start.setHours(10, 0, 0, 0);
    await window.eyeProtect.createTimeBlock({ taskId: focusTask.id, startAt: start.getTime(), endAt: start.getTime() + 60 * 60_000, source: 'planner' });
    const microTask = tasks.find((task) => task.title === '核对深色主题');
    if (microTask) await window.eyeProtect.createTimeBlock({ taskId: microTask.id, startAt: start.getTime() - 60 * 60_000, endAt: start.getTime() - 45 * 60_000, source: 'planner' });
    if (recordTask) await window.eyeProtect.createTimeBlock({ taskId: recordTask.id, startAt: start.getTime() - 45 * 60_000, endAt: start.getTime() - 15 * 60_000, source: 'planner' });
    await window.eyeProtect.setActiveTask(focusTask.id);
  }
  await window.eyeProtect.saveSettings({ theme: 'light' });
  await window.eyeProtect.openWorkbench('today');
})()`);

const workbench = await waitForTarget(endpoint, '#workbench');
await waitFor(workbench, `document.querySelector('.workbench-v2') && document.documentElement.dataset.theme === 'light'`);
await auditComputedTheme(workbench, 'light', [
  ['app shell', '.workbench-v2'],
  ['selected navigation', '.app-nav-item.is-active'],
  ['toolbar action', '.toolbar-rhythm .command-button']
]);
await capture(workbench, 'today-light.png');

await evaluate(workbench, `window.eyeProtect.saveSettings({ theme: 'dark', reminderMode: 'guided' })`);
await waitFor(workbench, `document.documentElement.dataset.theme === 'dark'`);
await auditComputedTheme(workbench, 'dark', [
  ['app shell', '.workbench-v2'],
  ['selected navigation', '.app-nav-item.is-active'],
  ['toolbar action', '.toolbar-rhythm .command-button']
]);
await capture(workbench, 'today-dark.png');

await evaluate(workbench, `(() => {
  const input = document.querySelector('[data-quick-add="true"]');
  const form = input?.closest('form');
  if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, 'SNAPSHOT_TODAY_QUICK_ADD');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  setTimeout(() => form.requestSubmit(), 0);
  return true;
})()`);
await waitFor(workbench, `(async () => {
  const task = (await window.eyeProtect.getTasks()).find((entry) => entry.title === 'SNAPSHOT_TODAY_QUICK_ADD');
  if (!task) return false;
  const localDate = new Date().toLocaleDateString('en-CA');
  return (await window.eyeProtect.getDailyPlans(localDate)).some((plan) => plan.taskId === task.id)
    && [...document.querySelectorAll('.task-row')].some((row) => row.textContent?.includes('SNAPSHOT_TODAY_QUICK_ADD'));
})()`);
await capture(workbench, 'today-quick-add-dark.png');

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
  ['日程', 'plan-short-blocks-dark.png', `.plan-page`],
  ['专注', 'focus-pre-session-dark.png', `.focus-surface`],
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
    // An active task without a live session stays in the normal shell and
    // offers "开始专注". Only the resulting live session becomes immersive.
    // the session reveals the pause/complete pair and the four time layers.
    await evaluate(workbench, `(() => {
      const start = [...document.querySelectorAll('.focus-actions button')].find((entry) => entry.textContent?.includes('开始专注'));
      if (start instanceof HTMLButtonElement && !start.disabled) start.click();
      return Boolean(start);
    })()`);
    await waitFor(workbench, `[...document.querySelectorAll('.focus-actions button')].some((entry) => entry.textContent?.includes('暂停专注'))`);
    await waitFor(workbench, `document.querySelector('.workbench-v2')?.classList.contains('is-focus-mode') && Boolean(document.querySelector('.focus-back'))`);
    await capture(workbench, 'focus-session-dark.png');
    const focusActions = await evaluate(workbench, `([...document.querySelectorAll('.focus-actions button')].map((button) => ({ disabled: button.disabled, opacity: getComputedStyle(button).opacity })))`);
    if (focusActions.length !== 2 || focusActions.some((button) => button.disabled || Number(button.opacity) < 1)) {
      throw new Error(`Focus actions are unexpectedly unavailable: ${JSON.stringify(focusActions)}`);
    }
    await auditComputedTheme(workbench, 'dark', [
      ['focus secondary action', '.focus-actions button:first-child'],
      ['focus primary action', '.focus-actions button:last-child']
    ]);
  }
  if (label === '日程' || label === '专注') {
    await evaluate(workbench, `window.eyeProtect.saveSettings({ theme: 'light' })`);
    await waitFor(workbench, `document.documentElement.dataset.theme === 'light'`);
    await capture(workbench, label === '日程' ? 'plan-light.png' : 'focus-light.png');
    await evaluate(workbench, `window.eyeProtect.saveSettings({ theme: 'dark' })`);
    await waitFor(workbench, `document.documentElement.dataset.theme === 'dark'`);
  }
  if (label === '专注') {
    await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    await waitFor(workbench, `Boolean(document.querySelector('.today-page')) && !document.querySelector('.workbench-v2')?.classList.contains('is-focus-mode')`);
    const sessionSurvivedBack = await evaluate(workbench, `(async () => Boolean((await window.eyeProtect.getFocusStatus()).session))()`);
    if (!sessionSurvivedBack) throw new Error('Esc returned to the Workbench but incorrectly ended the FocusSession');
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
await waitFor(workbench, `[...document.querySelectorAll('.project-board-column h2')].some((entry) => entry.textContent?.includes('Doing'))`);
await capture(workbench, 'project-board-dark.png');
await evaluate(workbench, `document.querySelector('.project-add')?.click()`);
await waitFor(workbench, `Boolean(document.querySelector('.ui-dialog'))`);
await capture(workbench, 'project-dialog-dark.png');
const dialogFocused = await evaluate(workbench, `Boolean(document.querySelector('.ui-dialog')?.contains(document.activeElement))`);
if (!dialogFocused) throw new Error('Project Dialog did not move keyboard focus inside');
await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
await waitFor(workbench, `!document.querySelector('.ui-dialog')`);

// Foundation acceptance matrix: exercise the two critical small Windows sizes
// with machine-readable overflow, hierarchy and density assertions before
// capturing the screenshots. Project Board is the sole horizontal-scroll
// exception; the document/workspace/page must remain contained.
const acceptanceScale = await evaluate(workbench, `devicePixelRatio`);
const acceptanceMetrics = [];
for (const [width, height] of [[944, 561], [960, 600]]) {
  await setViewport(workbench, width, height, acceptanceScale);
  await evaluate(workbench, `window.eyeProtect.saveSettings({ theme: 'dark', density: 'comfortable' })`);
  await selectNavigation(workbench, '今天', '.today-page');
  const todayMetrics = await collectLayoutMetrics(workbench);
  assertPageLayout(`Today ${width}x${height}`, todayMetrics);
  if (todayMetrics.taskRowHeight !== null && Math.round(todayMetrics.taskRowHeight) !== 52) {
    throw new Error(`Today ${width}x${height}: comfortable task row must be 52px: ${JSON.stringify(todayMetrics)}`);
  }
  acceptanceMetrics.push({ surface: 'today', width, height, ...todayMetrics });
  await capture(workbench, `today-dark-${width}x${height}.png`);

  if (width === 960) {
    await evaluate(workbench, `document.querySelector('.task-row')?.click()`);
    await waitFor(workbench, `Boolean(document.querySelector('.ui-side-sheet'))`);
    const sheetMetrics = await evaluate(workbench, `(() => {
      const sheet = document.querySelector('.ui-side-sheet');
      const body = document.querySelector('.ui-side-sheet__body');
      const bounds = sheet?.getBoundingClientRect();
      return { left: bounds?.left, right: bounds?.right, top: bounds?.top, bottom: bounds?.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, bodyClientWidth: body?.clientWidth, bodyScrollWidth: body?.scrollWidth };
    })()`);
    if (sheetMetrics.left < 0 || sheetMetrics.right > width || sheetMetrics.top < 0 || sheetMetrics.bottom > height || sheetMetrics.bodyScrollWidth > sheetMetrics.bodyClientWidth) {
      throw new Error(`Task Detail 960x600 is clipped: ${JSON.stringify(sheetMetrics)}`);
    }
    await capture(workbench, 'task-detail-dark-960x600.png');
    await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    await waitFor(workbench, `!document.querySelector('.ui-side-sheet')`);

    await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2 });
    await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2 });
    await waitFor(workbench, `Boolean(document.querySelector('.command-palette-list'))`);
    await capture(workbench, 'command-palette-dark-960x600.png');
    await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    await waitFor(workbench, `!document.querySelector('.command-palette-list')`);

    await evaluate(workbench, `window.eyeProtect.saveSettings({ density: 'compact' })`);
    await waitFor(workbench, `document.documentElement.dataset.density === 'compact'`);
    const compactMetrics = await collectLayoutMetrics(workbench);
    if (compactMetrics.taskRowHeight !== null && Math.round(compactMetrics.taskRowHeight) !== 44) {
      throw new Error(`Today 960x600: compact task row must be 44px: ${JSON.stringify(compactMetrics)}`);
    }
    acceptanceMetrics.push({ surface: 'today-compact', width, height, ...compactMetrics });
    await capture(workbench, 'today-dark-960x600-compact.png');
    await evaluate(workbench, `window.eyeProtect.saveSettings({ density: 'comfortable' })`);
    await waitFor(workbench, `document.documentElement.dataset.density === 'comfortable'`);
  }

  await selectNavigation(workbench, '日程', '.plan-page');
  const planMetrics = await collectLayoutMetrics(workbench);
  assertPageLayout(`Plan ${width}x${height}`, planMetrics);
  const title = planMetrics.planTitle;
  const strip = planMetrics.planDateStrip;
  const overlaps = title && strip && !(title.right <= strip.left || strip.right <= title.left || title.bottom <= strip.top || strip.bottom <= title.top);
  if (!title || !strip || title.width < 40 || title.height > 60 || overlaps) {
    throw new Error(`Plan ${width}x${height}: title/date strip layout failed: ${JSON.stringify(planMetrics)}`);
  }
  if (!planMetrics.planColumnsShareRow || !planMetrics.planColumnsSideBySide || !planMetrics.planDateStripContained) {
    throw new Error(`Plan ${width}x${height}: dual-column/date-grid contract failed: ${JSON.stringify(planMetrics)}`);
  }
  acceptanceMetrics.push({ surface: 'plan', width, height, ...planMetrics });
  await capture(workbench, `plan-dark-${width}x${height}.png`);

  await evaluate(workbench, `([...document.querySelectorAll('.project-item')].find((entry) => entry.textContent?.includes('Research')))?.click()`);
  await waitFor(workbench, `Boolean(document.querySelector('.project-page'))`);
  if (width === 960) await capture(workbench, 'project-list-dark-960x600.png');
  const boardButton = await evaluate(workbench, `(() => {
    const button = [...document.querySelectorAll('.project-view-switch button')].find((entry) => entry.textContent?.includes('看板'));
    if (!(button instanceof HTMLButtonElement)) return false;
    if (!button.classList.contains('is-active')) button.click();
    return true;
  })()`);
  if (!boardButton) throw new Error('Project board toggle was unavailable during small-window audit');
  await waitFor(workbench, `Boolean(document.querySelector('.project-board'))`);
  const projectMetrics = await collectLayoutMetrics(workbench);
  assertPageLayout(`Project ${width}x${height}`, projectMetrics);
  if ((projectMetrics.projectBoardScrollWidth ?? 0) <= (projectMetrics.projectBoardClientWidth ?? 0)) {
    throw new Error(`Project ${width}x${height}: board must own its horizontal rail: ${JSON.stringify(projectMetrics)}`);
  }
  acceptanceMetrics.push({ surface: 'project-board', width, height, ...projectMetrics });
  await capture(workbench, `project-board-dark-${width}x${height}.png`);

  if (width === 960) {
    await selectNavigation(workbench, '专注', '.focus-surface');
    const focusMetrics = await collectLayoutMetrics(workbench);
    assertPageLayout('Focus 960x600', focusMetrics);
    acceptanceMetrics.push({ surface: 'focus', width, height, ...focusMetrics });
    await capture(workbench, 'focus-dark-960x600.png');
  }
}
await setViewport(workbench, 1600, 900, acceptanceScale);

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
  [1440, 900, 'today-dark-1440x900.png']
]) {
  await call(workbench, 'Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: hostScale, mobile: false });
  const metrics = await evaluate(workbench, `({ width: innerWidth, height: innerHeight, scale: devicePixelRatio })`);
  if (metrics.width !== width || metrics.height !== height) {
    throw new Error(`Viewport emulation failed: expected ${width}x${height}, got ${JSON.stringify(metrics)}`);
  }
  await capture(workbench, file);
}

// Wider core-surface matrix: the narrow acceptance cases above prove the
// containment thresholds; these captures guard hierarchy and density at the
// common desktop widths where most users will live.
for (const [width, height] of [[1280, 720], [1440, 900]]) {
  await setViewport(workbench, width, height, hostScale);
  await selectNavigation(workbench, '日程', '.plan-page');
  const planMetrics = await collectLayoutMetrics(workbench);
  assertPageLayout(`Plan ${width}x${height}`, planMetrics);
  acceptanceMetrics.push({ surface: 'plan', width, height, ...planMetrics });
  await capture(workbench, `plan-dark-${width}x${height}.png`);

  await evaluate(workbench, `([...document.querySelectorAll('.project-item')].find((entry) => entry.textContent?.includes('Research')))?.click()`);
  await waitFor(workbench, `Boolean(document.querySelector('.project-page'))`);
  await evaluate(workbench, `(() => {
    const button = [...document.querySelectorAll('.project-view-switch button')].find((entry) => entry.textContent?.includes('看板'));
    if (button instanceof HTMLButtonElement && !button.classList.contains('is-active')) button.click();
  })()`);
  await waitFor(workbench, `Boolean(document.querySelector('.project-board'))`);
  const projectMetrics = await collectLayoutMetrics(workbench);
  assertPageLayout(`Project ${width}x${height}`, projectMetrics);
  acceptanceMetrics.push({ surface: 'project-board', width, height, ...projectMetrics });
  await capture(workbench, `project-board-dark-${width}x${height}.png`);
}

await setViewport(workbench, 960, 600, hostScale);
await evaluate(workbench, `window.eyeProtect.saveSettings({ theme: 'light' })`);
await waitFor(workbench, `document.documentElement.dataset.theme === 'light'`);
await selectNavigation(workbench, '今天', '.today-page');
await capture(workbench, 'today-light-960x600.png');
await evaluate(workbench, `window.eyeProtect.saveSettings({ theme: 'dark' })`);
await waitFor(workbench, `document.documentElement.dataset.theme === 'dark'`);

console.log(`Workbench layout metrics:\n${JSON.stringify(acceptanceMetrics, null, 2)}`);
writeFileSync(resolve(outputDir, 'layout-metrics.json'), `${JSON.stringify(acceptanceMetrics, null, 2)}\n`, 'utf8');

await call(workbench, 'Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: hostScale, mobile: false });
await evaluate(workbench, `window.eyeProtect.saveSettings({ theme: 'system' })`);
// Emulated media features live on the CDP session that sets them. One
// persistent session spans every set → audit → capture step below; closing
// it reverts the emulation automatically (USERPLAN 1.2 PR0 theme audit).
const mediaSession = await openSession(workbench);
try {
  await mediaSession.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await waitFor(workbench, `document.documentElement.dataset.theme === 'system'`);
  await auditComputedTheme(workbench, 'dark', [
    ['system app shell', '.workbench-v2'],
    ['system selected navigation', '.app-nav-item.is-active']
  ]);
  await capture(workbench, 'today-system-dark.png');
  await mediaSession.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await auditComputedTheme(workbench, 'light', [
    ['system app shell', '.workbench-v2'],
    ['system selected navigation', '.app-nav-item.is-active']
  ]);
  await capture(workbench, 'today-system-light.png');
  await mediaSession.call('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
  await capture(workbench, 'today-forced-colors.png');
  await mediaSession.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await capture(workbench, 'today-reduced-motion.png');
  await mediaSession.call('Emulation.setEmulatedMedia', { features: [] });
} finally {
  mediaSession.close();
}
await evaluate(workbench, `window.eyeProtect.saveSettings({ theme: 'dark', reminderMode: 'guided' })`);
await waitFor(workbench, `document.documentElement.dataset.theme === 'dark'`);
await waitFor(pet, `document.documentElement.dataset.theme === 'dark'`);
await capture(pet, 'pet-dark.png');
await evaluate(pet, `window.eyeProtect.testReminder('combined')`);
const alert = await waitForTarget(endpoint, '#alert');
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
await waitForTargetGone(endpoint, '#alert');
await evaluate(workbench, `window.eyeProtect.saveSettings({ theme: 'light', reminderMode: 'guided' })`);
await waitFor(pet, `document.documentElement.dataset.theme === 'light'`);
await capture(pet, 'pet-light.png');
await evaluate(pet, `window.eyeProtect.testReminder('eye')`);
const lightAlert = await waitForTarget(endpoint, '#alert');
await waitFor(lightAlert, `Boolean(document.querySelector('.alert-panel'))`);
await capture(lightAlert, 'reminder-light.png');
const lightSkipped = await evaluate(lightAlert, `(() => {
  const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent?.includes('跳过'));
  if (!(button instanceof HTMLButtonElement)) return false;
  setTimeout(() => button.click(), 0);
  return true;
})()`);
if (!lightSkipped) throw new Error('Light reminder skip action was not available');
await waitForTargetGone(endpoint, '#alert');

await evaluate(workbench, `window.eyeProtect.saveSettings({ theme: 'dark', reminderMode: 'gentle' })`);
await waitFor(pet, `document.documentElement.dataset.theme === 'dark'`);
await evaluate(pet, `window.eyeProtect.testReminder('walk')`);
const bubble = await waitForTarget(endpoint, '#bubble');
await waitFor(bubble, `Boolean(document.querySelector('.bubble-card .bubble-actions'))`);
await waitFor(bubble, `document.documentElement.dataset.theme === 'dark'`);
await auditComputedTheme(bubble, 'dark', [
  ['bubble panel', '.bubble-card'],
  ['bubble secondary action', '.bubble-actions button:last-child']
]);
await capture(bubble, 'bubble-dark.png');
const bubbleSkipped = await evaluate(bubble, `(() => {
  const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent?.includes('跳过'));
  if (!(button instanceof HTMLButtonElement)) return false;
  setTimeout(() => button.click(), 0);
  return true;
})()`);
if (!bubbleSkipped) throw new Error('Dark bubble skip action was not available');
await waitFor(bubble, `!document.querySelector('.bubble-actions')`);

await evaluate(workbench, `window.eyeProtect.saveSettings({ theme: 'light', reminderMode: 'gentle' })`);
await waitFor(pet, `document.documentElement.dataset.theme === 'light'`);
await evaluate(pet, `window.eyeProtect.testReminder('eye')`);
const lightBubble = await waitForTarget(endpoint, '#bubble');
await waitFor(lightBubble, `Boolean(document.querySelector('.bubble-card .bubble-actions'))`);
await waitFor(lightBubble, `document.documentElement.dataset.theme === 'light'`);
await auditComputedTheme(lightBubble, 'light', [
  ['bubble panel', '.bubble-card'],
  ['bubble secondary action', '.bubble-actions button:last-child']
]);
await capture(lightBubble, 'bubble-light.png');
const lightBubbleSkipped = await evaluate(lightBubble, `(() => {
  const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent?.includes('跳过'));
  if (!(button instanceof HTMLButtonElement)) return false;
  setTimeout(() => button.click(), 0);
  return true;
})()`);
if (!lightBubbleSkipped) throw new Error('Light bubble skip action was not available');
await evaluate(workbench, `window.eyeProtect.saveSettings({ theme: 'dark', reminderMode: 'guided' })`);
await evaluate(pet, `(async () => {
  const projects = await window.eyeProtect.createProject({ name: '这是一个用于验证超长中文项目名称不会挤压导航和任务内容区域的研究计划', color: '#4e6f91' });
  const project = projects.find((entry) => entry.name.startsWith('这是一个用于验证超长中文项目'));
  const tasks = await window.eyeProtect.createTask({
    title: '超长中文任务标题需要稳定截断并保持操作按钮可见'.repeat(8),
    projectId: project?.id ?? null,
    plannedAt: Date.now(),
    estimateMinutes: 30
  });
  const task = tasks.find((entry) => entry.title.startsWith('超长中文任务标题需要稳定截断'));
  if (task) {
    await window.eyeProtect.upsertDailyPlan({
      taskId: task.id,
      localDate: new Date().toLocaleDateString('en-CA'),
      plannedMinutes: 30
    });
  }
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
await waitFor(workbench, `Boolean(document.querySelector('.projects-overview')) && document.querySelectorAll('.project-item:not(.project-unclassified)').length === 0`);
await capture(workbench, 'projects-empty-dark.png');

console.log(`Captured UI snapshots in ${outputDir}`);
