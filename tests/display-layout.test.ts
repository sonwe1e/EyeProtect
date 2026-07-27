import assert from 'node:assert/strict';
import test from 'node:test';
import { getDisplayLayoutKey } from '../src/main/displayLayout';

test('display layout key is stable across display enumeration order', () => {
  const primary = {
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
    rotation: 0
  };
  const secondary = {
    bounds: { x: -2560, y: 0, width: 2560, height: 1440 },
    scaleFactor: 1.25,
    rotation: 0
  };
  assert.equal(
    getDisplayLayoutKey([primary, secondary]),
    getDisplayLayoutKey([secondary, primary])
  );
});

test('disconnect, scale and rotation produce distinct layout keys', () => {
  const base = {
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
    rotation: 0
  };
  const second = {
    bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
    rotation: 0
  };
  const twoDisplays = getDisplayLayoutKey([base, second]);
  assert.notEqual(twoDisplays, getDisplayLayoutKey([base]));
  assert.notEqual(
    twoDisplays,
    getDisplayLayoutKey([base, { ...second, scaleFactor: 1.25 }])
  );
  assert.notEqual(
    twoDisplays,
    getDisplayLayoutKey([base, { ...second, rotation: 90 }])
  );
});
