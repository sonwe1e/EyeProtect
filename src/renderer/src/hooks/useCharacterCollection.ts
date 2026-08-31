import { useEffect, useState } from 'react';
import { createStarterCharacter } from '../../../shared/characters';
import type { CharacterCollectionState, CollectibleCharacter } from '../../../shared/types';

const initialState = (): CharacterCollectionState => {
  const starter = createStarterCharacter();
  return {
    installSalt: 'loading',
    characters: [],
    candidate: null,
    appearanceMode: 'daily-random',
    pinnedCharacterId: null,
    activeCharacterId: starter.id
  };
};

export const useCharacterCollection = (): CharacterCollectionState => {
  const [state, setState] = useState<CharacterCollectionState>(initialState);
  useEffect(() => {
    void window.eyeProtect.getCharacterCollection().then(setState);
    return window.eyeProtect.onCharacterCollectionChanged(setState);
  }, []);
  return state;
};

export const activeCharacterFrom = (state: CharacterCollectionState): CollectibleCharacter =>
  state.characters.find((entry) => entry.id === state.activeCharacterId) ?? createStarterCharacter();
