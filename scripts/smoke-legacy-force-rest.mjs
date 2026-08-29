import assert from 'node:assert/strict';

const [, , portArg, phase = 'exercise'] = process.argv;
const port = Number(portArg);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('usage: node scripts/smoke-legacy-force-rest.mjs PORT [exercise|verify]');
}
if (phase !== 'exercise' && phase !== 'verify') {
  throw new Error(`unknown phase: ${phase}`);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForTarget = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      const targets = await response.json();
      const pet = targets.find((target) => target.url.endsWith('#pet'));
      if (pet?.webSocketDebuggerUrl) return pet;
    } catch {}
    await delay(250);
  }
  throw new Error('pet CDP target not found');
};

const pet = await waitForTarget();
const socket = new WebSocket(pet.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
});

const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

const evaluate = async (body) => {
  const result = await call('Runtime.evaluate', {
    expression: `(async () => { ${body} })()`,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
};

const waitForValue = async (body, predicate, label, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(body);
    if (predicate(value)) return value;
    await delay(100);
  }
  throw new Error(`timed out waiting for ${label}`);
};

await call('Runtime.enable');

try {
  if (phase === 'verify') {
    const persisted = await evaluate(`
      const [settings, runtime] = await Promise.all([
        window.eyeProtect.getSettings(),
        window.eyeProtect.getRuntimeInfo()
      ]);
      return { forceRest: settings.forceRest, dataDir: runtime.dataDir };
    `);
    assert.equal(persisted.forceRest, true);
    assert.match(persisted.dataDir, /data-legacy-v0\.3$/i);
    console.log(JSON.stringify({ phase, persisted }));
    process.exitCode = 0;
  } else {
    await evaluate(`
      await window.eyeProtect.saveSettings({ forceRest: true, dimDesktop: false });
      await window.eyeProtect.testReminder('walk');
      return true;
    `);

    await waitForValue(
      `return document.querySelector('.force-rest-clicks')?.textContent ?? '';`,
      (value) => value.includes('0 / 30'),
      'walk force-rest hint'
    );

    for (let click = 0; click < 29; click += 1) {
      await evaluate(`
        document.querySelector('.reminder-artwork')?.click();
        return true;
      `);
      await delay(10);
    }

    const atTwentyNine = await evaluate(`
      return {
        hint: document.querySelector('.force-rest-clicks')?.textContent ?? '',
        disabled: [...document.querySelectorAll('.alert-actions button')]
          .map((button) => button.disabled)
      };
    `);
    assert.match(atTwentyNine.hint, /29\s*\/\s*30/);
    assert.deepEqual(atTwentyNine.disabled, [true, true, true]);

    await evaluate(`
      document.querySelector('.reminder-artwork')?.click();
      return true;
    `);
    const atThirty = await waitForValue(
      `
        return {
          hintVisible: Boolean(document.querySelector('.force-rest-hint')),
          disabled: [...document.querySelectorAll('.alert-actions button')]
            .map((button) => button.disabled)
        };
      `,
      (value) => value.hintVisible === false,
      '30-click unlock'
    );
    assert.deepEqual(atThirty.disabled, [false, false, false]);

    await evaluate(`
      document.querySelector('.alert-actions button.primary')?.click();
      return true;
    `);
    await waitForValue(
      `return (await window.eyeProtect.getReminderStatus()).activeReminder;`,
      (value) => value === null,
      'walk reminder completion'
    );

    await evaluate(`
      await window.eyeProtect.testReminder('eye');
      return true;
    `);
    const initiallyLocked = await waitForValue(
      `
        return [...document.querySelectorAll('.alert-actions button')]
          .map((button) => button.disabled);
      `,
      (value) => value.length === 3,
      'eye reminder actions'
    );
    assert.deepEqual(initiallyLocked, [true, true, true]);
    await delay(31_000);
    const afterCountdown = await evaluate(`
      return [...document.querySelectorAll('.alert-actions button')]
        .map((button) => button.disabled);
    `);
    assert.deepEqual(afterCountdown, [false, false, false]);

    const runtime = await evaluate(`
      const [settings, info] = await Promise.all([
        window.eyeProtect.getSettings(),
        window.eyeProtect.getRuntimeInfo()
      ]);
      return { forceRest: settings.forceRest, dataDir: info.dataDir };
    `);
    assert.equal(runtime.forceRest, true);
    assert.match(runtime.dataDir, /data-legacy-v0\.3$/i);
    console.log(JSON.stringify({
      phase,
      atTwentyNine,
      atThirty,
      afterCountdown,
      runtime
    }));
  }
} finally {
  socket.close();
}
