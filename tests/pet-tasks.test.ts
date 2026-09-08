import assert from 'node:assert/strict';
import test from 'node:test';
import { selectPetTasks } from '../src/shared/petTasks';
import { sanitizeTask, type Project } from '../src/shared/types';

const task = (id: string, extra = {}) => sanitizeTask({ id, title: id, createdAt: 1, ...extra })!;

test('manual selection preserves order, removes duplicates and never fills vacant slots', () => {
  const tasks = [task('a'), task('b'), task('c')];
  assert.deepEqual(selectPetTasks(['b', 'a', 'b', 'missing'], tasks, []).map((entry) => entry.id), ['b', 'a']);
  assert.deepEqual(selectPetTasks([], tasks, []), []);
});

test('completed and archived tasks hide, undo restores them, new recurrence instances stay unselected', () => {
  const ids = ['a', 'b'];
  assert.deepEqual(selectPetTasks(ids, [task('a', { status: 'done' }), task('b', { status: 'archived' }), task('new-instance')], []), []);
  assert.deepEqual(selectPetTasks(ids, [task('a'), task('new-instance')], []).map((entry) => entry.id), ['a']);
});

test('project read-only state gates display and reactivation restores the saved selection', () => {
  const tasks = [task('a', { projectId: 'p' })];
  for (const status of ['active', 'onHold', 'completed', 'archived'] as const) {
    const project = { id: 'p', status } as Project;
    assert.equal(selectPetTasks(['a'], tasks, [project]).length, status === 'active' || status === 'onHold' ? 1 : 0);
  }
  assert.equal(selectPetTasks(['a'], tasks, []).length, 0, 'missing project cannot grant edit permission');
});
