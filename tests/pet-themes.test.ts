import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BUILTIN_PET_THEME_NAMES,
  mergePetThemeDirs,
  type PetThemeDirInfo
} from '../src/main/petThemes';

test('mergePetThemeDirs keeps built-ins then lets user dirs override same id', () => {
  const builtin: PetThemeDirInfo[] = [
    { id: 'shiba', name: '治愈柴犬', dir: '/app/pet-themes/shiba' },
    { id: 'bunny', name: '粉耳白兔', dir: '/app/pet-themes/bunny' }
  ];
  const user: PetThemeDirInfo[] = [
    { id: 'bunny', name: 'bunny', dir: '/data/custom-pet/bunny' },
    { id: 'capy', name: '卡皮巴拉', dir: '/data/custom-pet/capy' }
  ];
  const merged = mergePetThemeDirs([builtin, user]);
  const byId = Object.fromEntries(merged.map((t) => [t.id, t]));
  assert.equal(byId.shiba.dir, '/app/pet-themes/shiba');
  assert.equal(byId.bunny.dir, '/data/custom-pet/bunny');
  assert.equal(byId.capy.name, '卡皮巴拉');
  assert.equal(merged.filter((t) => t.id === 'bunny').length, 1);
});

test('builtin display names cover independent dynamic characters', () => {
  assert.equal(BUILTIN_PET_THEME_NAMES.shiba, '治愈柴犬');
  assert.equal(BUILTIN_PET_THEME_NAMES.bunny, '粉耳白兔');
  assert.equal(BUILTIN_PET_THEME_NAMES.hamster, '软萌仓鼠');
  assert.equal(BUILTIN_PET_THEME_NAMES.default, '奋斗猫（默认）');
});

test('mergePetThemeDirs ignores empty ids', () => {
  const merged = mergePetThemeDirs([
    [{ id: '', name: 'x', dir: '/x' }, { id: 'hamster', name: '软萌仓鼠', dir: '/h' }]
  ]);
  assert.deepEqual(
    merged.map((t) => t.id),
    ['hamster']
  );
});
