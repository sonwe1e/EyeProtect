import { readFileSync } from 'node:fs';

const port = Number(process.argv[2] ?? 9333);
const endpoint = `http://127.0.0.1:${port}`;
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);
const expectedVersion = packageJson.version;

import { call, delay, evaluate, listTargets, waitForTarget } from './lib/cdp.mjs';
const waitForValue = async (target, expression, predicate, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await evaluate(target, expression);
    if (predicate(last)) return last;
    await delay(100);
  }
  throw new Error(`Timed out waiting for renderer state: ${JSON.stringify(last)}`);
};

const petTarget = await waitForTarget(endpoint, '#pet');
const petProbeStartedAt = Date.now();
const pet = await waitForValue(
  petTarget,
  `(async () => {
  const api = window.eyeProtect;
  const methods = ['getCharacterCollection', 'getRuntimeInfo', 'getSettings'];
  const ready = Boolean(api) && methods.every((name) => typeof api[name] === 'function');
  if (!ready) {
    return { bridge: false, href: location.href, readyState: document.readyState, methods: Object.fromEntries(methods.map((name) => [name, typeof api?.[name]])) };
  }
  const character = document.querySelector('.pet-character');
  const dragHandle = document.querySelector('.pet-drag-handle');
  return {
    bridge: true,
    href: location.href,
    readyState: document.readyState,
    petShell: Boolean(document.querySelector('.pet-shell')),
    character: Boolean(character),
    characterRegion: character ? getComputedStyle(character).webkitAppRegion : null,
    dragHandleRegion: dragHandle ? getComputedStyle(dragHandle).webkitAppRegion : null,
    proceduralSvg: Boolean(document.querySelector('.pet-character .procedural-character svg')),
    collection: await api.getCharacterCollection(),
    runtime: await api.getRuntimeInfo(),
    settings: await api.getSettings()
  };
})()`,
  (value) => Boolean(value?.bridge && value?.petShell && value?.character && value?.proceduralSvg && value?.collection?.candidate)
);
const bridgeReadyLatencyMs = Date.now() - petProbeStartedAt;

if (
  !pet?.bridge ||
  !pet.petShell ||
  !pet.character ||
  pet.characterRegion !== 'no-drag' ||
  pet.dragHandleRegion !== 'drag' ||
  !pet.proceduralSvg ||
  !pet.collection?.candidate ||
  pet.runtime?.appVersion !== expectedVersion
) {
  throw new Error(`Pet renderer smoke check failed: ${JSON.stringify(pet)}`);
}

// A native drag region swallows DOM click events. Exercise a real CDP double
// click on the character before using the bridge, proving the interactive
// surface opens the Workbench while the separate drag handle remains native.
const characterCenter = await evaluate(petTarget, `(() => {
  const rect = document.querySelector('.pet-character')?.getBoundingClientRect();
  return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.45 } : null;
})()`);
if (!characterCenter) throw new Error('Pet character click target was unavailable');
for (const [type, clickCount] of [['mousePressed', 1], ['mouseReleased', 1], ['mousePressed', 2], ['mouseReleased', 2]]) {
  await call(petTarget, 'Input.dispatchMouseEvent', { type, x: characterCenter.x, y: characterCenter.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount });
}
const workbenchTarget = await waitForTarget(endpoint, '#workbench');
await waitForValue(workbenchTarget, `Boolean(document.querySelector('.today-page'))`, Boolean);
await evaluate(petTarget, "window.eyeProtect.openWorkbench('collection')");
const collection = await waitForValue(workbenchTarget, `(() => ({
  page: Boolean(document.querySelector('.collection-page')),
  candidate: Boolean(document.querySelector('.candidate-card .procedural-character svg'))
}))()`, (value) => value?.page && value?.candidate);
if (!collection?.page || !collection.candidate) {
  throw new Error(`Character collection smoke check failed: ${JSON.stringify(collection)}`);
}
await evaluate(petTarget, "window.eyeProtect.openWorkbench('settings')");
await waitForValue(
  workbenchTarget,
  `(() => ({
    shell: Boolean(document.querySelector('.workbench-v2')),
    settings: Boolean(document.querySelector('.settings-shell'))
  }))()`,
  (value) => value?.shell && value?.settings
);
const workbench = await evaluate(
  workbenchTarget,
  `(async () => {
    const current = await window.eyeProtect.getSettings();
    const saved = await window.eyeProtect.saveSettings({
      snoozeMinutes: current.snoozeMinutes
    });
    const tasks = await window.eyeProtect.createTask({ title: 'Packaged smoke task' });
    const smokeTask = tasks.find((task) => task.title === 'Packaged smoke task');
    // Daily planning IPC round-trip (USERPLAN PR3): upsert a commitment,
    // read it back, rank it, then clear it — all inside the packaged app.
    const localDate = new Date().toLocaleDateString('en-CA');
    const planned = smokeTask
      ? await window.eyeProtect.upsertDailyPlan({ taskId: smokeTask.id, localDate, plannedMinutes: 25 })
      : [];
    const ranked = smokeTask
      ? await window.eyeProtect.upsertDailyPlan({ taskId: smokeTask.id, localDate, dailyRank: 1 })
      : [];
    const dayPlans = await window.eyeProtect.getDailyPlans(localDate);
    const unplanned = smokeTask
      ? await window.eyeProtect.removeDailyPlan(smokeTask.id, localDate)
      : [];
    return {
      bridge: typeof window.eyeProtect === 'object',
      workbenchShell: Boolean(document.querySelector('.workbench-v2')),
      settingsShell: Boolean(document.querySelector('.settings-shell')),
      heading: document.querySelector('.settings-header h1')?.textContent,
      savedSnoozeMinutes: saved.snoozeMinutes,
      taskPersisted: tasks.some((task) => task.title === 'Packaged smoke task'),
      planningPersisted: planned.some((entry) => entry.taskId === smokeTask?.id && entry.plannedMinutes === 25),
      planningRanked: ranked.some((entry) => entry.taskId === smokeTask?.id && entry.dailyRank === 1),
      planningReadBack: dayPlans.some((entry) => entry.taskId === smokeTask?.id && entry.dailyRank === 1),
      planningRemoved: unplanned.length === 0
    };
  })()`
);

if (
  !workbench?.bridge ||
  !workbench.workbenchShell ||
  !workbench.settingsShell ||
  workbench.heading !== '提醒设置' ||
  workbench.savedSnoozeMinutes !== pet.settings.snoozeMinutes ||
  !workbench.taskPersisted ||
  !workbench.planningPersisted ||
  !workbench.planningRanked ||
  !workbench.planningReadBack ||
  !workbench.planningRemoved
) {
  throw new Error(`Workbench renderer smoke check failed: ${JSON.stringify(workbench)}`);
}

// Theme runtime authority audit (USERPLAN 1.2 PR0). Emits every theme
// authority in one place — settings, DOM dataset, inline style, computed
// CSS, media query — so a mismatch can be diagnosed as product bug vs CDP
// emulation artifact without guessing.
const themeAudit = await evaluate(workbenchTarget, `(async () => {
  const settings = await window.eyeProtect.getSettings();
  const root = document.documentElement;
  return {
    settingsTheme: settings.theme,
    datasetTheme: root.dataset.theme ?? null,
    inlineColorScheme: root.style.colorScheme || null,
    computedColorScheme: getComputedStyle(root).colorScheme,
    prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
    appBackgroundColor: getComputedStyle(document.body).backgroundColor
  };
})()`);

// The renderer owns dataset.theme and derives it from settings — a mismatch
// here is a deterministic product bug, never an emulation artifact.
if (!themeAudit || themeAudit.datasetTheme !== themeAudit.settingsTheme) {
  throw new Error(`Theme authority mismatch: ${JSON.stringify(themeAudit)}`);
}

console.log(
  JSON.stringify(
    {
      pet,
      bridgeReadyLatencyMs,
      collection,
      workbench,
      themeAudit
    },
    null,
    2
  )
);
