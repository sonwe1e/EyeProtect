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

/** Outfits for the same companion; all are available without unlocks. */
export const PET_OUTFITS = ['classic', 'coffee', 'explorer', 'stargazer'] as const;
export type PetOutfit = typeof PET_OUTFITS[number];

export const PET_OUTFIT_DETAILS: Record<PetOutfit, { name: string; description: string; interaction: string }> = {
  classic: { name: '奋斗日常', description: '熟悉的橘猫，轻装陪你工作', interaction: '挥爪打招呼' },
  coffee: { name: '咖啡时光', description: '小围裙、奶泡杯，慢慢来就好', interaction: '捧杯喝一口' },
  explorer: { name: '森林探险', description: '软檐帽、小挎包，好奇心满格', interaction: '举起望远镜' },
  stargazer: { name: '星夜魔法', description: '星星帽、夜空披风，藏一点魔法', interaction: '挥动星星棒' }
};

export const isPetOutfit = (value: unknown): value is PetOutfit =>
  typeof value === 'string' && (PET_OUTFITS as readonly string[]).includes(value);
