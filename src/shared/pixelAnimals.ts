/**
 * The single built-in pixel companion (奋斗猫). Settings, the pet window and the
 * alert window all derive the only animal id from this list.
 */
export const PIXEL_ANIMALS = ['cat'] as const;

export type PixelAnimal = typeof PIXEL_ANIMALS[number];

export const PIXEL_ANIMAL_NAMES: Record<PixelAnimal, string> = {
  cat: '奋斗猫'
};

/** Narrows an untrusted persisted value (settings.json, backups) to an animal. */
export const isPixelAnimal = (value: unknown): value is PixelAnimal =>
  typeof value === 'string' && (PIXEL_ANIMALS as readonly string[]).includes(value);
