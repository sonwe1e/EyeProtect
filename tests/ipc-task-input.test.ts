import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asOrderedTaskIds, asSimpleTaskUpdateInput, asTaskInput, asTaskUpdateInput } from '../src/main/ipcTaskInput';

test('task creation transport coerces title and preserves valid fields', () => {
  assert.deepEqual(asTaskInput({ title: '写周报', dueAt: 1000, tags: ['a', 2] }), {
    title: '写周报',
    notes: undefined,
    priority: undefined,
    projectId: undefined,
    parentId: undefined,
    tags: ['a', ''],
    plannedAt: undefined,
    dueAt: 1000,
    dueDate: undefined,
    reminderAt: undefined,
    recurrence: undefined,
    context: undefined,
    remindOnBreak: undefined,
    estimateMinutes: undefined
  });
});

test('task update transport forwards baseRevision (stale-write guard)', () => {
  // USERPLAN PR2: without this, the optimistic-concurrency rejection in the
  // store can never fire on the IPC path and concurrent edits silently
  // overwrite each other.
  assert.equal(asTaskUpdateInput({ title: 'x', baseRevision: 7 }).baseRevision, 7);
  assert.equal(asTaskUpdateInput({ baseRevision: 0 }).baseRevision, undefined);
  assert.equal(asTaskUpdateInput({ baseRevision: 2.5 }).baseRevision, undefined);
  assert.equal(asTaskUpdateInput({ baseRevision: '3' }).baseRevision, undefined);
  assert.equal(asTaskUpdateInput({}).baseRevision, undefined);
});

test('task update transport preserves omission instead of inventing an empty title', () => {
  assert.deepEqual(asTaskUpdateInput({ notes: 'n' }), { notes: 'n' });
  assert.deepEqual(asTaskUpdateInput({ title: 5 }), {});
  assert.deepEqual(asTaskUpdateInput({ priority: 'bogus' }), {});
  assert.deepEqual(asTaskUpdateInput(null), {});
});

test('task update transport whitelists status and sortOrder', () => {
  assert.deepEqual(asTaskUpdateInput({ status: 'done' }), { status: 'done' });
  assert.deepEqual(asTaskUpdateInput({ status: 'bogus' }), {});
  assert.deepEqual(asTaskUpdateInput({ sortOrder: 3 }), { sortOrder: 3 });
  assert.deepEqual(asTaskUpdateInput({ sortOrder: -1 }), {});
  assert.deepEqual(asTaskUpdateInput({ sortOrder: 1.5 }), {});
});

test('task update transport drops unsupported field shapes', () => {
  assert.equal(asTaskUpdateInput({ dueAt: 'later' }).dueAt, undefined);
  assert.equal(asTaskUpdateInput({ dueAt: Infinity }).dueAt, undefined);
  assert.equal(asTaskUpdateInput({ context: 'anywhere' }).context, undefined);
  assert.equal(asTaskUpdateInput({ remindOnBreak: 'yes' }).remindOnBreak, undefined);
  assert.deepEqual(asTaskUpdateInput({ dueAt: null, dueDate: null, projectId: null }), {
    dueAt: null, dueDate: null,
    projectId: null
  });
});

test('queue order transport rejects a malformed id list instead of repairing it', () => {
  assert.deepEqual(asOrderedTaskIds(['a', ' b ']), ['a', 'b'], 'ids are trimmed');
  assert.equal(asOrderedTaskIds(Array.from({ length: 500 }, (_, index) => `id-${index}`)).length, 500);
  assert.throws(() => asOrderedTaskIds('a'), /顺序参数无效/);
  assert.throws(() => asOrderedTaskIds([]), /顺序参数无效/);
  assert.throws(() => asOrderedTaskIds(Array.from({ length: 501 }, (_, index) => `id-${index}`)), /顺序参数无效/);
  assert.throws(() => asOrderedTaskIds(['a', '']), /顺序参数无效/);
  assert.throws(() => asOrderedTaskIds(['a', '   ']), /顺序参数无效/);
  assert.throws(() => asOrderedTaskIds(['a', 2]), /顺序参数无效/);
  assert.throws(() => asOrderedTaskIds(['a', 'a']), /顺序里有重复项/);
});

test('simple update transport forwards priority so the drawer can cycle it', () => {
  // Without this, changing priority in the drawer would be silently dropped by
  // the whitelist and AC-09 could never pass.
  assert.deepEqual(asSimpleTaskUpdateInput({ priority: 'urgent' }), { priority: 'urgent' });
  assert.deepEqual(asSimpleTaskUpdateInput({ priority: 'normal' }), { priority: 'normal' });
  assert.deepEqual(asSimpleTaskUpdateInput({ priority: 'important', baseRevision: 3 }), {
    priority: 'important',
    baseRevision: 3
  });
  assert.deepEqual(asSimpleTaskUpdateInput({ priority: 'bogus' }), {});
  assert.deepEqual(asSimpleTaskUpdateInput({ priority: 'urgent', parentId: 'p' }), { priority: 'urgent' });
});
