/**
 * Project section domain tests (USERPLAN 1.2 PR5, ADR-002).
 *
 * Board columns are sections owned by the project — never derived from the
 * global active/focus task. These tests pin the grouping semantics and the
 * store-level change events the renderer subscribes to.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TaskStore } from '../src/main/taskStore';
import { groupTasksBySection, UNSECTIONED_TITLE } from '../src/shared/projectSections';
import { SECTION_TEMPLATE, type ProjectSection, type Task } from '../src/shared/types';

const NOW = new Date(2026, 7, 13, 9, 0, 0, 0).getTime();

const task = (over: Partial<Task>): Task =>
  ({
    id: 't',
    title: '任务',
    notes: null,
    status: 'open',
    priority: 'normal',
    projectId: 'p',
    parentId: null,
    tags: [],
    plannedAt: null,
    dueAt: null,
    reminderAt: null,
    recurrence: null,
    context: 'desk',
    remindOnBreak: false,
    estimateMinutes: null,
    sectionId: null,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    revision: 1,
    ...over
  }) as Task;

const section = (id: string, name: string, sortOrder: number): ProjectSection => ({
  id,
  projectId: 'p',
  name,
  sortOrder,
  createdAt: NOW,
  updatedAt: NOW
});

test('section template follows the suggested workflow stages', () => {
  assert.deepEqual([...SECTION_TEMPLATE], ['Backlog', 'Next', 'Doing', 'Waiting']);
});

test('grouping puts unsectioned tasks first and keeps section order', () => {
  const sections = [section('s1', 'Doing', 0), section('s2', 'Waiting', 1)];
  const groups = groupTasksBySection(
    [
      task({ id: 'a' }),
      task({ id: 'b', sectionId: 's2' }),
      task({ id: 'c', sectionId: 's1' })
    ],
    sections
  );
  assert.deepEqual(groups.map((group) => group.title), [UNSECTIONED_TITLE, 'Doing', 'Waiting']);
  assert.deepEqual(groups[0].tasks.map((entry) => entry.id), ['a']);
  assert.deepEqual(groups[1].tasks.map((entry) => entry.id), ['c']);
  assert.deepEqual(groups[2].tasks.map((entry) => entry.id), ['b']);
});

test('tasks pointing at an unknown section fall back to unsectioned', () => {
  const groups = groupTasksBySection([task({ id: 'ghost', sectionId: 'deleted' })], [section('s1', 'Doing', 0)]);
  assert.deepEqual(groups[0].sectionId, null);
  assert.deepEqual(groups[0].tasks.map((entry) => entry.id), ['ghost']);
});

test('empty section columns stay visible; the unsectioned column hides when empty and sections exist', () => {
  const groups = groupTasksBySection([task({ id: 'a', sectionId: 's1' })], [section('s1', 'Doing', 0), section('s2', 'Waiting', 1)]);
  assert.deepEqual(groups.map((group) => group.title), ['Doing', 'Waiting']);
  assert.equal(groups[1].tasks.length, 0, 'an empty stage is still a column');
});

test('without any sections every task lands in the single unsectioned group', () => {
  const groups = groupTasksBySection([task({ id: 'a' }), task({ id: 'b' })], []);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sectionId, null);
  assert.equal(groups[0].tasks.length, 2);
});

test('section CRUD emits project-sections-changed with the owning project', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-pr5-'));
  try {
    const store = new TaskStore(dir);
    const project = store.createProject({ name: 'Research' }, NOW);
    const events: Array<{ projectId: string | null }> = [];
    store.on('project-sections-changed', (payload: { projectId: string | null }) => events.push(payload));

    const created = store.createProjectSection({ projectId: project.id, name: 'Doing' }, NOW);
    assert.equal(events.length, 1);
    assert.equal(events[0].projectId, project.id);

    store.updateProjectSection(created.id, { name: 'In Progress' }, NOW);
    assert.equal(events.length, 2);

    const second = store.createProjectSection({ projectId: project.id, name: 'Waiting' }, NOW);
    store.moveProjectSection(second.id, created.id, NOW);
    assert.equal(events.length, 4);
    assert.deepEqual(
      store.getProjectSections(project.id).map((entry) => entry.name),
      ['Waiting', 'In Progress']
    );

    store.deleteProjectSection(second.id, NOW);
    assert.equal(events.length, 5);
    assert.equal(store.getProjectSections(project.id).length, 1);
  } finally {
    TaskStore.closeAllForDirectory(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('setTaskSection keeps the task inside its own project only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-pr5-'));
  try {
    const store = new TaskStore(dir);
    const left = store.createProject({ name: 'Left' }, NOW);
    const right = store.createProject({ name: 'Right' }, NOW);
    const taskRow = store.createTask({ title: 'T', projectId: left.id }, NOW);
    const foreignSection = store.createProjectSection({ projectId: right.id, name: 'Doing' }, NOW);
    const ownSection = store.createProjectSection({ projectId: left.id, name: 'Doing' }, NOW);

    assert.throws(() => store.setTaskSection(taskRow.id, foreignSection.id, NOW));
    const moved = store.setTaskSection(taskRow.id, ownSection.id, NOW);
    assert.equal(moved?.sectionId, ownSection.id);
    const cleared = store.setTaskSection(taskRow.id, null, NOW);
    assert.equal(cleared?.sectionId, null);
  } finally {
    TaskStore.closeAllForDirectory(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});
