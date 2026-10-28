/** Artwork identities, with different silhouettes and gestures rather than recolored cats. */
export const PET_COMPANIONS = ['fighter', 'otter', 'penguin', 'pixel', 'custom'] as const;
export type PetCompanion = typeof PET_COMPANIONS[number];

export const PET_COMPANION_DETAILS: Record<PetCompanion, { name: string; description: string; interaction: string }> = {
  fighter: { name: '火力奋斗猫', description: '原作动图 · 火焰敲键盘', interaction: '元气挥爪' },
  otter: { name: '泡泡水獭', description: '像素伙伴 · 抱贝壳吹泡泡', interaction: '吹一个小泡泡' },
  penguin: { name: '星际企鹅', description: '像素太空服 · 接住小流星', interaction: '接住一颗流星' },
  pixel: { name: '像素橘猫', description: '复古像素 · 四套小衣服', interaction: '挥爪打招呼' },
  custom: { name: '我的动图', description: '使用自定义文件夹中的角色', interaction: '随机互动' }
};

export const isPetCompanion = (value: unknown): value is PetCompanion =>
  typeof value === 'string' && (PET_COMPANIONS as readonly string[]).includes(value);

/** Every source asset is distributed with the app; no dependency on local data. */
export const fighterArtwork = (action: string): string => {
  const state = ['sleep', 'eye', 'combined', 'breathe', 'blink', 'gaze'].includes(action) ? 'sleep'
    // The GIF artwork cannot draw a glass, so drinking degrades to the generic
    // "click" reaction: the moment is still announced, only without the cup.
    : ['react', 'celebrate', 'sip'].includes(action) ? 'click'
      : ['fidget', 'stretch', 'walk'].includes(action) ? 'fidget' : 'idle';
  return `./assets/pets/fighter/${state}.gif`;
};
