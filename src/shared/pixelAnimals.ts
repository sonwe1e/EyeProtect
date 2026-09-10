/**
 * The three built-in pixel companions. This is the single source of truth for
 * which animals exist: the settings schema, the sanitiser, the pet window and
 * the alert window all derive from this list.
 */
export const PIXEL_ANIMALS = ['cat', 'dog', 'rabbit'] as const;

export type PixelAnimal = typeof PIXEL_ANIMALS[number];

export const PIXEL_ANIMAL_NAMES: Record<PixelAnimal, string> = {
  cat: '橘猫',
  dog: '小狗',
  rabbit: '白兔'
};

/** Narrows an untrusted persisted value (settings.json, backups) to an animal. */
export const isPixelAnimal = (value: unknown): value is PixelAnimal =>
  typeof value === 'string' && (PIXEL_ANIMALS as readonly string[]).includes(value);
