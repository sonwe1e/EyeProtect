import { readFileSync } from 'node:fs';

const port = Number(process.argv[2] ?? 9333);
const endpoint = `http://127.0.0.1:${port}`;
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);
const expectedVersion = packageJson.version;

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
    try {
      const target = (await listTargets()).find(
        (candidate) => candidate.type === 'page' && candidate.url.endsWith(hash)
      );
      if (target) {
        return target;
      }
    } catch {
      // The packaged process may still be starting its debugging endpoint.
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

const petTarget = await waitForTarget('#pet');
const pet = await waitForValue(
  petTarget,
  `(async () => ({
    bridge: typeof window.eyeProtect === 'object',
    petShell: Boolean(document.querySelector('.pet-shell')),
    character: Boolean(document.querySelector('.pet-character')),
    proceduralSvg: Boolean(document.querySelector('.pet-character .procedural-character svg')),
    collection: await window.eyeProtect.getCharacterCollection(),
    runtime: await window.eyeProtect.getRuntimeInfo(),
    settings: await window.eyeProtect.getSettings()
  }))()`,
  (value) => Boolean(value?.bridge && value?.petShell && value?.character && value?.proceduralSvg && value?.collection?.candidate)
);

if (
  !pet?.bridge ||
  !pet.petShell ||
  !pet.character ||
  !pet.proceduralSvg ||
  !pet.collection?.candidate ||
  pet.runtime?.appVersion !== expectedVersion
) {
  throw new Error(`Pet renderer smoke check failed: ${JSON.stringify(pet)}`);
}

await evaluate(petTarget, "window.eyeProtect.openWorkbench('collection')");
const workbenchTarget = await waitForTarget('#workbench');
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
    return {
      bridge: typeof window.eyeProtect === 'object',
      workbenchShell: Boolean(document.querySelector('.workbench-v2')),
      settingsShell: Boolean(document.querySelector('.settings-shell')),
      heading: document.querySelector('.settings-header h1')?.textContent,
      savedSnoozeMinutes: saved.snoozeMinutes,
      taskPersisted: tasks.some((task) => task.title === 'Packaged smoke task')
    };
  })()`
);

if (
  !workbench?.bridge ||
  !workbench.workbenchShell ||
  !workbench.settingsShell ||
  workbench.heading !== '提醒设置' ||
  workbench.savedSnoozeMinutes !== pet.settings.snoozeMinutes ||
  !workbench.taskPersisted
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
      collection,
      workbench,
      themeAudit
    },
    null,
    2
  )
);
