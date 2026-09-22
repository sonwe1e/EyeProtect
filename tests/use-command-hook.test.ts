import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';
import type { CommandResult } from '../src/shared/types';
import type { UseCommandApi } from '../src/renderer/src/hooks/useCommand';

// ── F05: the real useCommand state machine ───────────────────────────────────
// The hook is loaded from its actual TypeScript source (transpiled here) and
// driven with a minimal slot-based React runtime, so these assertions run
// against the shipped hook rather than a copy of its logic.

type HookCommand = (...args: unknown[]) => Promise<CommandResult<unknown>>;
type HookApi = UseCommandApi<unknown, unknown[]>;

const loadHook = (): { useCommand: (command: HookCommand) => HookApi; beginRender: () => void } => {
  const source = readFileSync(join(process.cwd(), 'src', 'renderer', 'src', 'hooks', 'useCommand.ts'), 'utf8');
  const { code } = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' });
  const slots: Array<{ value: unknown } | { current: unknown }> = [];
  let cursor = 0;
  const useState = (initial: unknown): [unknown, (next: unknown) => void] => {
    const index = cursor++;
    if (index >= slots.length) slots.push({ value: initial });
    const slot = slots[index] as { value: unknown };
    return [slot.value, (next: unknown) => {
      slot.value = typeof next === 'function' ? (next as (previous: unknown) => unknown)(slot.value) : next;
    }];
  };
  const useRef = (initial: unknown): { current: unknown } => {
    const index = cursor++;
    if (index >= slots.length) slots.push({ current: initial });
    return slots[index] as { current: unknown };
  };
  const requireStub = (id: string): unknown => {
    if (id === 'react') return { useState, useRef, useCallback: (fn: unknown) => fn };
    throw new Error(`useCommand must not require '${id}'`);
  };
  const module = { exports: {} as Record<string, unknown> };
  new Function('require', 'module', 'exports', code)(requireStub, module, module.exports);
  return {
    useCommand: module.exports.useCommand as (command: HookCommand) => HookApi,
    beginRender: () => { cursor = 0; }
  };
};

const mount = (command: HookCommand): { api: () => HookApi; render: () => void } => {
  const { useCommand, beginRender } = loadHook();
  let api: HookApi;
  const render = (): void => {
    beginRender();
    api = useCommand(command);
  };
  render();
  return { api: () => api, render };
};

const countingCommand = (
  behavior: (...args: unknown[]) => Promise<CommandResult<unknown>>
): { command: HookCommand; calls: unknown[][] } => {
  const calls: unknown[][] = [];
  return {
    calls,
    command: (...args: unknown[]) => {
      calls.push(args);
      return behavior(...args);
    }
  };
};

const ok = (data: unknown): CommandResult<unknown> => ({ ok: true, data });
const failure = (message: string): CommandResult<unknown> => ({
  ok: false,
  code: 'unknown',
  message,
  recoverable: true
});

test('F05: a repeated identical call joins the in-flight request and still publishes its outcome', async () => {
  const { command, calls } = countingCommand(async () => ok('done'));
  const { api, render } = mount(command);

  const first = api().run();
  const second = api().run();
  render();
  assert.equal(api().state, 'pending', 'a joined call keeps the shared pending state');

  const [firstOutcome, secondOutcome] = await Promise.all([first, second]);
  render();

  assert.equal(calls.length, 1, 'the double submit fires exactly one IPC');
  assert.equal(firstOutcome.ok, true);
  assert.equal(secondOutcome, firstOutcome, 'the joined call shares the same outcome');
  assert.equal(api().state, 'success', 'the hook does not stay stuck on pending');
  assert.equal(api().isPending, false);
  assert.equal(api().result?.ok, true);
});

test('F05: a double-submitted failure is still visible', async () => {
  const { command, calls } = countingCommand(async () => failure('删除失败'));
  const { api, render } = mount(command);

  await Promise.all([api().run(), api().run()]);
  render();

  assert.equal(calls.length, 1);
  assert.equal(api().state, 'error');
  const error = api().error;
  assert.equal(error?.ok, false);
  assert.ok(error && !error.ok, 'the failure result is published');
  if (error && !error.ok) {
    assert.equal(error.message, '删除失败');
    assert.equal(error.code, 'unknown');
  }
});

test('different arguments are separate intents that run concurrently', async () => {
  let releaseSlow: (value: CommandResult<unknown>) => void = () => undefined;
  const { command, calls } = countingCommand(async (arg: unknown) =>
    arg === 'slow'
      ? new Promise<CommandResult<unknown>>((resolve) => { releaseSlow = resolve; })
      : ok(arg)
  );
  const { api, render } = mount(command);

  const slowRun = api().run('slow');
  const fastRun = api().run('fast');
  const fastOutcome = await fastRun;
  render();
  assert.equal(api().result, fastOutcome, 'the newer intent publishes while the slow one is in flight');

  releaseSlow(ok('slow-late'));
  const slowOutcome = await slowRun;
  render();

  assert.equal(calls.length, 2, 'a different argument is never dropped');
  assert.equal(slowOutcome.ok, true);
  assert.equal(api().result, fastOutcome, 'a stale resolve never overwrites the newer outcome');
});

test('a joined call after completion starts a fresh request', async () => {
  const { command, calls } = countingCommand(async () => ok('again'));
  const { api, render } = mount(command);

  await api().run();
  render();
  assert.equal(calls.length, 1);
  assert.equal(api().state, 'success');

  await api().run();
  render();
  assert.equal(calls.length, 2, 'once the flight is over the same arguments start a new one');
  assert.equal(api().state, 'success');
});

test('reset returns the hook to idle and drops in-flight joining', async () => {
  let release: (value: CommandResult<unknown>) => void = () => undefined;
  const { command, calls } = countingCommand(() => new Promise<CommandResult<unknown>>((resolve) => { release = resolve; }));
  const { api, render } = mount(command);

  const pending = api().run();
  api().reset();
  render();
  assert.equal(api().state, 'idle');
  assert.equal(api().result, null);

  // The reset flight is no longer joinable and its late resolve is discarded.
  release(ok('late'));
  await pending;
  render();
  assert.equal(calls.length, 1);
  assert.equal(api().state, 'idle', 'a result that arrives after reset is not published');
});
