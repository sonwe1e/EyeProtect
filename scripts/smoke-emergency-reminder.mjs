const port = Number(process.argv[2] ?? 9334);
const endpoint = `http://127.0.0.1:${port}`;
import { delay, listTargets, waitForTarget } from './lib/cdp.mjs';
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

const pet = await waitForTarget(endpoint, (target) => target.url.endsWith('#pet'), 'pet renderer');
const active = await evaluate(pet, `(async () => {
  await window.eyeProtect.saveSettings({ reminderMode: 'guided' });
  await window.eyeProtect.testReminder('eye');
  return (await window.eyeProtect.getReminderStatus()).activeReminder;
})()`);
if (!active?.id) throw new Error(`Test reminder did not start: ${JSON.stringify(active)}`);

const emergency = await waitForTarget(endpoint, (target) => target.url.startsWith('data:text/html'),
  'emergency reminder'
);
await delay(Math.max(0, Number(active.unlockAt) - Date.now()) + 150);
const clicked = await evaluate(emergency, `(() => {
  const button = document.querySelector('#complete');
  if (!button) return false;
  button.click();
  return true;
})()`);
if (!clicked) throw new Error('Emergency Complete button was not found');

const deadline = Date.now() + 10_000;
let status;
while (Date.now() < deadline) {
  status = await evaluate(pet, 'window.eyeProtect.getReminderStatus()');
  if (!status?.activeReminder) break;
  await delay(100);
}
if (status?.activeReminder) {
  throw new Error(`Emergency action did not clear active reminder: ${JSON.stringify(status)}`);
}

console.log(JSON.stringify({ emergencyVisible: true, completeClearedReminder: true }, null, 2));
