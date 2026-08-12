const port = Number(process.argv[2] ?? 9337);
const mode = process.argv[3] ?? 'exercise';
const endpoint = `http://127.0.0.1:${port}`;
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

if (!['exercise', 'verify'].includes(mode)) {
  throw new Error('Usage: smoke-plan-interactions.mjs <port> <exercise|verify>');
}

const listTargets = async () => {
  const response = await fetch(`${endpoint}/json`);
  if (!response.ok) throw new Error(`CDP target list returned HTTP ${response.status}`);
  return response.json();
};

const waitForTarget = async (hash, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const target = (await listTargets()).find((candidate) => candidate.type === 'page' && candidate.url.endsWith(hash));
      if (target) return target;
    } catch {
      // The packaged application may still be exposing its debugging target.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${hash}`);
};

const call = async (target, method, params = {}) => {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP WebSocket failed to open')), { once: true });
  });
  try {
    return await new Promise((resolveCall, reject) => {
      const timeout = setTimeout(() => reject(new Error(`${method} timed out`)), 15_000);
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== 1) return;
        clearTimeout(timeout);
        if (message.error) reject(new Error(message.error.message));
        else resolveCall(message.result);
      });
      socket.send(JSON.stringify({ id: 1, method, params }));
    });
  } finally {
    socket.close();
  }
};

const evaluate = async (target, expression) => {
  const response = await call(target, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result?.value;
};

const waitFor = async (target, expression, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(target, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for UI state: ${expression}`);
};

const pet = await waitForTarget('#pet');
await waitFor(pet, `Boolean(window.eyeProtect?.getTasks && window.eyeProtect?.getTimeBlocks && window.eyeProtect?.openWorkbench)`);

if (mode === 'exercise') {
  await evaluate(pet, `(async () => {
    const focus = await window.eyeProtect.getFocusStatus();
    if (focus.session) await window.eyeProtect.pauseFocus();
    await window.eyeProtect.setActiveTask(null);
    for (const task of await window.eyeProtect.getTasks()) await window.eyeProtect.deleteTask(task.id);
    const tasks = await window.eyeProtect.createTask({ title: 'SMOKE_PLAN_MULTI_BLOCK', estimateMinutes: 30 });
    const task = tasks.find((entry) => entry.title === 'SMOKE_PLAN_MULTI_BLOCK');
    if (!task) throw new Error('Failed to create plan smoke fixture');
    await window.eyeProtect.upsertDailyPlan({ taskId: task.id, localDate: new Date().toLocaleDateString('en-CA'), plannedMinutes: 60 });
    await window.eyeProtect.openWorkbench('plan');
  })()`);

  const workbench = await waitForTarget('#workbench');
  await call(workbench, 'Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await waitFor(workbench, `Boolean(document.querySelector('.workbench-v2'))`);
  await evaluate(workbench, `([...document.querySelectorAll('.app-nav-item')].find((entry) => entry.textContent?.includes('今天')))?.click()`);
  await waitFor(workbench, `[...document.querySelectorAll('.task-row')].some((entry) => entry.textContent?.includes('SMOKE_PLAN_MULTI_BLOCK'))`);
  await evaluate(workbench, `([...document.querySelectorAll('.task-row')].find((entry) => entry.textContent?.includes('SMOKE_PLAN_MULTI_BLOCK'))?.querySelector('.task-priority-dot'))?.click()`);
  await waitFor(workbench, `(async () => (await window.eyeProtect.getTasks()).some((entry) => entry.title === 'SMOKE_PLAN_MULTI_BLOCK' && entry.priority === 'important'))()`);
  const priorityFeedback = await evaluate(workbench, `(() => {
    const row = [...document.querySelectorAll('.task-row')].find((entry) => entry.textContent?.includes('SMOKE_PLAN_MULTI_BLOCK'));
    return { priority: row?.querySelector('.task-priority-dot')?.getAttribute('data-priority'), successMarks: row?.querySelectorAll('.task-priority-dot .command-success-mark').length ?? -1 };
  })()`);
  if (priorityFeedback.priority !== 'important' || priorityFeedback.successMarks !== 0) {
    throw new Error(`Priority state control showed submit feedback: ${JSON.stringify(priorityFeedback)}`);
  }
  await evaluate(workbench, `([...document.querySelectorAll('.app-nav-item')].find((entry) => entry.textContent?.includes('日程')))?.click()`);
  await waitFor(workbench, `Boolean(document.querySelector('.plan-page .timeline-grid'))`);

  for (const offset of [75, 180]) {
    const dropped = await evaluate(workbench, `(() => {
      const card = [...document.querySelectorAll('.plan-task-card')].find((entry) => entry.textContent?.includes('SMOKE_PLAN_MULTI_BLOCK'));
      const grid = document.querySelector('.timeline-grid');
      if (!(card instanceof HTMLElement) || !(grid instanceof HTMLElement)) return false;
      const transfer = new DataTransfer();
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      const bounds = grid.getBoundingClientRect();
      grid.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: bounds.top + ${offset} }));
      grid.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: bounds.top + ${offset} }));
      return true;
    })()`);
    if (!dropped) throw new Error('Task → TimeBlock drag target was unavailable');
    await waitFor(workbench, `(async () => {
      const task = (await window.eyeProtect.getTasks()).find((entry) => entry.title === 'SMOKE_PLAN_MULTI_BLOCK');
      return (await window.eyeProtect.getTimeBlocks()).filter((block) => block.taskId === task?.id).length === ${offset === 75 ? 1 : 2};
    })()`);
  }

  await waitFor(workbench, `[...document.querySelectorAll('.plan-task-card')].some((entry) => entry.textContent?.includes('已排 2 块 · 60m'))`);
  const focused = await evaluate(workbench, `(() => {
    const block = [...document.querySelectorAll('.timeline-block')].find((entry) => entry.textContent?.includes('SMOKE_PLAN_MULTI_BLOCK'));
    if (!(block instanceof HTMLElement)) return false;
    block.focus();
    return document.activeElement === block;
  })()`);
  if (!focused) throw new Error('TimeBlock could not receive keyboard focus');
  await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', modifiers: 8 });
  await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', modifiers: 8 });
  await waitFor(workbench, `(async () => {
    const task = (await window.eyeProtect.getTasks()).find((entry) => entry.title === 'SMOKE_PLAN_MULTI_BLOCK');
    const durations = (await window.eyeProtect.getTimeBlocks()).filter((block) => block.taskId === task?.id).map((block) => Math.round((block.endAt - block.startAt) / 60000));
    return durations.includes(45);
  })()`);

  const removed = await evaluate(workbench, `(() => {
    const blocks = [...document.querySelectorAll('.timeline-block')].filter((entry) => entry.textContent?.includes('SMOKE_PLAN_MULTI_BLOCK'));
    const backlog = document.querySelector('.plan-backlog');
    const block = blocks[1];
    if (!(block instanceof HTMLElement) || !(backlog instanceof HTMLElement)) return false;
    const transfer = new DataTransfer();
    block.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    backlog.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    backlog.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    return true;
  })()`);
  if (!removed) throw new Error('TimeBlock → backlog drag target was unavailable');
  await waitFor(workbench, `(async () => {
    const task = (await window.eyeProtect.getTasks()).find((entry) => entry.title === 'SMOKE_PLAN_MULTI_BLOCK');
    const blocks = (await window.eyeProtect.getTimeBlocks()).filter((block) => block.taskId === task?.id);
    return Boolean(task && blocks.length === 1 && Math.round((blocks[0].endAt - blocks[0].startAt) / 60000) === 45);
  })()`);
  await waitFor(workbench, `[...document.querySelectorAll('.plan-task-card')].some((entry) => entry.textContent?.includes('已排 1 块 · 45m'))`);
  console.log('Plan in/out, multi-block and resize interactions persisted successfully');
} else {
  await evaluate(pet, `window.eyeProtect.openWorkbench('plan')`);
  const workbench = await waitForTarget('#workbench');
  await waitFor(workbench, `Boolean(document.querySelector('.workbench-v2'))`);
  await evaluate(workbench, `([...document.querySelectorAll('.app-nav-item')].find((entry) => entry.textContent?.includes('日程')))?.click()`);
  await waitFor(workbench, `Boolean(document.querySelector('.plan-page .timeline-grid'))`);
  const persisted = await evaluate(workbench, `(async () => {
    const task = (await window.eyeProtect.getTasks()).find((entry) => entry.title === 'SMOKE_PLAN_MULTI_BLOCK');
    const blocks = (await window.eyeProtect.getTimeBlocks()).filter((block) => block.taskId === task?.id);
    return {
      taskExists: Boolean(task),
      priority: task?.priority ?? null,
      blockCount: blocks.length,
      duration: blocks[0] ? Math.round((blocks[0].endAt - blocks[0].startAt) / 60000) : null,
      cardVisible: [...document.querySelectorAll('.plan-task-card')].some((entry) => entry.textContent?.includes('已排 1 块 · 45m')),
      blockVisible: [...document.querySelectorAll('.timeline-block')].some((entry) => entry.textContent?.includes('SMOKE_PLAN_MULTI_BLOCK'))
    };
  })()`);
  if (!persisted.taskExists || persisted.priority !== 'important' || persisted.blockCount !== 1 || persisted.duration !== 45 || !persisted.cardVisible || !persisted.blockVisible) {
    throw new Error(`Plan state did not survive restart: ${JSON.stringify(persisted)}`);
  }
  console.log('Plan interaction state survived packaged restart');
}
