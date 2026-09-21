import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveRestoredTaskProjectId } from '../src/shared/simpleTasks';

test('restore keeps live project ids', () => {
  assert.equal(resolveRestoredTaskProjectId('p1', 'active'), 'p1');
  assert.equal(resolveRestoredTaskProjectId('p1', 'onHold'), 'p1');
});

test('restore rehomes tasks from inactive lists instead of reviving them', () => {
  assert.equal(resolveRestoredTaskProjectId('p1', 'completed'), null);
  assert.equal(resolveRestoredTaskProjectId('p1', 'archived'), null);
  assert.equal(resolveRestoredTaskProjectId('p1', undefined), null);
});

test('restore of inbox tasks stays on the default list', () => {
  assert.equal(resolveRestoredTaskProjectId(null, 'active'), null);
  assert.equal(resolveRestoredTaskProjectId(undefined, undefined), null);
});
