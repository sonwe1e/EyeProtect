import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toCommandResult,
  type CommandResult,
  type Task
} from '../src/shared/types';

// commands.ts references `window.eyeProtect` only inside its wrapped
// functions, so importing it is safe under Node; we stub the bridge there.
const apiCalls: Array<{ method: string; args: unknown[] }> = [];
const eyeProtectStub = new Proxy({} as Record<string, (...args: unknown[]) => Promise<unknown>>, {
  get(_target, prop: string) {
    return (...args: unknown[]): Promise<unknown> => {
      apiCalls.push({ method: prop, args: [...args] });
      return Promise.resolve([]);
    };
  }
});
(globalThis as unknown as { window: { eyeProtect: typeof eyeProtectStub } }).window = {
  eyeProtect: eyeProtectStub
};

const { commands } = await import('../src/renderer/src/lib/commands.ts');

const taskData = ((): Task[] => [])();

// ── toCommandResult: stable error-code mapping ───────────────────────────────

test('toCommandResult maps the read-only recovery message to database/read-only', () => {
  const result = toCommandResult(new Error('任务数据库处于恢复模式；原数据库未被修改'));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'database/read-only');
    assert.equal(result.recoverable, true);
  }
});

test('toCommandResult maps an unavailable/unavailable DB message to database/unavailable', () => {
  const result = toCommandResult(new Error('无法打开任务数据库'));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'database/unavailable');
  }
});

test('toCommandResult maps a not-found message to not-found', () => {
  const result = toCommandResult(new Error('任务不存在'));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'not-found');
    assert.equal(result.recoverable, false);
  }
});

test('toCommandResult falls back to unknown for an unrecognized error', () => {
  const result = toCommandResult(new Error('something unexpected broke'));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'unknown');
    assert.equal(result.recoverable, true);
  }
});

test('toCommandResult handles a non-Error thrown value', () => {
  const result = toCommandResult('string failure');
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'unknown');
    assert.match(result.message, /string failure/);
  }
});

test('toCommandResult maps an invalid-input message to validation (recoverable)', () => {
  const result = toCommandResult(new Error('Invalid standalone reminder schedule'));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'validation');
    assert.equal(result.recoverable, true);
  }
});

test('toCommandResult maps a 非法 message to validation', () => {
  const result = toCommandResult(new Error('非法输入'));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'validation');
  }
});

test('toCommandResult maps a conflict/duplicate message to conflict', () => {
  const result = toCommandResult(new Error('already exists'));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'conflict');
    assert.equal(result.recoverable, false);
  }
});

test('toCommandResult does not misclassify a bare "unavailable" as a database error', () => {
  // A non-database message containing "unavailable" (e.g. a notification error)
  // must fall through to unknown, not database/unavailable.
  const result = toCommandResult(new Error('native notifications are unavailable'));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'unknown');
    assert.equal(result.recoverable, true);
  }
});

// ── commands.ts: every mutation routes through the bridge as a single IPC ────

test('commands.tasks.create issues exactly one createTask IPC', async () => {
  apiCalls.length = 0;
  const result = await commands.tasks.create({ title: '新任务' });
  assert.equal(result.ok, true);
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].method, 'createTask');
  assert.deepEqual(apiCalls[0].args, [{ title: '新任务' }]);
});

test('commands.tasks.delete routes the id through deleteTask', async () => {
  apiCalls.length = 0;
  await commands.tasks.delete('task-1');
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].method, 'deleteTask');
  assert.deepEqual(apiCalls[0].args, ['task-1']);
});

test('commands.projects.create routes through createProject', async () => {
  apiCalls.length = 0;
  await commands.projects.create({ name: 'Research', color: '#217a70' });
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].method, 'createProject');
});

test('commands.deliveries.retry routes through retryFailedDelivery', async () => {
  apiCalls.length = 0;
  await commands.deliveries.retry('del-1');
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].method, 'retryFailedDelivery');
});

// ── commands.ts: a rejected IPC is caught, not thrown ────────────────────────

test('commands.tasks.create returns a structured failure instead of throwing', async () => {
  apiCalls.length = 0;
  const failing = new Proxy({} as Record<string, (...args: unknown[]) => Promise<unknown>>, {
    get(_target, prop: string) {
      return (): Promise<unknown> => {
        apiCalls.push({ method: prop, args: [] });
        return Promise.reject(new Error('任务数据库处于恢复模式；原数据库未被修改'));
      };
    }
  });
  (globalThis as unknown as { window: { eyeProtect: typeof failing } }).window = {
    eyeProtect: failing
  };
  const { commands: failingCommands } = await import('../src/renderer/src/lib/commands.ts');
  const result = await failingCommands.tasks.create({ title: 'x' });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'database/read-only');
  }
  // Restore the default stub for subsequent tests.
  (globalThis as unknown as { window: { eyeProtect: typeof eyeProtectStub } }).window = {
    eyeProtect: eyeProtectStub
  };
});

// ── CommandResult type shape ─────────────────────────────────────────────────

test('CommandResult ok:true carries data', () => {
  const ok: CommandResult<Task[]> = { ok: true, data: taskData };
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.data, taskData);
  }
});
