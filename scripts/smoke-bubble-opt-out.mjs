import { delay, evaluate, listTargets, waitFor, waitForTarget, waitForTargetGone } from './lib/cdp.mjs';

const port = Number(process.argv[2] ?? 9333);
const mode = process.argv[3] ?? 'exercise';
if (!['exercise', 'verify'].includes(mode)) {
  throw new Error('Usage: smoke-bubble-opt-out.mjs <port> <exercise|verify>');
}
const endpoint = `http://127.0.0.1:${port}`;
const waitForVisibleBubble = async (selector, timeoutMs = 12_000) => {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    const candidates = (await listTargets(endpoint)).filter(
      (target) => target.type === 'page' && target.url.endsWith('#bubble')
    );
    last = [];
    for (const candidate of candidates) {
      try {
        const state = await evaluate(
          candidate,
          `({
            id: ${JSON.stringify(candidate.id)},
            visibility: document.visibilityState,
            readyState: document.readyState,
            surface: document.querySelector('.bubble-shell')?.className ?? null,
            match: Boolean(document.querySelector(${JSON.stringify(selector)}))
          })`
        );
        last.push(state);
        if (state.visibility === 'visible' && state.match) return candidate;
      } catch (error) {
        // A hidden bubble can be destroyed between target listing and probing.
        last.push({ id: candidate.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for visible bubble surface ${selector}: ${JSON.stringify(last)}`);
};
const pet = await waitForTarget(endpoint, '#pet');
await waitFor(pet, `Boolean(window.eyeProtect) && typeof window.eyeProtect.saveSettings === 'function'`);

if (mode === 'exercise') {
  await evaluate(pet, `(async () => {
    await window.eyeProtect.saveSettings({ todoBubbleEnabled: true });
    await window.eyeProtect.createTask({ title: 'Bubble opt-out smoke task' });
  })()`);

  const bubble = await waitForVisibleBubble('.bubble-list');
  const hasClose = await evaluate(
    bubble,
    `document.querySelector('.bubble-close') instanceof HTMLButtonElement`
  );
  if (!hasClose) throw new Error('Todo bubble close button was unavailable');
  const clickSettled = evaluate(
    bubble,
    `document.querySelector('.bubble-close').click()`,
    1_000
  ).catch(() => null);
  await waitForTargetGone(endpoint, '#bubble');
  await clickSettled;
  const saved = await evaluate(pet, `window.eyeProtect.getSettings()`);
  if (saved.todoBubbleEnabled !== false) {
    throw new Error(`Todo bubble close did not persist opt-out: ${JSON.stringify(saved)}`);
  }
  console.log('Todo bubble close persisted the opt-out; restart before verify.');
} else {
  const original = await evaluate(pet, `window.eyeProtect.getSettings()`);
  if (original.todoBubbleEnabled !== false) {
    throw new Error(`Todo bubble opt-out did not survive restart: ${JSON.stringify(original)}`);
  }
  const existingBubble = (await listTargets(endpoint)).find(
    (target) => target.type === 'page' && target.url.endsWith('#bubble')
  );
  if (existingBubble) {
    const visibility = await evaluate(existingBubble, `document.visibilityState`);
    if (visibility !== 'hidden') {
      throw new Error(`Passive todo bubble returned after restart: ${JSON.stringify(visibility)}`);
    }
  }

  const reminder = await evaluate(pet, `(async () => {
    await window.eyeProtect.saveSettings({ reminderMode: 'gentle', todoBubbleEnabled: false });
    return window.eyeProtect.testReminder('eye');
  })()`);
  await waitForVisibleBubble('.bubble-reminder');
  await evaluate(pet, `window.eyeProtect.reminderAction('skip', ${JSON.stringify(reminder.activeReminder?.id ?? '')})`);
  await waitForTargetGone(endpoint, '#bubble');

  await evaluate(pet, `(async () => {
    await window.eyeProtect.saveSettings({
      todoBubbleEnabled: false,
      reminderMode: 'guided',
      eyeIntervalMinutes: 1,
      walkIntervalMinutes: 240,
      preAlertSeconds: 60
    });
    await window.eyeProtect.restartCycle();
  })()`);
  await waitFor(pet, `(async () => Boolean((await window.eyeProtect.getReminderStatus()).preAlert))()`);
  await waitForVisibleBubble('.bubble-prealert');
  const preAlert = await evaluate(pet, `window.eyeProtect.getReminderStatus()`);
  if (!preAlert.preAlert) {
    throw new Error(`Pre-alert bubble was not active: ${JSON.stringify(preAlert)}`);
  }
  await evaluate(pet, `(async () => {
    await window.eyeProtect.preAlertAction('dismiss');
    await window.eyeProtect.saveSettings({
      todoBubbleEnabled: false,
      reminderMode: ${JSON.stringify(original.reminderMode)},
      eyeIntervalMinutes: ${original.eyeIntervalMinutes},
      walkIntervalMinutes: ${original.walkIntervalMinutes},
      preAlertSeconds: ${original.preAlertSeconds}
    });
    await window.eyeProtect.restartCycle();
  })()`);
  console.log('Todo bubble opt-out survived restart while gentle and pre-alert bubbles remained visible.');
}
