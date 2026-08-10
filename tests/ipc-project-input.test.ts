import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asProjectInput, asProjectUpdateInput } from '../src/main/ipcProjectInput';

test('project creation transport requires a string name', () => {
  assert.deepEqual(asProjectInput({ viewMode: 'board' }), {
    name: '',
    goal: undefined,
    viewMode: 'board',
    color: undefined,
    parentId: undefined
  });
});

test('project update transport preserves omission instead of inventing an empty name', () => {
  assert.deepEqual(asProjectUpdateInput({ viewMode: 'board' }), { viewMode: 'board' });
  assert.deepEqual(asProjectUpdateInput({ goal: null, color: null, parentId: null }), {
    goal: null,
    color: null,
    parentId: null
  });
});

test('project update transport drops unsupported values', () => {
  assert.deepEqual(asProjectUpdateInput({ name: 5, viewMode: 'grid', color: 8 }), {});
});
