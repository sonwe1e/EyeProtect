import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const port = Number(process.argv[2]);
const outputDir = resolve(process.argv[3]);
const label = process.argv[4];
const expectedScale = Number(process.argv[5]);
const endpoint = `http://127.0.0.1:${port}`;
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const targets = async () => (await fetch(`${endpoint}/json`)).json();
const waitForTarget = async (hash) => {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    try {
      const target = (await targets()).find((entry) => entry.type === 'page' && entry.url.endsWith(hash));
      if (target) return target;
    } catch {
      // Process is still starting.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${hash}`);
};
const call = async (target, method, params = {}) => {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP connection failed')), { once: true });
  });
  try {
    return await new Promise((resolveCall, reject) => {
      const timeout = setTimeout(() => reject(new Error(`${method} timed out`)), 12_000);
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

mkdirSync(outputDir, { recursive: true });
const pet = await waitForTarget('#pet');
await evaluate(pet, `(async () => {
  await window.eyeProtect.saveSettings({ theme: 'dark' });
  await window.eyeProtect.createTask({ title: 'DPI ${label} 验收任务', plannedAt: Date.now(), estimateMinutes: 30 });
  await window.eyeProtect.openWorkbench('today');
})()`);
const workbench = await waitForTarget('#workbench');
let snapshot;
for (let attempt = 0; attempt < 120; attempt += 1) {
  snapshot = await evaluate(workbench, `(() => ({
    ready: Boolean(document.querySelector('.today-page .task-row')),
    scale: devicePixelRatio,
    width: innerWidth,
    height: innerHeight
  }))()`);
  if (snapshot.ready) break;
  await delay(100);
}
if (!snapshot?.ready) throw new Error(`DPI renderer did not become ready: ${JSON.stringify(snapshot)}`);
if (Math.abs(snapshot.scale - expectedScale) > 0.02) {
  throw new Error(`Expected device scale ${expectedScale}, got ${snapshot.scale}`);
}
const result = await call(workbench, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
writeFileSync(resolve(outputDir, `today-dark-scale-${label}.png`), Buffer.from(result.data, 'base64'));
console.log(`Captured ${label}% scale at ${snapshot.width}x${snapshot.height}, devicePixelRatio=${snapshot.scale}`);
