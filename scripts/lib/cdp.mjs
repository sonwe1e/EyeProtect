// Shared CDP plumbing for the packaged-app smoke/capture scripts.
//
// Every script talks to the packaged EyeProtect over the DevTools protocol:
// list targets from /json, wait for a page to appear, then run Runtime.* /
// Input.* commands over a per-call WebSocket. These helpers were copy-pasted
// across all scripts; this module is the single source of truth so a CDP fix
// lands in every script at once (scripts stay free to build script-specific
// helpers on top).
//
// API:
//   delay(ms)
//   listTargets(endpoint)
//   waitForTarget(endpoint, hashOrPredicate, labelOrTimeoutMs)  — hash string
//     or predicate function; timeout defaults to 12s.
//   waitForTargetGone(endpoint, hash, timeoutMs)
//   call(target, method, params, timeoutMs)                     — one-shot CDP call
//   evaluate(target, expression, timeoutMs)                     — Runtime.evaluate
//   waitFor(target, expression, timeoutMs)                      — poll until truthy
//   openSession(target, timeoutMs)                              — persistent socket
//   callSequence(target, steps, stepDelayMs)                    — ordered calls

export const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const listTargets = async (endpoint) => {
  const response = await fetch(`${endpoint}/json`);
  if (!response.ok) {
    throw new Error(`CDP target list returned HTTP ${response.status}`);
  }
  return response.json();
};

export const waitForTarget = async (
  endpoint,
  hashOrPredicate,
  labelOrTimeoutMs = 12_000
) => {
  const predicate =
    typeof hashOrPredicate === 'function'
      ? hashOrPredicate
      : (candidate) => candidate.url.endsWith(hashOrPredicate);
  const label =
    typeof hashOrPredicate === 'function'
      ? labelOrTimeoutMs
      : hashOrPredicate;
  const timeoutMs =
    typeof hashOrPredicate === 'function'
      ? 12_000
      : labelOrTimeoutMs;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const target = (await listTargets(endpoint)).find(
        (candidate) => candidate.type === 'page' && predicate(candidate)
      );
      if (target) {
        return target;
      }
    } catch {
      // The packaged application can take a moment to expose CDP.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
};

export const waitForTargetGone = async (endpoint, hash, timeoutMs = 12_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const exists = (await listTargets(endpoint)).some(
        (candidate) => candidate.type === 'page' && candidate.url.endsWith(hash)
      );
      if (!exists) {
        return;
      }
    } catch {
      // The debugging endpoint may briefly update while a window closes.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${hash} to close`);
};

const openSocket = (target) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    socket.addEventListener('open', () => resolve(socket), { once: true });
    socket.addEventListener(
      'error',
      () => reject(new Error('CDP WebSocket failed to open')),
      { once: true }
    );
  });

export const call = async (target, method, params = {}, timeoutMs = 12_000) => {
  const socket = await openSocket(target);
  try {
    return await new Promise((resolve, reject) => {
      const id = 1;
      const timeout = setTimeout(
        () => reject(new Error(`${method} timed out`)),
        timeoutMs
      );
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== id) return;
        clearTimeout(timeout);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  } finally {
    socket.close();
  }
};

export const evaluate = async (target, expression, timeoutMs = 12_000) => {
  const response = await call(
    target,
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    timeoutMs
  );
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        'unknown renderer exception'
    );
  }
  return response.result?.value;
};

export const waitFor = async (target, expression, timeoutMs = 12_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(target, expression, timeoutMs)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for UI state: ${expression}`);
};

/** Persistent CDP session — Emulation.setEmulatedMedia etc. survives only as
 *  long as the DevTools session that set it stays open, so audit/screenshot
 *  flows that depend on emulation must share ONE socket. */
export const openSession = async (target, timeoutMs = 12_000) => {
  const socket = await openSocket(target);
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolveMessage, rejectMessage, timeout } = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(timeout);
    if (message.error) rejectMessage(new Error(message.error.message));
    else resolveMessage(message.result);
  });
  return {
    call(method, params = {}) {
      const id = ++nextId;
      const promise = new Promise((resolveMessage, rejectMessage) => {
        const timeout = setTimeout(
          () => rejectMessage(new Error(`${method} timed out`)),
          timeoutMs
        );
        pending.set(id, { resolveMessage, rejectMessage, timeout });
      });
      socket.send(JSON.stringify({ id, method, params }));
      return promise;
    },
    close() {
      socket.close();
    }
  };
};

/** Ordered CDP calls over one socket. Human-scale pacing on mouse moves keeps
 *  Electron's HTML5 drag recognizer deterministic in packaged builds. */
export const callSequence = async (target, steps, stepDelayMs = 24) => {
  const socket = await openSocket(target);
  try {
    for (let index = 0; index < steps.length; index += 1) {
      const id = index + 1;
      await new Promise((resolveStep, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`${steps[index].method} timed out`)),
          12_000
        );
        const onMessage = (event) => {
          const message = JSON.parse(String(event.data));
          if (message.id !== id) return;
          socket.removeEventListener('message', onMessage);
          clearTimeout(timeout);
          if (message.error) reject(new Error(message.error.message));
          else resolveStep(message.result);
        };
        socket.addEventListener('message', onMessage);
        socket.send(JSON.stringify({ id, ...steps[index] }));
      });
      if (steps[index].method === 'Input.dispatchMouseEvent') await delay(stepDelayMs);
    }
  } finally {
    socket.close();
  }
};
