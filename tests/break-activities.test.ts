import assert from 'node:assert/strict';
import test from 'node:test';
import { BREAK_ACTIVITIES, pickActivityIds } from '../src/shared/breakActivities';

test('pickActivityIds returns one activity per involved kind', () => {
  const picked = pickActivityIds('combined', [], () => 0.5);
  assert.equal(picked.length, 2);
  assert.ok(picked[0].startsWith('eye'));
  assert.ok(picked[1].startsWith('walk'));
});

test('pickActivityIds avoids recent activities while alternatives exist', () => {
  const [first] = pickActivityIds('eye', [], () => 0);
  const [second] = pickActivityIds('eye', [first], () => 0);
  assert.notEqual(second, first);
});

test('pickActivityIds falls back to the whole pool when everything is recent', () => {
  const recent = BREAK_ACTIVITIES.map((activity) => activity.id);
  const picked = pickActivityIds('eye', recent, () => 0);
  assert.equal(picked.length, 1);
  assert.ok(picked[0].startsWith('eye'), 'a valid eye activity is still returned');
});

test('pickActivityIds stays in bounds for a random() of 1', () => {
  const picked = pickActivityIds('walk', [], () => 1);
  assert.equal(picked.length, 1);
  assert.ok(picked[0].startsWith('walk'));
});
