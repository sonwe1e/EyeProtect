const port = Number(process.argv[2] ?? 9335);
const endpoint = `http://127.0.0.1:${port}`;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const listTargets = async () => {
  const response = await fetch(`${endpoint}/json`);
  if (!response.ok) throw new Error(`CDP target list returned HTTP ${response.status}`);
  return response.json();
};

const waitForTarget = async (predicate, label, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const target = (await listTargets()).find((candidate) => candidate.type === 'page' && predicate(candidate));
      if (target) return target;
    } catch {
      // Packaged startup is transient.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
};

let evaluationId = 0;
const evaluate = async (target, expression) => {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP WebSocket failed to open')), { once: true });
  });
  try {
    const id = ++evaluationId;
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

const workbench = await waitForTarget((target) => target.url.endsWith('#workbench'), 'workbench control surface');
await delay(1_500); // bounded pet retries must have completed by now
const targets = await listTargets();
if (targets.some((target) => target.type === 'page' && target.url.endsWith('#pet'))) {
  throw new Error('Pet fault injection unexpectedly produced a pet renderer');
}

const created = await evaluate(workbench, `(async () => {
  const runtime = await window.eyeProtect.getRuntimeInfo();
  const reminders = await window.eyeProtect.createStandaloneReminder({
    label: 'Pet-failure-smoke',
    schedule: { type: 'once', fireAt: Date.now() + 3_000 }
  });
  return { runtime, labels: reminders.map((entry) => entry.label), created: reminders.some((entry) => entry.label === 'Pet-failure-smoke') };
})()`);
if (!created?.runtime?.isPackaged || !created.created) {
  throw new Error(`Core control plane did not initialize: ${JSON.stringify(created)}`);
}

const deadline = Date.now() + 12_000;
let state;
while (Date.now() < deadline) {
  state = await evaluate(workbench, `(async () => ({
    pending: (await window.eyeProtect.getStandaloneReminders()).some((entry) => entry.label === 'Pet-failure-smoke'),
    failed: await window.eyeProtect.getFailedDeliveries()
  }))()`);
  if (!state.pending && state.failed.length === 0) break;
  await delay(200);
}
if (state?.pending || state?.failed?.length) {
  throw new Error(`Scheduler/native delivery did not survive pet failure: ${JSON.stringify(state)}`);
}

console.log('Pet renderer failure isolation smoke passed.');
