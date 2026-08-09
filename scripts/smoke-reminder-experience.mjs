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

const evaluate = async (target, expression) => {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP WebSocket failed to open')), { once: true });
  });
  try {
    const id = 1;
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CDP evaluation timed out')), 10_000);
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

const pet = await waitForTarget('#pet');
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
  actions: document.querySelectorAll('.alert-actions button').length
}))()`, (value) => value?.ready && value?.away && value?.resume)).value;
assert(alert.away === '去打印室打印材料', 'walk reminder did not fold in the away task', alert);
assert(alert.resume === '修改论文', 'break did not preserve the active task', alert);
assert(alert.actions === 3, 'reminder actions are incomplete', alert);

await evaluate(pet, `(async () => {
  const active = (await window.eyeProtect.getReminderStatus()).activeReminder;
  if (active) await window.eyeProtect.reminderAction('skip', active.id);
  await window.eyeProtect.openQuickTodo();
})()`);
const panel = (await waitForValue('#panel', `(() => ({
  ready: Boolean(document.querySelector('.quick-panel-shell')),
  tasks: document.querySelectorAll('.quick-task-list li').length,
  workbench: Boolean(document.querySelector('.quick-open-workbench'))
}))()`, (value) => value?.ready)).value;
assert(panel.tasks >= 1 && panel.workbench, 'quick panel contract failed', panel);

await evaluate(pet, `window.eyeProtect.openWorkbench('reminders')`);
const workbench = (await waitForValue('#workbench', `(() => ({
  ready: Boolean(document.querySelector('.standalone-reminders')),
  shell: Boolean(document.querySelector('.workbench-shell'))
}))()`, (value) => value?.ready)).value;
assert(workbench.shell, 'Workbench reminder page failed', workbench);

console.log(JSON.stringify({ setup, alert, panel, workbench }, null, 2));
