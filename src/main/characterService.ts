import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  chooseDailyActiveCharacter,
  createStarterCharacter,
  generateCharacter,
  localDateKey
} from '../shared/characters';
import type {
  CharacterAppearanceMode,
  CharacterCollectionState,
  CharacterMaterial,
  CollectibleCharacter,
  PetAccessory
} from '../shared/types';
import type { TaskStore } from './taskStore';

export class CharacterService extends EventEmitter {
  constructor(
    private readonly store: TaskStore,
    private readonly now: () => number = Date.now
  ) {
    super();
  }

  getState(): CharacterCollectionState {
    const now = this.now();
    const date = localDateKey(now);
    const stored = this.store.getCharacterCollectionState();
    const state = this.sanitizeState(stored);
    let changed = stored === null;
    if (!state.candidate || state.candidate.localDate !== date) {
      const character = this.uniqueDailyCharacter(state, date, now);
      state.candidate = { localDate: date, character, decision: 'pending' };
      changed = true;
    }
    const active = chooseDailyActiveCharacter(state, date);
    if (state.activeCharacterId !== active.id) {
      state.activeCharacterId = active.id;
      changed = true;
    }
    if (changed) this.store.replaceCharacterCollectionState(state);
    return structuredClone(state);
  }

  getActiveCharacter(): CollectibleCharacter {
    const state = this.getState();
    return state.characters.find((entry) => entry.id === state.activeCharacterId) ?? createStarterCharacter();
  }

  collectCandidate(): CharacterCollectionState {
    const state = this.getState();
    if (state.candidate?.decision === 'pending') {
      const candidate = state.candidate.character;
      if (!state.characters.some((entry) => entry.id === candidate.id)) state.characters.push(candidate);
      state.candidate.decision = 'collected';
    }
    return this.save(state);
  }

  discardCandidate(): CharacterCollectionState {
    const state = this.getState();
    if (state.candidate?.decision === 'pending') state.candidate.decision = 'discarded';
    return this.save(state);
  }

  rename(id: string, name: string): CharacterCollectionState {
    return this.updateCharacter(id, (character) => ({ ...character, name: name.trim().slice(0, 32) || character.name }));
  }

  setFavorite(id: string, favorite: boolean): CharacterCollectionState {
    return this.updateCharacter(id, (character) => ({ ...character, favorite }));
  }

  setMaterial(id: string, material: CharacterMaterial): CharacterCollectionState {
    return this.updateCharacter(id, (character) => ({ ...character, material }));
  }

  setAccessory(id: string, accessory: PetAccessory): CharacterCollectionState {
    return this.updateCharacter(id, (character) => ({ ...character, accessory }));
  }

  delete(id: string): CharacterCollectionState {
    const state = this.getState();
    state.characters = state.characters.filter((entry) => entry.id !== id);
    if (state.pinnedCharacterId === id) {
      state.pinnedCharacterId = null;
      state.appearanceMode = 'daily-random';
    }
    state.activeCharacterId = chooseDailyActiveCharacter(state, localDateKey(this.now())).id;
    return this.save(state);
  }

  setAppearance(mode: CharacterAppearanceMode, id: string | null = null): CharacterCollectionState {
    const state = this.getState();
    const validId = id && state.characters.some((entry) => entry.id === id) ? id : null;
    state.appearanceMode = mode === 'pinned' && validId ? 'pinned' : 'daily-random';
    state.pinnedCharacterId = state.appearanceMode === 'pinned' ? validId : null;
    state.activeCharacterId = chooseDailyActiveCharacter(state, localDateKey(this.now())).id;
    return this.save(state);
  }

  replaceState(input: CharacterCollectionState | null): CharacterCollectionState {
    return this.save(this.sanitizeState(input));
  }

  private updateCharacter(
    id: string,
    update: (character: CollectibleCharacter) => CollectibleCharacter
  ): CharacterCollectionState {
    const state = this.getState();
    state.characters = state.characters.map((entry) => entry.id === id ? update(entry) : entry);
    return this.save(state);
  }

  private save(state: CharacterCollectionState): CharacterCollectionState {
    const active = chooseDailyActiveCharacter(state, localDateKey(this.now()));
    state.activeCharacterId = active.id;
    const saved = this.store.replaceCharacterCollectionState(state);
    this.emit('changed', saved);
    return saved;
  }

  private sanitizeState(input: CharacterCollectionState | null): CharacterCollectionState {
    const starter = createStarterCharacter();
    if (!input || typeof input.installSalt !== 'string' || !Array.isArray(input.characters)) {
      return {
        installSalt: randomUUID(),
        characters: [],
        candidate: null,
        appearanceMode: 'daily-random',
        pinnedCharacterId: null,
        activeCharacterId: starter.id
      };
    }
    const characters = input.characters
      .map((entry) => this.sanitizeCharacter(entry))
      .filter((entry): entry is CollectibleCharacter => entry !== null)
      .filter((entry, index, all) => all.findIndex((candidate) => candidate.id === entry.id) === index);
    const candidateCharacter = input.candidate?.character
      ? this.sanitizeCharacter(input.candidate.character)
      : null;
    const candidate = candidateCharacter && typeof input.candidate?.localDate === 'string'
      ? {
          localDate: input.candidate.localDate,
          character: candidateCharacter,
          decision:
            input.candidate.decision === 'collected' || input.candidate.decision === 'discarded'
              ? input.candidate.decision
              : 'pending' as const
        }
      : null;
    return {
      installSalt: input.installSalt,
      characters,
      candidate,
      appearanceMode: input.appearanceMode === 'pinned' ? 'pinned' : 'daily-random',
      pinnedCharacterId: typeof input.pinnedCharacterId === 'string' ? input.pinnedCharacterId : null,
      activeCharacterId: typeof input.activeCharacterId === 'string' ? input.activeCharacterId : starter.id
    };
  }

  private sanitizeCharacter(input: unknown): CollectibleCharacter | null {
    if (!input || typeof input !== 'object') return null;
    const candidate = input as Partial<CollectibleCharacter>;
    if (typeof candidate.seed !== 'string' || !candidate.seed || !Number.isFinite(candidate.createdAt)) {
      return null;
    }
    const generated = generateCharacter(candidate.seed, candidate.createdAt);
    const material: CharacterMaterial =
      candidate.material === 'glow' || candidate.material === 'plush' ||
      candidate.material === 'candy' || candidate.material === 'cosmic'
        ? candidate.material
        : 'paper';
    const accessory: PetAccessory =
      candidate.accessory === 'cup' || candidate.accessory === 'glasses' || candidate.accessory === 'leaf'
        ? candidate.accessory
        : 'none';
    return {
      ...generated,
      name: typeof candidate.name === 'string' && candidate.name.trim()
        ? candidate.name.trim().slice(0, 32)
        : generated.name,
      material,
      accessory,
      favorite: candidate.favorite === true
    };
  }

  private uniqueDailyCharacter(state: CharacterCollectionState, date: string, now: number): CollectibleCharacter {
    const used = new Set(state.characters.map((entry) => entry.id));
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const candidate = generateCharacter(`${state.installSalt}:${date}:${attempt}`, now);
      if (!used.has(candidate.id)) return candidate;
    }
    return generateCharacter(`${state.installSalt}:${date}:${randomUUID()}`, now);
  }
}
