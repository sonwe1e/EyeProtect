import type {
  CharacterCollectionState,
  CharacterPersonality,
  CharacterRecipe,
  CharacterRig,
  CharacterStyle,
  CollectibleCharacter
} from './types';

export const CHARACTER_GENERATOR_VERSION = 1;
export const CHARACTER_MATERIALS = ['paper', 'glow', 'plush', 'candy', 'cosmic'] as const;
const STYLES: CharacterStyle[] = ['soft', 'doodle', 'pixel', 'toy'];
const PERSONALITIES: CharacterPersonality[] = ['curious', 'mischievous', 'dreamy', 'brave', 'gentle'];
const ACTIONS = ['peek', 'bounce', 'wave', 'orbit', 'wiggle', 'hide', 'spark', 'stretch'];
const FIRST_NAMES = ['泡泡', '团团', '闪闪', '咕噜', '点点', '桃桃', '云仔', '茸茸', '跳跳', '米粒'];
const LAST_NAMES = ['漫游者', '小队长', '收藏家', '瞌睡虫', '探险家', '发明家', '守望员', '追光者'];
const PALETTES: Array<[string, string, string]> = [
  ['#65c7b4', '#e9fff9', '#174f49'],
  ['#ff9f68', '#fff0cf', '#713d34'],
  ['#9d8cff', '#f2edff', '#392f70'],
  ['#67a9ff', '#e8f4ff', '#23486f'],
  ['#f078aa', '#ffeaf3', '#6d2948'],
  ['#c7d95b', '#f8ffd9', '#46521d']
];

// Civil-date keys come from the single sanctioned calendar module (ADR-003);
// this re-export keeps the historical `characters.localDateKey` import working.
export { localDateKey } from './calendar';

const hash = (value: string): number => {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
};

const randomFor = (seed: string): (() => number) => {
  let state = hash(seed) || 0x9e3779b9;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const choose = <T>(values: readonly T[], random: () => number): T =>
  values[Math.min(values.length - 1, Math.floor(random() * values.length))];

export const deriveCharacterRig = (recipe: CharacterRecipe): CharacterRig => {
  const center = { x: 50, y: 52 };
  const attention = { x: 50, y: 45 - recipe.bodyHeight * 0.08 };
  const actionPoints = recipe.appendages.map((appendage) => {
    const radians = appendage.angle * Math.PI / 180;
    return {
      x: center.x + Math.cos(radians) * appendage.length,
      y: center.y + Math.sin(radians) * appendage.length
    };
  });
  if (actionPoints.length === 0) actionPoints.push({ x: 50, y: 28 });
  return { center, attention, locomotionY: Math.min(90, 52 + recipe.bodyHeight / 2), actionPoints };
};

export const generateCharacter = (seed: string, createdAt: number = Date.now()): CollectibleCharacter => {
  const random = randomFor(`${CHARACTER_GENERATOR_VERSION}:${seed}`);
  const appendageCount = Math.floor(random() * 9);
  const palette = choose(PALETTES, random);
  const recipe: CharacterRecipe = {
    bodyWidth: 34 + random() * 38,
    bodyHeight: 30 + random() * 42,
    bodyRoundness: 20 + random() * 70,
    bodyTilt: -12 + random() * 24,
    attentionCount: Math.floor(random() * 5),
    attentionSpread: 5 + random() * 15,
    appendages: Array.from({ length: appendageCount }, (_, index) => ({
      angle: (360 / Math.max(1, appendageCount)) * index - 20 + random() * 40,
      length: 14 + random() * 23,
      width: 2 + random() * 6,
      tipSize: 3 + random() * 8,
      bend: -10 + random() * 20
    })),
    orbitCount: Math.floor(random() * 4),
    pattern: choose(['none', 'spots', 'stripes', 'sparkles'] as const, random),
    palette
  };
  const personality = choose(PERSONALITIES, random);
  const firstAction = choose(ACTIONS, random);
  const secondAction = choose(ACTIONS.filter((action) => action !== firstAction), random);
  const fingerprint = hash(JSON.stringify(recipe)).toString(36);
  return {
    id: `character-${fingerprint}`,
    seed,
    generatorVersion: CHARACTER_GENERATOR_VERSION,
    name: `${choose(FIRST_NAMES, random)}·${choose(LAST_NAMES, random)}`,
    style: choose(STYLES, random),
    personality,
    favoriteActions: [firstAction, secondAction],
    recipe,
    rig: deriveCharacterRig(recipe),
    material: 'paper',
    accessory: 'none',
    favorite: false,
    createdAt
  };
};

export const createStarterCharacter = (): CollectibleCharacter =>
  generateCharacter('eyeprotect-starter', 0);

export const chooseDailyActiveCharacter = (
  state: CharacterCollectionState,
  date: string
): CollectibleCharacter => {
  const starter = createStarterCharacter();
  if (state.appearanceMode === 'pinned') {
    return state.characters.find((entry) => entry.id === state.pinnedCharacterId) ?? starter;
  }
  const pool = state.characters.length > 0 ? state.characters : [starter];
  return pool[hash(`${state.installSalt}:${date}`) % pool.length];
};
