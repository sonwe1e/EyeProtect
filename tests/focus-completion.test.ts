import assert from 'node:assert/strict';
import test from 'node:test';
import type { CommandResult, FocusStatus, Task } from '../src/shared/types';
import { completeTaskThenFocus } from '../src/renderer/src/features/tasks/focusCompletion';

const failedTaskWrite: CommandResult<Task[]> = {
  ok: false,
  code: 'database/read-only',
  message: '任务未被修改',
  recoverable: true
};

const completedFocus: FocusStatus = {
  session: null,
  todayTaskMs: 0,
  totalTaskMs: 0,
  plannedMinutes: null,
  block: null
};

test('a failed task completion never ends the FocusSession', async () => {
  let focusCalls = 0;
  const result = await completeTaskThenFocus(
    'task-1',
    async () => failedTaskWrite,
    async () => {
      focusCalls += 1;
      return { ok: true, data: completedFocus };
    }
  );
  assert.deepEqual(result, failedTaskWrite);
  assert.equal(focusCalls, 0);
});

test('FocusSession completion runs only after the task write succeeds', async () => {
  let focusCalls = 0;
  const result = await completeTaskThenFocus(
    'task-1',
    async () => ({ ok: true, data: [] }),
    async () => {
      focusCalls += 1;
      return { ok: true, data: completedFocus };
    }
  );
  assert.equal(result.ok, true);
  assert.equal(focusCalls, 1);
});
