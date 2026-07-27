const port = Number(process.argv[2] ?? 9333);
const endpoint = `http://127.0.0.1:${port}`;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const listTargets = async () => {
  const response = await fetch(`${endpoint}/json`);
  if (!response.ok) {
    throw new Error(`CDP target list returned HTTP ${response.status}`);
  }
  return response.json();
};

const waitForTarget = async (hash, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const target = (await listTargets()).find(
      (candidate) => candidate.type === 'page' && candidate.url.endsWith(hash)
    );
    if (target) {
      return target;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for the ${hash} renderer`);
};

const evaluate = async (target, expression) => {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP WebSocket failed to open')), {
      once: true
    });
  });

  try {
    const id = 1;
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CDP evaluation timed out')), 10_000);
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== id) {
          return;
        }
        clearTimeout(timeout);
        if (message.error) {
          reject(new Error(message.error.message));
        } else {
          resolve(message.result);
        }
      });
      socket.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: {
            expression,
            awaitPromise: true,
            returnByValue: true
          }
        })
      );
    });

    if (response.exceptionDetails) {
      const description =
        response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        'unknown renderer exception';
      throw new Error(description);
    }
    return response.result?.value;
  } finally {
    socket.close();
  }
};

const waitForValue = async (hash, expression, predicate, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const target = await waitForTarget(hash, Math.min(1_000, timeoutMs));
      last = await evaluate(target, expression);
      if (predicate(last)) {
        return { target, value: last };
      }
    } catch {
      // A short-lived window may be destroyed between target discovery and
      // evaluation; retry until the overall deadline.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${hash}: ${JSON.stringify(last)}`);
};

const assert = (condition, message, detail) => {
  if (!condition) {
    throw new Error(`${message}: ${JSON.stringify(detail)}`);
  }
};

const petTarget = await waitForTarget('#pet');
await evaluate(
  petTarget,
  `(async () => {
    await window.eyeProtect.closeSettings();
    let todos = await window.eyeProtect.getTodos();
    for (const todo of todos) {
      await window.eyeProtect.removeTodo(todo.id);
    }
    todos = await window.eyeProtect.addTodo('接水并拿快递');
    await window.eyeProtect.setTodoBreakReminder(todos[0].id, true);
    await window.eyeProtect.saveSettings({
      reminderMode: 'gentle',
      eyeIntervalMinutes: 20,
      walkIntervalMinutes: 60,
      preAlertSeconds: 30
    });
    await window.eyeProtect.testReminder('walk');
  })()`
);

const gentleReady = await waitForValue(
  '#bubble',
  `(async () => ({
    ready: Boolean(document.querySelector('.bubble-reminder')),
    width: window.innerWidth,
    height: window.innerHeight,
    guideCount: document.querySelectorAll('.activity-guide').length,
    todo: document.querySelector('.bubble-break-todo span')?.textContent,
    actions: document.querySelectorAll('.bubble-actions button').length
  }))()`,
  (value) => value?.ready
);
const gentle = gentleReady.value;
assert(gentle.width >= 300 && gentle.height >= 224, 'gentle bubble did not expand', gentle);
assert(gentle.guideCount === 1, 'gentle bubble lost its activity guide', gentle);
assert(gentle.todo?.includes('接水并拿快递'), 'gentle bubble lost its walk todo', gentle);
assert(gentle.actions === 3, 'gentle bubble actions are incomplete', gentle);

await evaluate(
  petTarget,
  `document.querySelector('.pet-character')?.dispatchEvent(
    new MouseEvent('dblclick', { bubbles: true })
  )`
);
await waitForValue(
  '#pet',
  `window.eyeProtect.getReminderStatus()`,
  (value) => value?.activeReminder === null
);

await evaluate(
  petTarget,
  `(async () => {
    await window.eyeProtect.saveSettings({ reminderMode: 'guided' });
    await window.eyeProtect.testReminder('combined');
  })()`
);
const guidedReady = await waitForValue(
  '#alert',
  `(() => {
    const panel = document.querySelector('.alert-panel');
    const actions = document.querySelector('.alert-actions');
    const panelRect = panel?.getBoundingClientRect();
    const actionsRect = actions?.getBoundingClientRect();
    return {
      ready: Boolean(document.querySelector('.alert-guided-hint')),
      guideCount: document.querySelectorAll('.activity-guide').length,
      todo: document.querySelector('.break-todo-card strong')?.textContent,
      completeDisabled: document.querySelector('.alert-actions .primary')?.disabled,
      panelScrollHeight: panel?.scrollHeight,
      panelClientHeight: panel?.clientHeight,
      actionsVisible:
        Boolean(panelRect && actionsRect) &&
        actionsRect.bottom <= panelRect.bottom + 1 &&
        actionsRect.top >= panelRect.top - 1
    };
  })()`,
  (value) => value?.ready
);
const guided = guidedReady.value;
assert(guided.guideCount === 2, 'combined guided alert must show one guide per kind', guided);
assert(guided.todo === '接水并拿快递', 'guided alert lost its walk todo', guided);
assert(guided.completeDisabled === false, 'guided mode incorrectly locks complete', guided);
assert(guided.actionsVisible, 'guided actions are clipped below the panel', guided);

await evaluate(
  petTarget,
  `(async () => {
    const active = (await window.eyeProtect.getReminderStatus()).activeReminder;
    if (active) await window.eyeProtect.reminderAction('skip', active.id);
  })()`
);

await evaluate(
  petTarget,
  `(async () => {
    await window.eyeProtect.saveSettings({ reminderMode: 'focused' });
    await window.eyeProtect.testReminder('eye');
  })()`
);
const focusedReady = await waitForValue(
  '#alert',
  `(() => ({
    ready: Boolean(document.querySelector('.alert-wait-hint')),
    completeDisabled: document.querySelector('.alert-actions .primary')?.disabled,
    artworkHint: document.querySelector('.reminder-artwork')?.getAttribute('title')
  }))()`,
  (value) => value?.ready
);
const focused = focusedReady.value;
assert(focused.completeDisabled === true, 'focused mode failed to lock complete', focused);
assert(focused.artworkHint?.includes('倒计时'), 'focused artwork gives a false double-click hint', focused);
await evaluate(
  petTarget,
  `(async () => {
    const active = (await window.eyeProtect.getReminderStatus()).activeReminder;
    if (active) await window.eyeProtect.reminderAction('skip', active.id);
  })()`
);

await evaluate(
  petTarget,
  `window.eyeProtect.saveSettings({
    reminderMode: 'guided',
    eyeIntervalMinutes: 1,
    walkIntervalMinutes: 240,
    preAlertSeconds: 120
  })`
);
const preAlertReady = await waitForValue(
  '#bubble',
  `(() => ({
    ready: Boolean(document.querySelector('.bubble-prealert')),
    width: window.innerWidth,
    height: window.innerHeight,
    actions: [...document.querySelectorAll('.bubble-actions button')].map(
      (button) => button.textContent?.trim()
    )
  }))()`,
  (value) => value?.ready
);
const preAlert = preAlertReady.value;
assert(preAlert.width >= 300 && preAlert.height >= 172, 'pre-alert bubble is cramped', preAlert);
assert(
  preAlert.actions.join('|').includes('现在休息') &&
    preAlert.actions.join('|').includes('+2 分钟') &&
    preAlert.actions.join('|').includes('按原计划'),
  'pre-alert actions are incomplete',
  preAlert
);
await evaluate(petTarget, `window.eyeProtect.preAlertAction('start')`);
await waitForValue(
  '#alert',
  `document.querySelector('.alert-actions .primary')?.disabled === false`,
  (value) => value === true
);
await evaluate(
  petTarget,
  `(async () => {
    const active = (await window.eyeProtect.getReminderStatus()).activeReminder;
    if (active) await window.eyeProtect.reminderAction('complete', active.id);
  })()`
);
const historyReady = await waitForValue(
  '#pet',
  `(async () => {
    const report = await window.eyeProtect.getWeeklyReport();
    const care = await window.eyeProtect.getCareStatus();
    return {
      complete: report.current.complete,
      careScore: care.score,
      completedToday: care.completedToday,
      mood: care.mood,
      badge: document.querySelector('.pet-care-badge span')?.textContent,
      exportJson: typeof window.eyeProtect.exportReminderHistory === 'function',
      clear: typeof window.eyeProtect.clearReminderHistory === 'function'
    };
  })()`,
  (value) => value?.complete >= 1 && value?.completedToday >= 1
);
const history = historyReady.value;
assert(history.careScore >= 60, 'real completion did not improve care score', history);
assert(history.badge === String(history.careScore), 'pet care badge did not refresh', history);
assert(history.exportJson && history.clear, 'history privacy controls are missing', history);

await evaluate(petTarget, `window.eyeProtect.openQuickTodo()`);
const panelReady = await waitForValue(
  '#panel',
  `(() => ({
    ready: Boolean(document.querySelector('.todo-break-toggle')),
    pressed: document.querySelector('.todo-break-toggle')?.getAttribute('aria-pressed'),
    label: document.querySelector('.todo-break-toggle span')?.textContent,
    composerFocused: document.activeElement?.matches('.todo-compose input')
  }))()`,
  (value) => value?.ready
);
const panel = panelReady.value;
assert(panel.pressed === 'true' && panel.label === '走动时', 'todo break toggle lost state', panel);
assert(panel.composerFocused === true, 'quick-add shortcut did not focus the todo composer', panel);

await evaluate(
  petTarget,
  `(async () => {
    await window.eyeProtect.closePanel();
    await window.eyeProtect.openSettings();
  })()`
);
const reportUiReady = await waitForValue(
  '#settings',
  `(async () => ({
    ready: Boolean(document.querySelector('.history-stats')),
    completed: document.querySelector('.history-stats > div:first-child strong')?.textContent,
    care: document.querySelector('.care-score-ring strong')?.textContent,
    exports: document.querySelectorAll('.history-controls button').length,
    backupActions: document.querySelectorAll('.data-actions button').length,
    customPause: document.querySelector('.custom-pause input')?.value,
    recovery: await window.eyeProtect.getDataRecoveryInfo(),
    backupApi: [
      typeof window.eyeProtect.exportBackup,
      typeof window.eyeProtect.importBackup,
      typeof window.eyeProtect.resetToDefaults,
      typeof window.eyeProtect.openDataDirectory
    ]
  }))()`,
  (value) =>
    value?.ready &&
    Number(value?.completed) >= 1 &&
    value?.care === String(history.careScore)
);
const reportUi = reportUiReady.value;
assert(Number(reportUi.completed) >= 1, 'weekly report UI lost completed count', reportUi);
assert(reportUi.care === String(history.careScore), 'weekly report care score is stale', reportUi);
assert(reportUi.exports >= 3, 'weekly report export/clear controls are incomplete', reportUi);
assert(reportUi.backupActions === 4, 'backup and recovery actions are incomplete', reportUi);
assert(reportUi.customPause === '45', 'custom pause control is missing', reportUi);
assert(
  reportUi.backupApi.every((type) => type === 'function'),
  'backup IPC bridge is incomplete',
  reportUi
);
assert(Array.isArray(reportUi.recovery.corruptBackups), 'recovery entry is unavailable', reportUi);

await evaluate(
  reportUiReady.target,
  `window.eyeProtect.saveSettings({
    adaptiveEnabled: true,
    quietHoursEnabled: true,
    quietHoursStartMinutes: 1320,
    quietHoursEndMinutes: 480,
    foregroundDetectionEnabled: true,
    quietAppWhitelist: ['C:\\\\Program Files\\\\Office\\\\POWERPNT.EXE', 'zoom.exe'],
    petPositionsByLayout: { 'smoke-layout': { x: 12, y: 34 } }
  })`
);
const smartUiReady = await waitForValue(
  '#settings',
  `(async () => ({
    ready: Boolean(document.querySelector('.smart-section .adaptive-card.active')),
    adaptive: document.querySelector('.smart-section input[type="checkbox"]')?.checked,
    timeValues: [...document.querySelectorAll('.quiet-time-row input')].map((input) => input.value),
    whitelist: document.querySelector('.quiet-app-field textarea')?.value,
    triggerNow: typeof window.eyeProtect.triggerNow === 'function',
    explanation: document.querySelector('.adaptive-card small')?.textContent,
    layoutPosition: (await window.eyeProtect.getSettings()).petPositionsByLayout['smoke-layout']
  }))()`,
  (value) => value?.ready && value?.whitelist?.includes('powerpnt')
);
const smartUi = smartUiReady.value;
assert(smartUi.adaptive === true, 'adaptive switch did not persist', smartUi);
assert(
  smartUi.timeValues.join('|') === '22:00|08:00',
  'quiet-hours time controls lost their values',
  smartUi
);
assert(
  smartUi.whitelist.includes('powerpnt') && smartUi.whitelist.includes('zoom'),
  'foreground whitelist was not path-sanitized',
  smartUi
);
assert(smartUi.triggerNow, 'manual start-break API is missing', smartUi);
assert(Boolean(smartUi.explanation), 'adaptive adjustment has no explanation', smartUi);
assert(
  smartUi.layoutPosition?.x === 12 && smartUi.layoutPosition?.y === 34,
  'display-layout position map did not persist',
  smartUi
);

const hotkeys = await evaluate(
  smartUiReady.target,
  `(async () => ({
    status: await window.eyeProtect.getHotkeyStatus(),
    rows: document.querySelectorAll('.hotkey-list > div').length,
    labels: [...document.querySelectorAll('.hotkey-list small')].map((item) => item.textContent)
  }))()`
);
assert(hotkeys.status.enabled, 'global hotkeys are unexpectedly disabled', hotkeys);
assert(hotkeys.rows === 5, 'global hotkey settings list is incomplete', hotkeys);
assert(
  hotkeys.status.registered.length + hotkeys.status.conflicts.length === 5,
  'global hotkey conflicts were not fully reported',
  hotkeys
);
await evaluate(smartUiReady.target, `window.eyeProtect.saveSettings({ hotkeysEnabled: false })`);
const hotkeysOff = await waitForValue(
  '#settings',
  `window.eyeProtect.getHotkeyStatus()`,
  (value) => value?.enabled === false && value?.registered?.length === 0
);
assert(hotkeysOff.value.conflicts.length === 0, 'disabling hotkeys did not release registrations', hotkeysOff.value);

console.log(
  JSON.stringify({ gentle, guided, focused, preAlert, history, panel, reportUi, smartUi, hotkeys, hotkeysOff: hotkeysOff.value }, null, 2)
);
