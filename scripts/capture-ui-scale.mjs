import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const port = Number(process.argv[2]);
const outputDir = resolve(process.argv[3]);
const label = process.argv[4];
const expectedScale = Number(process.argv[5]);
const endpoint = `http://127.0.0.1:${port}`;
import { call, delay, evaluate, listTargets, waitFor, waitForTarget } from './lib/cdp.mjs';
mkdirSync(outputDir, { recursive: true });
const pet = await waitForTarget(endpoint, '#pet');
await waitFor(pet, `Boolean(window.eyeProtect) && ['saveSettings', 'createTask', 'upsertDailyPlan', 'openWorkbench'].every((name) => typeof window.eyeProtect[name] === 'function')`);
await evaluate(pet, `(async () => {
  await window.eyeProtect.saveSettings({ theme: 'dark' });
  const tasks = await window.eyeProtect.createTask({ title: 'DPI ${label} 验收任务', plannedAt: Date.now(), estimateMinutes: 30 });
  const task = tasks.find((entry) => entry.title === 'DPI ${label} 验收任务');
  if (task) await window.eyeProtect.upsertDailyPlan({ taskId: task.id, localDate: new Date().toLocaleDateString('en-CA'), plannedMinutes: 30 });
  await window.eyeProtect.openWorkbench('today');
})()`);
const workbench = await waitForTarget(endpoint, '#workbench');
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
