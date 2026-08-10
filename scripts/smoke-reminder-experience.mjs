const port = Number(process.argv[2] ?? 9333);
const endpoint = `http://127.0.0.1:${port}`;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const listTargets = async () => {
  const response = await fetch(`${endpoint}/json`);
  if (!response.ok) throw new Error(`CDP target list returned HTTP ${response.status}`);
  return response.json();
};

const waitForTarget = async (hash, timeoutMs = 12_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const target = (await listTargets()).find(
        (candidate) => candidate.type === 'page' && candidate.url.endsWith(hash)
      );
      if (target) return target;
    } catch {
      // The packaged application may still be starting.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${hash}`);
};

const waitForTargetGone = async (hash, timeoutMs = 12_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const exists = (await listTargets()).some((candidate) => candidate.type === 'page' && candidate.url.endsWith(hash));
      if (!exists) return;
    } catch {
      // The debugging endpoint may briefly update while a window closes.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${hash} to close`);
};

const evaluate = async (target, expression) => {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP WebSocket failed to open')), { once: true });
  });
  try {
    const id = 1;
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`CDP evaluation timed out: ${expression.replace(/\s+/g, ' ').slice(0, 140)}`)),
        15_000
      );
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== id) return;
        clearTimeout(timeout);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      });
      socket.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true }
      }));
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    }
    return response.result?.value;
  } finally {
    socket.close();
  }
};

const waitForValue = async (hash, expression, predicate, timeoutMs = 12_000) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const target = await waitForTarget(hash, 1_000);
      last = await evaluate(target, expression);
      if (predicate(last)) return { target, value: last };
    } catch {
      // Transient window creation/destruction; retry.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${hash}: ${JSON.stringify(last)}`);
};

const assert = (condition, message, detail) => {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(detail)}`);
};

const pet = (await waitForValue('#pet', `typeof window.eyeProtect === 'object' && Boolean(document.querySelector('.pet-shell'))`, Boolean)).target;
const setup = await evaluate(pet, `(async () => {
  for (const task of await window.eyeProtect.getTasks()) await window.eyeProtect.deleteTask(task.id);
  let tasks = await window.eyeProtect.createTask({ title: '修改论文', context: 'desk', plannedAt: Date.now() });
  const desk = tasks.find((task) => task.title === '修改论文');
  tasks = await window.eyeProtect.createTask({ title: '去打印室打印材料', context: 'away', remindOnBreak: true, priority: 'urgent', plannedAt: Date.now() });
  if (desk) await window.eyeProtect.setActiveTask(desk.id);
  await window.eyeProtect.saveSettings({ reminderMode: 'guided' });
  await window.eyeProtect.testReminder('combined');
  return { deskId: desk?.id, taskCount: tasks.length };
})()`);
assert(setup.deskId && setup.taskCount === 2, 'Task Core setup failed', setup);

const alert = (await waitForValue('#alert', `(() => ({
  ready: Boolean(document.querySelector('.alert-panel')),
  away: document.querySelector('.break-todo-card strong')?.textContent,
  resume: document.querySelector('.break-return-task strong')?.textContent,
  actions: document.querySelectorAll('.alert-actions button').length,
  proceduralSvg: Boolean(document.querySelector('.reminder-stage .procedural-character svg'))
}))()`, (value) => value?.ready && value?.away && value?.resume)).value;
assert(alert.away === '去打印室打印材料', 'walk reminder did not fold in the away task', alert);
assert(alert.resume === '修改论文', 'break did not preserve the active task', alert);
assert(alert.actions === 3, 'reminder actions are incomplete', alert);
assert(alert.proceduralSvg, 'reminder choreography is not using the procedural character', alert);

const initialAlertTarget = await waitForTarget('#alert');
const skippedInitialBreak = await evaluate(initialAlertTarget, `(() => {
  const button = [...document.querySelectorAll('.alert-actions button')].find((entry) => entry.textContent?.includes('跳过'));
  if (!(button instanceof HTMLButtonElement)) return false;
  setTimeout(() => button.click(), 0);
  return true;
})()`);
assert(skippedInitialBreak, 'Reminder skip pointer path was unavailable', skippedInitialBreak);
await waitForTargetGone('#alert');
await evaluate(pet, `window.eyeProtect.openWorkbench('today')`);
const today = (await waitForValue('#workbench', `(() => ({
  ready: Boolean(document.querySelector('.workbench-v2')),
  composer: Boolean(document.querySelector('.task-composer')),
  tasks: document.querySelectorAll('.task-list .task-row').length
}))()`, (value) => value?.ready && value?.composer)).value;
assert(today.tasks >= 1, 'Workbench Today contract failed', today);

const projectTarget = await waitForTarget('#workbench');
await evaluate(projectTarget, `(() => {
  const projectNav = [...document.querySelectorAll('.app-nav-item')].find((entry) => entry.textContent?.includes('项目'));
  projectNav?.click();
})()`);
await waitForValue('#workbench', `Boolean(document.querySelector('.projects-overview'))`, Boolean);
await evaluate(projectTarget, `document.querySelector('.project-add')?.click()`);
await waitForValue('#workbench', `Boolean(document.querySelector('.ui-dialog'))`, Boolean);
await evaluate(projectTarget, `(() => {
  const input = document.querySelector('.ui-dialog input');
  if (!(input instanceof HTMLInputElement)) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, 'Smoke Project');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await waitForValue('#workbench', `(() => {
  const create = [...document.querySelectorAll('.ui-dialog button')].find((entry) => entry.textContent?.includes('创建项目'));
  if (create instanceof HTMLButtonElement && !create.disabled) { create.click(); return true; }
  return false;
})()`, Boolean);
const projectCreated = (await waitForValue('#workbench', `(() => ({
  dialogClosed: !document.querySelector('.ui-dialog'),
  projectVisible: [...document.querySelectorAll('.project-item')].some((entry) => entry.textContent?.includes('Smoke Project'))
}))()`, (value) => value?.dialogClosed && value?.projectVisible)).value;
assert(projectCreated.projectVisible, 'Project create pointer path failed', projectCreated);

await evaluate(projectTarget, `(() => {
  const inbox = [...document.querySelectorAll('.app-nav-item')].find((entry) => entry.textContent?.includes('收件箱'));
  inbox?.click();
})()`);
await waitForValue('#workbench', `Boolean(document.querySelector('[data-quick-add="true"]'))`, Boolean);
await evaluate(projectTarget, `(() => {
  const input = document.querySelector('[data-quick-add="true"]');
  if (!(input instanceof HTMLInputElement)) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, 'Smoke Journey Task');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await waitForValue('#workbench', `(() => {
  const add = [...document.querySelectorAll('.task-composer button')].find((entry) => entry.textContent?.includes('添加'));
  if (add instanceof HTMLButtonElement && !add.disabled) { add.click(); return true; }
  return false;
})()`, Boolean);
await waitForValue('#workbench', `[...document.querySelectorAll('.task-row')].some((entry) => entry.textContent?.includes('Smoke Journey Task'))`, Boolean);

await evaluate(projectTarget, `([...document.querySelectorAll('.app-nav-item')].find((entry) => entry.textContent?.includes('计划')))?.click()`);
await waitForValue('#workbench', `Boolean(document.querySelector('.plan-page'))`, Boolean);
const scheduledJourney = (await waitForValue('#workbench', `(() => {
  const card = [...document.querySelectorAll('.plan-task-card')].find((entry) => entry.textContent?.includes('Smoke Journey Task'));
  const schedule = card ? [...card.querySelectorAll('button')].find((entry) => entry.textContent?.includes('放到 09:00')) : null;
  if (schedule instanceof HTMLButtonElement && !schedule.disabled) { schedule.click(); return true; }
  return false;
})()`, Boolean)).value;
assert(scheduledJourney, 'Plan non-drag scheduling path failed', scheduledJourney);
await waitForValue('#workbench', `(async () => (await window.eyeProtect.getTasks()).some((task) => task.title === 'Smoke Journey Task' && task.plannedAt !== null))()`, Boolean);

await evaluate(projectTarget, `([...document.querySelectorAll('.app-nav-item')].find((entry) => entry.textContent?.includes('专注')))?.click()`);
await waitForValue('#workbench', `Boolean(document.querySelector('.focus-surface'))`, Boolean);
await evaluate(projectTarget, `([...document.querySelectorAll('.focus-actions button')].find((entry) => entry.textContent?.includes('暂停专注')))?.click()`);
await waitForValue('#workbench', `Boolean(document.querySelector('.focus-empty'))`, Boolean);
const focusedJourney = (await waitForValue('#workbench', `(() => {
  const candidate = [...document.querySelectorAll('.focus-candidate')].find((entry) => entry.textContent?.includes('Smoke Journey Task'));
  if (candidate instanceof HTMLButtonElement && !candidate.disabled) { candidate.click(); return true; }
  return false;
})()`, Boolean)).value;
assert(focusedJourney, 'Focus candidate pointer path failed', focusedJourney);
await waitForValue('#workbench', `document.querySelector('.focus-title')?.textContent === 'Smoke Journey Task'`, Boolean);

await evaluate(pet, `window.eyeProtect.testReminder('eye')`);
const journeyAlert = (await waitForValue('#alert', `(() => ({
  ready: Boolean(document.querySelector('.alert-panel')),
  resume: document.querySelector('.break-return-task strong')?.textContent
}))()`, (value) => value?.ready && value?.resume)).value;
assert(journeyAlert.resume === 'Smoke Journey Task', 'Focus task was not preserved into the break', journeyAlert);
const journeyAlertTarget = await waitForTarget('#alert');
await evaluate(journeyAlertTarget, `(() => {
  const button = [...document.querySelectorAll('.alert-actions button')].find((entry) => entry.textContent?.includes('跳过'));
  if (!(button instanceof HTMLButtonElement)) return false;
  setTimeout(() => button.click(), 0);
  return true;
})()`);
await waitForTargetGone('#alert');
const resumedFocus = (await waitForValue('#workbench', `(() => ({
  focus: Boolean(document.querySelector('.focus-surface')),
  title: document.querySelector('.focus-title')?.textContent
}))()`, (value) => value?.focus && value?.title)).value;
assert(resumedFocus.title === 'Smoke Journey Task', 'Focus → break → resume continuity failed', resumedFocus);

await evaluate(pet, `window.eyeProtect.openWorkbench('reminders')`);
const workbench = (await waitForValue('#workbench', `(() => ({
  ready: Boolean(document.querySelector('.standalone-reminders')),
  shell: Boolean(document.querySelector('.workbench-v2'))
}))()`, (value) => value?.ready)).value;
assert(workbench.shell, 'Workbench reminder page failed', workbench);

await evaluate(pet, `window.eyeProtect.openWorkbench('collection')`);
const collection = (await waitForValue('#workbench', `(() => ({
  ready: Boolean(document.querySelector('.collection-page')),
  character: Boolean(document.querySelector('.procedural-character svg'))
}))()`, (value) => value?.ready && value?.character)).value;
assert(collection.character, 'Character collection did not render a procedural candidate', collection);

const collectResult = (await waitForValue('#workbench', `(() => {
  const collect = [...document.querySelectorAll('.candidate-actions button')].find((entry) => entry.textContent?.includes('收下它'));
  if (collect instanceof HTMLButtonElement && !collect.disabled) { collect.click(); return { clicked: true, collected: false }; }
  return { clicked: false, collected: Boolean(document.querySelector('.character-card')) };
})()`, (value) => value?.clicked || value?.collected)).value;
if (collectResult.clicked) {
  await waitForValue('#workbench', `Boolean(document.querySelector('.character-card'))`, Boolean);
}

console.log(JSON.stringify({ setup, alert, today, projectCreated, resumedFocus, workbench, collection, collectResult }, null, 2));
