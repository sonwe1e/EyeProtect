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
const TARGET_TIMEOUT_MS = 30_000;
const FETCH_TIMEOUT_MS = 1_000;
const SOCKET_OPEN_TIMEOUT_MS = 10_000;
const CDP_CALL_TIMEOUT_MS = 10_000;

const waitForTarget = async () => {
  const deadline = Date.now() + TARGET_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      if (!response.ok) throw new Error(`CDP target request failed: ${response.status}`);
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
let nextId = 0;
const pending = new Map();
let socketFailure = null;

const rejectPending = (error) => {
  const requests = [...pending.values()];
  pending.clear();
  for (const request of requests) {
    clearTimeout(request.timer);
    request.reject(error);
  }
};

const failSocket = (message) => {
  socketFailure ??= new Error(message);
  rejectPending(socketFailure);
};

socket.addEventListener('error', () => failSocket('CDP socket error'));
socket.addEventListener('close', () => failSocket('CDP socket closed'));

await new Promise((resolve, reject) => {
  const cleanup = () => {
    clearTimeout(timer);
    socket.removeEventListener('open', handleOpen);
    socket.removeEventListener('error', handleError);
    socket.removeEventListener('close', handleClose);
  };
  const handleOpen = () => {
    cleanup();
    resolve();
  };
  const handleError = () => {
    cleanup();
    reject(new Error('CDP socket failed to open'));
  };
  const handleClose = () => {
    cleanup();
    reject(new Error('CDP socket closed before opening'));
  };
  const timer = setTimeout(() => {
    cleanup();
    socket.close();
    reject(new Error('timed out opening CDP socket'));
  }, SOCKET_OPEN_TIMEOUT_MS);
  socket.addEventListener('open', handleOpen, { once: true });
  socket.addEventListener('error', handleError, { once: true });
  socket.addEventListener('close', handleClose, { once: true });
});

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.error) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
});

const call = (method, params = {}, timeoutMs = CDP_CALL_TIMEOUT_MS) =>
  new Promise((resolve, reject) => {
    if (socketFailure) {
      reject(socketFailure);
      return;
    }
    if (socket.readyState !== WebSocket.OPEN) {
      reject(new Error(`CDP socket is not open for ${method}`));
      return;
    }
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP call timed out: ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      socket.send(JSON.stringify({ id, method, params }));
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  });

const evaluate = async (body, timeoutMs = CDP_CALL_TIMEOUT_MS) => {
  const result = await call('Runtime.evaluate', {
    expression: `(async () => { ${body} })()`,
    awaitPromise: true,
    returnByValue: true
  }, timeoutMs);
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
};

const waitForValue = async (body, predicate, label, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    let value;
    try {
      value = await evaluate(body, Math.min(CDP_CALL_TIMEOUT_MS, remainingMs));
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for ${label}`, { cause: error });
      }
      throw error;
    }
    if (predicate(value)) return value;
    await delay(Math.min(100, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`timed out waiting for ${label}`);
};

try {
  await call('Runtime.enable');

  const initial = await evaluate(`
    const [settings, runtime] = await Promise.all([
      window.eyeProtect.getSettings(),
      window.eyeProtect.getRuntimeInfo()
    ]);
    return {
      appVersion: runtime.appVersion,
      dataDir: runtime.dataDir,
      forceRest: settings.forceRest,
      snoozeMinutes: settings.snoozeMinutes
    };
  `);
  assert.equal(initial.appVersion, '0.3.0');
  assert.match(initial.dataDir, /data-legacy-v0\.3$/i);

  if (phase === 'verify') {
    assert.equal(initial.forceRest, true);
    assert.equal(initial.snoozeMinutes, 7);
    console.log(JSON.stringify({ phase, persisted: initial }));
    process.exitCode = 0;
  } else {
    assert.equal(initial.forceRest, false);
    assert.equal(initial.snoozeMinutes, 5);

    await evaluate(`
      await window.eyeProtect.saveSettings({
        forceRest: true,
        dimDesktop: false,
        snoozeMinutes: 7
      });
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
      `
        const status = await window.eyeProtect.getReminderStatus();
        return {
          activeReminder: status.activeReminder,
          characterVisible: Boolean(document.querySelector('.character-stage'))
        };
      `,
      (value) => value.activeReminder === null && value.characterVisible === true,
      'walk completion and pet restoration'
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
      return {
        appVersion: info.appVersion,
        forceRest: settings.forceRest,
        snoozeMinutes: settings.snoozeMinutes,
        dataDir: info.dataDir
      };
    `);
    assert.equal(runtime.appVersion, '0.3.0');
    assert.equal(runtime.forceRest, true);
    assert.equal(runtime.snoozeMinutes, 7);
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
