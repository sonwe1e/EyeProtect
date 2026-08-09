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

const petTarget = await waitForTarget('#pet');
const pet = await evaluate(
  petTarget,
  `(async () => ({
    bridge: typeof window.eyeProtect === 'object',
    petShell: Boolean(document.querySelector('.pet-shell')),
    character: Boolean(document.querySelector('.pet-character')),
    runtime: await window.eyeProtect.getRuntimeInfo(),
    settings: await window.eyeProtect.getSettings()
  }))()`
);

if (
  !pet?.bridge ||
  !pet.petShell ||
  !pet.character ||
  pet.runtime?.appVersion !== expectedVersion
) {
  throw new Error(`Pet renderer smoke check failed: ${JSON.stringify(pet)}`);
}

await evaluate(petTarget, 'window.eyeProtect.openSettings()');
const workbenchTarget = await waitForTarget('#workbench');
await delay(500);
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
      workbenchShell: Boolean(document.querySelector('.workbench-shell')),
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

console.log(
  JSON.stringify(
    {
      pet,
      workbench
    },
    null,
    2
  )
);
