const port = Number(process.argv[2] ?? 9336);
const mode = process.argv[3] ?? 'exercise';
const endpoint = `http://127.0.0.1:${port}`;
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

if (mode !== 'exercise' && mode !== 'verify') {
  throw new Error('Usage: smoke-workbench-interactions.mjs <port> <exercise|verify>');
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
      // The packaged application can take a moment to expose CDP.
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

const openSession = async (target) => {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP WebSocket failed to open')), { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timeout);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
  return {
    call(method, params = {}) {
      const id = ++nextId;
      const promise = new Promise((resolveCall, reject) => {
        const timeout = setTimeout(() => reject(new Error(`${method} timed out`)), 15_000);
        pending.set(id, { resolve: resolveCall, reject, timeout });
      });
      socket.send(JSON.stringify({ id, method, params }));
      return promise;
    },
    close() { socket.close(); }
  };
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

const dispatchPointer = async (target, from, to) => {
  const session = await openSession(target);
  try {
    await session.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
    await session.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 12; step += 1) {
      await delay(35);
      await session.call('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: from.x + (to.x - from.x) * step / 12,
        y: from.y + (to.y - from.y) * step / 12,
        button: 'left',
        buttons: 1
      });
    }
    await delay(50);
    await session.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
  } finally {
    session.close();
  }
};

const pet = await waitForTarget('#pet');
await waitFor(pet, `Boolean(window.eyeProtect?.getTasks && window.eyeProtect?.getTimeBlocks && window.eyeProtect?.openWorkbench)`);

if (mode === 'exercise') {
  await evaluate(pet, `(async () => {
    const focus = await window.eyeProtect.getFocusStatus();
    if (focus.session) await window.eyeProtect.pauseFocus();
    await window.eyeProtect.setActiveTask(null);
    for (const task of await window.eyeProtect.getTasks()) await window.eyeProtect.deleteTask(task.id);
    for (const project of await window.eyeProtect.getProjects()) await window.eyeProtect.deleteProject(project.id);

    let tasks = await window.eyeProtect.createTask({ title: 'SMOKE_PLAN_POINTER', estimateMinutes: 60 });
    tasks = await window.eyeProtect.createTask({ title: 'SMOKE_BOARD_POINTER', estimateMinutes: 30 });
    const planTask = tasks.find((task) => task.title === 'SMOKE_PLAN_POINTER');
    const boardTask = tasks.find((task) => task.title === 'SMOKE_BOARD_POINTER');
    const projects = await window.eyeProtect.createProject({ name: 'SMOKE_PROJECT', color: '#2e6f61' });
    const project = projects.find((entry) => entry.name === 'SMOKE_PROJECT');
    if (!planTask || !boardTask || !project) throw new Error('Failed to build Workbench interaction fixture');
    await window.eyeProtect.updateTask(boardTask.id, { projectId: project.id });
    await window.eyeProtect.createProjectSection({ projectId: project.id, name: 'Doing' });
    await window.eyeProtect.createProjectSection({ projectId: project.id, name: 'Waiting' });
    await window.eyeProtect.saveSettings({ theme: 'dark', density: 'comfortable' });
    await window.eyeProtect.openWorkbench('plan');
  })()`);

  const workbench = await waitForTarget('#workbench');
  await call(workbench, 'Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await waitFor(workbench, `Boolean(document.querySelector('.workbench-v2'))`);
  await evaluate(workbench, `([...document.querySelectorAll('.app-nav-item')].find((entry) => entry.textContent?.includes('日程')))?.click()`);
  await waitFor(workbench, `Boolean(document.querySelector('.plan-layout'))`);

  const planDrag = await evaluate(workbench, `(() => {
    const source = [...document.querySelectorAll('.plan-task-card')].find((entry) => entry.textContent?.includes('SMOKE_PLAN_POINTER'))?.getBoundingClientRect();
    const target = document.querySelector('.timeline-grid')?.getBoundingClientRect();
    return source && target ? {
      from: { x: source.left + source.width / 2, y: source.top + source.height / 2 },
      to: { x: target.left + Math.min(180, target.width / 2), y: target.top + 125 }
    } : null;
  })()`);
  if (!planDrag) throw new Error('Plan pointer targets are unavailable');
  await dispatchPointer(workbench, planDrag.from, planDrag.to);
  await waitFor(workbench, `(async () => {
    const task = (await window.eyeProtect.getTasks()).find((entry) => entry.title === 'SMOKE_PLAN_POINTER');
    return Boolean(task && (await window.eyeProtect.getTimeBlocks()).some((block) => block.taskId === task.id));
  })()`);

  const resize = await evaluate(workbench, `(() => {
    const block = [...document.querySelectorAll('.timeline-block')].find((entry) => entry.textContent?.includes('SMOKE_PLAN_POINTER'));
    const handle = block?.querySelector('.timeline-block-resize')?.getBoundingClientRect();
    return handle ? {
      from: { x: handle.left + handle.width / 2, y: handle.top + handle.height / 2 },
      to: { x: handle.left + handle.width / 2, y: handle.top + handle.height / 2 + 15 }
    } : null;
  })()`);
  if (!resize) throw new Error('Plan resize target is unavailable');
  await dispatchPointer(workbench, resize.from, resize.to);
  await waitFor(workbench, `(async () => {
    const task = (await window.eyeProtect.getTasks()).find((entry) => entry.title === 'SMOKE_PLAN_POINTER');
    const block = (await window.eyeProtect.getTimeBlocks()).find((entry) => entry.taskId === task?.id);
    return Math.round((block?.endAt - block?.startAt) / 60000) === 75;
  })()`);

  const focused = await evaluate(workbench, `(() => {
    const block = [...document.querySelectorAll('.timeline-block')].find((entry) => entry.textContent?.includes('SMOKE_PLAN_POINTER'));
    if (!(block instanceof HTMLElement)) return false;
    block.focus();
    return document.activeElement === block;
  })()`);
  if (!focused) throw new Error('Timeline block could not receive keyboard focus');
  await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown' });
  await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown' });
  await waitFor(workbench, `document.activeElement?.classList.contains('timeline-block')`);
  await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', modifiers: 8 });
  await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', modifiers: 8 });
  await waitFor(workbench, `(async () => {
    const task = (await window.eyeProtect.getTasks()).find((entry) => entry.title === 'SMOKE_PLAN_POINTER');
    const block = (await window.eyeProtect.getTimeBlocks()).find((entry) => entry.taskId === task?.id);
    return Math.round((block?.endAt - block?.startAt) / 60000) === 90;
  })()`);

  await evaluate(workbench, `([...document.querySelectorAll('.project-item')].find((entry) => entry.textContent?.includes('SMOKE_PROJECT')))?.click()`);
  await waitFor(workbench, `Boolean(document.querySelector('.project-page'))`);
  await evaluate(workbench, `([...document.querySelectorAll('.project-view-switch button')].find((entry) => entry.textContent?.includes('看板')))?.click()`);
  await waitFor(workbench, `Boolean(document.querySelector('.project-board'))`);
  const boardDrag = await evaluate(workbench, `(() => {
    const source = [...document.querySelectorAll('.project-board-card')].find((entry) => entry.textContent?.includes('SMOKE_BOARD_POINTER'))?.getBoundingClientRect();
    const column = [...document.querySelectorAll('.project-board-column')].find((entry) => entry.querySelector('h2')?.textContent?.includes('Doing'))?.getBoundingClientRect();
    return source && column ? {
      from: { x: source.left + source.width / 2, y: source.top + Math.min(30, source.height / 2) },
      to: { x: column.left + column.width / 2, y: column.top + Math.min(92, column.height / 2) }
    } : null;
  })()`);
  if (!boardDrag) throw new Error('Board pointer targets are unavailable');
  await dispatchPointer(workbench, boardDrag.from, boardDrag.to);
  await waitFor(workbench, `(async () => {
    const project = (await window.eyeProtect.getProjects()).find((entry) => entry.name === 'SMOKE_PROJECT');
    const doing = project ? (await window.eyeProtect.getProjectSections(project.id)).find((entry) => entry.name === 'Doing') : null;
    const task = (await window.eyeProtect.getTasks()).find((entry) => entry.title === 'SMOKE_BOARD_POINTER');
    return Boolean(doing && task?.sectionId === doing.id);
  })()`);
  console.log('Workbench pointer and keyboard interactions persisted successfully');
} else {
  await evaluate(pet, `window.eyeProtect.openWorkbench('plan')`);
  const workbench = await waitForTarget('#workbench');
  await waitFor(workbench, `Boolean(document.querySelector('.workbench-v2'))`);
  await evaluate(workbench, `([...document.querySelectorAll('.app-nav-item')].find((entry) => entry.textContent?.includes('日程')))?.click()`);
  await waitFor(workbench, `Boolean(document.querySelector('.plan-layout'))`);
  const persisted = await evaluate(workbench, `(async () => {
    const tasks = await window.eyeProtect.getTasks();
    const planTask = tasks.find((entry) => entry.title === 'SMOKE_PLAN_POINTER');
    const boardTask = tasks.find((entry) => entry.title === 'SMOKE_BOARD_POINTER');
    const block = (await window.eyeProtect.getTimeBlocks()).find((entry) => entry.taskId === planTask?.id);
    const project = (await window.eyeProtect.getProjects()).find((entry) => entry.name === 'SMOKE_PROJECT');
    const doing = project ? (await window.eyeProtect.getProjectSections(project.id)).find((entry) => entry.name === 'Doing') : null;
    return {
      duration: block ? Math.round((block.endAt - block.startAt) / 60000) : null,
      boardSectionPersisted: Boolean(doing && boardTask?.sectionId === doing.id),
      timelineRendered: [...document.querySelectorAll('.timeline-block')].some((entry) => entry.textContent?.includes('SMOKE_PLAN_POINTER'))
    };
  })()`);
  if (persisted.duration !== 90 || !persisted.boardSectionPersisted || !persisted.timelineRendered) {
    throw new Error(`Workbench interaction state did not survive restart: ${JSON.stringify(persisted)}`);
  }
  console.log('Workbench interaction state survived packaged restart');
}
