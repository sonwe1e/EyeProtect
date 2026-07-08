import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsStore } from '../src/main/settings';
import { sanitizeTodos, type TodoItem } from '../src/shared/types';

test('sanitizeTodos drops malformed entries and keeps valid ones', () => {
  const result = sanitizeTodos([
    { id: 'a', text: '喝水', createdAt: 1 },
    { id: '', text: 'no id', createdAt: 2 },
    { id: 'c', text: 42, createdAt: 3 },
    'nonsense',
    null
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'a');
  assert.equal(result[0].text, '喝水');
  assert.equal(result[0].createdAt, 1);
});

test('sanitizeTodos returns an empty array for non-array input', () => {
  assert.equal(sanitizeTodos(undefined).length, 0);
  assert.equal(sanitizeTodos({}).length, 0);
  assert.equal(sanitizeTodos('x').length, 0);
});

test('sanitizeTodos preserves multiple valid entries in order', () => {
  const result = sanitizeTodos([
    { id: 'a', text: '第一件', createdAt: 10 },
    { id: 'b', text: '第二件', createdAt: 20 }
  ]);

  assert.equal(result.length, 2);
  assert.deepEqual(result.map((todo) => todo.text), ['第一件', '第二件']);
});

test('addTodo and removeTodo emit todos-changed carrying the current list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-t-'));
  const original = process.env.EYEPROTECT_DATA_DIR;
  process.env.EYEPROTECT_DATA_DIR = dir;
  try {
    const store = new SettingsStore();
    const events: TodoItem[][] = [];
    store.on('todos-changed', (todos) => events.push(todos));

    const created = store.addTodo('first');
    assert.equal(events.length, 1, 'addTodo emits todos-changed once');
    assert.deepEqual(events[0], created, 'payload matches the list returned by addTodo');
    assert.equal(events[0].length, 1);
    assert.equal(events[0][0].text, 'first');

    store.removeTodo(created[0].id);
    assert.equal(events.length, 2, 'removeTodo emits todos-changed once more');
    assert.deepEqual(events[1], [], 'removing the last todo yields an empty list');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (original === undefined) {
      delete process.env.EYEPROTECT_DATA_DIR;
    } else {
      process.env.EYEPROTECT_DATA_DIR = original;
    }
  }
});
