import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsStore } from '../src/main/settings';
import {
  TODO_TEXT_MAX,
  nextTodoPriority,
  sanitizeTodos,
  sortTodosForDisplay,
  type TodoItem
} from '../src/shared/types';

const withTempStore = (fn: (store: SettingsStore) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-t-'));
  const original = process.env.EYEPROTECT_DATA_DIR;
  process.env.EYEPROTECT_DATA_DIR = dir;
  try {
    fn(new SettingsStore());
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (original === undefined) {
      delete process.env.EYEPROTECT_DATA_DIR;
    } else {
      process.env.EYEPROTECT_DATA_DIR = original;
    }
  }
};

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

test('sanitizeTodos defaults completed to false for legacy entries', () => {
  const result = sanitizeTodos([{ id: 'a', text: 'legacy', createdAt: 1 }]);

  assert.equal(result[0].completed, false);
  assert.equal(result[0].completedAt, undefined);
});

test('sanitizeTodos keeps completed state and timestamp', () => {
  const result = sanitizeTodos([
    { id: 'a', text: 'done', createdAt: 1, completed: true, completedAt: 99 }
  ]);

  assert.equal(result[0].completed, true);
  assert.equal(result[0].completedAt, 99);
});

test('sanitizeTodos defaults missing priority to normal for legacy entries', () => {
  const result = sanitizeTodos([{ id: 'a', text: 'legacy', createdAt: 1 }]);

  assert.equal(result[0].priority, 'normal');
});

test('sanitizeTodos coerces invalid priority values to normal', () => {
  const result = sanitizeTodos([
    { id: 'a', text: 'x', createdAt: 1, priority: 'bogus' },
    { id: 'b', text: 'y', createdAt: 2, priority: 42 }
  ]);

  assert.equal(result[0].priority, 'normal');
  assert.equal(result[1].priority, 'normal');
});

test('sanitizeTodos preserves valid priority values', () => {
  const result = sanitizeTodos([
    { id: 'a', text: 'x', createdAt: 1, priority: 'urgent' },
    { id: 'b', text: 'y', createdAt: 2, priority: 'important' }
  ]);

  assert.equal(result[0].priority, 'urgent');
  assert.equal(result[1].priority, 'important');
});

test('sortTodosForDisplay keeps equal-priority pending in insertion order and sinks completed by completedAt', () => {
  const todos: TodoItem[] = [
    { id: '1', text: '早完成的', createdAt: 1, completed: true, completedAt: 100, priority: 'normal' },
    { id: '2', text: '未完成甲', createdAt: 2, completed: false, priority: 'normal' },
    { id: '3', text: '晚完成的', createdAt: 3, completed: true, completedAt: 300, priority: 'normal' },
    { id: '4', text: '未完成乙', createdAt: 4, completed: false, priority: 'normal' },
    { id: '5', text: '无时间戳', createdAt: 5, completed: true, priority: 'normal' }
  ];

  const sorted = sortTodosForDisplay(todos);
  assert.deepEqual(sorted.map((todo) => todo.id), ['2', '4', '5', '1', '3']);
});

test('sortTodosForDisplay sorts pending by priority (urgent first), then createdAt', () => {
  const todos: TodoItem[] = [
    { id: '1', text: '普通-旧', createdAt: 1, completed: false, priority: 'normal' },
    { id: '2', text: '紧急-新', createdAt: 10, completed: false, priority: 'urgent' },
    { id: '3', text: '重要', createdAt: 5, completed: false, priority: 'important' },
    { id: '4', text: '紧急-旧', createdAt: 3, completed: false, priority: 'urgent' }
  ];

  const sorted = sortTodosForDisplay(todos);
  assert.deepEqual(sorted.map((todo) => todo.id), ['4', '2', '3', '1']);
});

test('nextTodoPriority cycles normal → important → urgent → normal', () => {
  assert.equal(nextTodoPriority('normal'), 'important');
  assert.equal(nextTodoPriority('important'), 'urgent');
  assert.equal(nextTodoPriority('urgent'), 'normal');
});

test('addTodo and removeTodo emit todos-changed carrying the current list', () => {
  withTempStore((store) => {
    const events: TodoItem[][] = [];
    store.on('todos-changed', (todos) => events.push(todos));

    const created = store.addTodo('first');
    assert.equal(events.length, 1, 'addTodo emits todos-changed once');
    assert.deepEqual(events[0], created, 'payload matches the list returned by addTodo');
    assert.equal(events[0].length, 1);
    assert.equal(events[0][0].text, 'first');
    assert.equal(events[0][0].completed, false);
    assert.equal(events[0][0].priority, 'normal', 'new todos default to normal priority');

    store.removeTodo(created[0].id);
    assert.equal(events.length, 2, 'removeTodo emits todos-changed once more');
    assert.deepEqual(events[1], [], 'removing the last todo yields an empty list');
  });
});

test('addTodo truncates text at the shared TODO_TEXT_MAX', () => {
  withTempStore((store) => {
    const [todo] = store.addTodo('z'.repeat(TODO_TEXT_MAX + 10));
    assert.equal(todo.text.length, TODO_TEXT_MAX);
  });
});

test('toggleTodo flips completed, stamps and clears completedAt, and emits', () => {
  withTempStore((store) => {
    const events: TodoItem[][] = [];
    store.on('todos-changed', (todos) => events.push(todos));

    const [todo] = store.addTodo('toggle me');
    const completed = store.toggleTodo(todo.id);
    assert.equal(completed[0].completed, true);
    assert.equal(typeof completed[0].completedAt, 'number');

    const uncompleted = store.toggleTodo(todo.id);
    assert.equal(uncompleted[0].completed, false);
    assert.equal(uncompleted[0].completedAt, undefined);

    assert.equal(events.length, 3, 'add + two toggles each emit once');
  });
});

test('toggleTodo with an unknown id is a silent no-op', () => {
  withTempStore((store) => {
    store.addTodo('keep');
    const events: TodoItem[][] = [];
    store.on('todos-changed', (todos) => events.push(todos));

    const result = store.toggleTodo('nope');
    assert.equal(result.length, 1);
    assert.equal(result[0].completed, false);
    assert.equal(events.length, 0);
  });
});

test('updateTodo trims and truncates to TODO_TEXT_MAX, then emits', () => {
  withTempStore((store) => {
    const events: TodoItem[][] = [];
    store.on('todos-changed', (todos) => events.push(todos));

    const [todo] = store.addTodo('draft');
    const longText = `x${'y'.repeat(TODO_TEXT_MAX + 40)}`;
    const updated = store.updateTodo(todo.id, `  ${longText}  `);
    assert.equal(updated[0].text.length, TODO_TEXT_MAX);
    assert.equal(events.length, 2, 'add + update');
  });
});

test('updateTodo ignores empty text and unknown ids without emitting', () => {
  withTempStore((store) => {
    const [todo] = store.addTodo('keep');
    const events: TodoItem[][] = [];
    store.on('todos-changed', (todos) => events.push(todos));

    assert.equal(store.updateTodo(todo.id, '   ')[0].text, 'keep');
    assert.equal(store.updateTodo('nope', 'text').length, 1);
    assert.equal(events.length, 0);
  });
});

test('setTodoPriority updates the priority and emits todos-changed', () => {
  withTempStore((store) => {
    const events: TodoItem[][] = [];
    store.on('todos-changed', (todos) => events.push(todos));

    const [todo] = store.addTodo('prioritize me');
    assert.equal(todo.priority, 'normal');

    const updated = store.setTodoPriority(todo.id, 'urgent');
    assert.equal(updated[0].priority, 'urgent');
    assert.equal(events.length, 2, 'addTodo + setTodoPriority each emit once');
    assert.deepEqual(events[1], updated);
  });
});

test('setTodoPriority with an unknown id or invalid priority is a silent no-op', () => {
  withTempStore((store) => {
    store.addTodo('keep');
    const events: TodoItem[][] = [];
    store.on('todos-changed', (todos) => events.push(todos));

    const afterUnknown = store.setTodoPriority('nope', 'urgent');
    assert.equal(afterUnknown[0].priority, 'normal');

    const afterInvalid = store.setTodoPriority(
      afterUnknown[0].id,
      'bogus' as unknown as Parameters<SettingsStore['setTodoPriority']>[1]
    );
    assert.equal(afterInvalid[0].priority, 'normal');
    assert.equal(events.length, 0);
  });
});
