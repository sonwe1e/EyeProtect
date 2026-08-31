import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseDailyActiveCharacter,
  createStarterCharacter,
  deriveCharacterRig,
  generateCharacter,
  localDateKey
} from '../src/shared/characters';
import type { CharacterCollectionState } from '../src/shared/types';

test('character generation is deterministic and derives a usable rig', () => {
  const first = generateCharacter('same-seed', 123);
  const second = generateCharacter('same-seed', 123);
  assert.deepEqual(first, second);
  assert.deepEqual(first.rig, deriveCharacterRig(first.recipe));
  assert.ok(first.recipe.bodyWidth >= 34 && first.recipe.bodyWidth <= 72);
  assert.ok(first.recipe.appendages.length <= 8);
  assert.ok(first.rig.actionPoints.length >= 1);
  for (const point of first.rig.actionPoints) {
    assert.ok(Number.isFinite(point.x));
    assert.ok(Number.isFinite(point.y));
  }
});

test('different seeds produce varied topology rather than pose-only variants', () => {
  const signatures = new Set(Array.from({ length: 20 }, (_, index) => {
    const character = generateCharacter(`seed-${index}`, index);
    return `${character.style}:${character.recipe.bodyWidth.toFixed(2)}:${character.recipe.appendages.length}:${character.recipe.attentionCount}:${character.recipe.pattern}`;
  }));
  assert.ok(signatures.size >= 18);
});

test('daily random selection is stable for a date and pinning overrides it', () => {
  const characters = [generateCharacter('one'), generateCharacter('two'), generateCharacter('three')];
  const state: CharacterCollectionState = {
    installSalt: 'installation', characters, candidate: null, appearanceMode: 'daily-random',
    pinnedCharacterId: null, activeCharacterId: createStarterCharacter().id
  };
  const date = localDateKey(new Date(2026, 7, 9, 12).getTime());
  assert.equal(chooseDailyActiveCharacter(state, date).id, chooseDailyActiveCharacter(state, date).id);
  state.appearanceMode = 'pinned';
  state.pinnedCharacterId = characters[1].id;
  assert.equal(chooseDailyActiveCharacter(state, date).id, characters[1].id);
});
