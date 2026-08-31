import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CharacterService } from '../src/main/characterService';
import { TaskStore } from '../src/main/taskStore';

const withService = (run: (service: CharacterService, store: TaskStore) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-character-'));
  const now = new Date(2026, 7, 9, 9, 0, 0).getTime();
  try {
    const store = new TaskStore(dir);
    run(new CharacterService(store, () => now), store);
  } finally {
    TaskStore.closeAllForDirectory(dir);
    rmSync(dir, { recursive: true, force: true });
  }
};

test('daily candidate stays stable until it is collected or discarded', () => withService((service) => {
  const first = service.getState();
  const second = service.getState();
  assert.equal(first.candidate?.character.id, second.candidate?.character.id);
  assert.equal(first.candidate?.decision, 'pending');
  const collected = service.collectCandidate();
  assert.equal(collected.candidate?.decision, 'collected');
  assert.equal(collected.characters.length, 1);
  assert.equal(service.collectCandidate().characters.length, 1);
}));

test('appearance, material and accessory persist in SQLite', () => withService((service, store) => {
  const collected = service.collectCandidate();
  const id = collected.characters[0].id;
  service.setMaterial(id, 'cosmic');
  service.setAccessory(id, 'glasses');
  service.setFavorite(id, true);
  service.rename(id, '小星');
  const pinned = service.setAppearance('pinned', id);
  assert.equal(pinned.activeCharacterId, id);
  const reloaded = new CharacterService(store, () => new Date(2026, 7, 9, 12).getTime()).getState();
  const character = reloaded.characters[0];
  assert.equal(character.name, '小星');
  assert.equal(character.material, 'cosmic');
  assert.equal(character.accessory, 'glasses');
  assert.equal(character.favorite, true);
  assert.equal(reloaded.activeCharacterId, id);
}));

test('deleting a pinned character safely returns to daily random mode', () => withService((service) => {
  const id = service.collectCandidate().characters[0].id;
  service.setAppearance('pinned', id);
  const state = service.delete(id);
  assert.equal(state.characters.length, 0);
  assert.equal(state.appearanceMode, 'daily-random');
  assert.equal(state.pinnedCharacterId, null);
  assert.match(state.activeCharacterId, /^character-/);
}));
