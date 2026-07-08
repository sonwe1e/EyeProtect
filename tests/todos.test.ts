import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeTodos } from '../src/shared/types';

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
