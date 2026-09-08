import { createStarterCharacter } from './characters';
import type { CollectibleCharacter } from './types';

export const PIXEL_ANIMALS = ['cat', 'dog', 'rabbit'] as const;
export type PixelAnimal = typeof PIXEL_ANIMALS[number];
export const PIXEL_ANIMAL_NAMES: Record<PixelAnimal, string> = { cat: '橘猫', dog: '小狗', rabbit: '白兔' };

export const createPixelAnimal = (animal: PixelAnimal): CollectibleCharacter => ({
  ...createStarterCharacter(), id: `builtin:${animal}`, name: PIXEL_ANIMAL_NAMES[animal], style: 'pixel'
});

export const pixelAnimalFromId = (id: string): PixelAnimal | null =>
  PIXEL_ANIMALS.find((animal) => id === `builtin:${animal}`) ?? null;
