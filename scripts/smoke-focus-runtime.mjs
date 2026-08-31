import { delay, evaluate, waitFor, waitForTarget } from './lib/cdp.mjs';

const port = Number(process.argv[2] ?? 9333);
const endpoint = `http://127.0.0.1:${port}`;
const pet = await waitForTarget(endpoint, '#pet');
await waitFor(pet, `Boolean(window.eyeProtect?.startFocus && window.eyeProtect?.getTaskWorkSummary)`);

const fixture = await evaluate(pet, `(async () => {
  const focus = await window.eyeProtect.getFocusStatus();
  if (focus.session) await window.eyeProtect.pauseFocus();
  await window.eyeProtect.setActiveTask(null);
  let tasks = await window.eyeProtect.createTask({ title: 'FOCUS_RUNTIME_A' });
  tasks = await window.eyeProtect.createTask({ title: 'FOCUS_RUNTIME_B' });
  const a = tasks.find((task) => task.title === 'FOCUS_RUNTIME_A');
  const b = tasks.find((task) => task.title === 'FOCUS_RUNTIME_B');
  if (!a || !b) throw new Error('Focus runtime fixture failed');
  await window.eyeProtect.startFocus(a.id);
  return { a: a.id, b: b.id };
})()`);

await delay(2_200);
const running = await evaluate(pet, `window.eyeProtect.getTaskWorkSummary()`);
if (running.taskId !== fixture.a || !running.tracking || running.currentSessionMs < 1_800) {
  throw new Error(`Focus did not start the tracker from an empty active task: ${JSON.stringify(running)}`);
}

await evaluate(pet, `window.eyeProtect.startFocus(${JSON.stringify(fixture.b)})`);
await delay(1_200);
await evaluate(pet, `window.eyeProtect.startFocus(${JSON.stringify(fixture.a)})`);
const persistedA = await evaluate(pet, `window.eyeProtect.getTaskWorkSummary()`);
await evaluate(pet, `window.eyeProtect.startFocus(${JSON.stringify(fixture.b)})`);
const persistedB = await evaluate(pet, `window.eyeProtect.getTaskWorkSummary()`);
await evaluate(pet, `window.eyeProtect.pauseFocus()`);
const paused = await evaluate(pet, `window.eyeProtect.getTaskWorkSummary()`);
if (paused.tracking || paused.taskId !== null) {
  throw new Error(`Pausing focus left the tracker running: ${JSON.stringify(paused)}`);
}

if (persistedA.taskActiveMs < 1_800 || persistedB.taskActiveMs < 900) {
  throw new Error(`Focus transition tails were not persisted: ${JSON.stringify({ persistedA, persistedB })}`);
}

await evaluate(pet, `(async () => {
  await window.eyeProtect.startFocus(${JSON.stringify(fixture.a)});
  await window.eyeProtect.saveSettings({ reminderMode: 'guided' });
  await window.eyeProtect.testReminder('eye');
})()`);
const onBreak = await evaluate(pet, `window.eyeProtect.getTaskWorkSummary()`);
if (onBreak.tracking) throw new Error(`Reminder did not pause work tracking: ${JSON.stringify(onBreak)}`);
const blockedSwitch = await evaluate(pet, `window.eyeProtect.startFocus(${JSON.stringify(fixture.b)})`);
if (blockedSwitch.session?.taskId !== fixture.a || !blockedSwitch.session?.onBreak) {
  throw new Error(`Focus start bypassed the health break: ${JSON.stringify(blockedSwitch)}`);
}
await delay(1_100);
const reminder = await evaluate(pet, `window.eyeProtect.getReminderStatus()`);
await evaluate(pet, `window.eyeProtect.reminderAction('skip', ${JSON.stringify(reminder.activeReminder?.id ?? '')})`);
await delay(150);
const resumed = await evaluate(pet, `window.eyeProtect.getTaskWorkSummary()`);
if (!resumed.tracking || resumed.taskId !== fixture.a) {
  throw new Error(`Ending the reminder did not resume the same task: ${JSON.stringify(resumed)}`);
}
await evaluate(pet, `window.eyeProtect.pauseFocus()`);

console.log('Focus runtime coordination persisted tails and excluded health breaks.');
