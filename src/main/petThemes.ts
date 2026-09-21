/**
 * Built-in + user custom pet theme discovery helpers.
 * Pure functions so main-process IPC and unit tests share one merge policy.
 */
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

export const BUILTIN_PET_THEME_NAMES: Record<string, string> = {
  shiba: '治愈柴犬',
  bunny: '粉耳白兔',
  hamster: '软萌仓鼠',
  default: '奋斗猫（默认）',
  // Legacy recolored folder ids keep readable labels if still present on disk.
  dog: '治愈柴犬',
  rabbit: '粉耳白兔'
};

export type PetThemeDirInfo = {
  id: string;
  name: string;
  dir: string;
};

const isImageFile = (filename: string): boolean => {
  const lower = filename.toLowerCase();
  return (
    lower.endsWith('.gif') ||
    lower.endsWith('.png') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg')
  );
};

/** True when a directory contains at least one image asset. */
export const themeDirHasAssets = (dir: string): boolean => {
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir, { withFileTypes: true }).some(
      (entry) => entry.isFile() && isImageFile(entry.name)
    );
  } catch {
    return false;
  }
};

/**
 * Merge built-in theme dirs with user custom-pet dirs.
 * Later sources override earlier ones on the same id, so user folders win.
 */
export const mergePetThemeDirs = (
  sources: PetThemeDirInfo[][]
): PetThemeDirInfo[] => {
  const map = new Map<string, PetThemeDirInfo>();
  for (const source of sources) {
    for (const theme of source) {
      if (!theme.id) continue;
      map.set(theme.id, theme);
    }
  }
  return [...map.values()];
};

export const listThemeDirsIn = (
  root: string,
  nameLookup: Record<string, string> = BUILTIN_PET_THEME_NAMES
): PetThemeDirInfo[] => {
  if (!existsSync(root)) return [];
  const found: PetThemeDirInfo[] = [];
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      if (!themeDirHasAssets(dir)) continue;
      found.push({
        id: entry.name,
        name: nameLookup[entry.name] ?? entry.name,
        dir
      });
    }
  } catch {
    return [];
  }
  return found;
};

export const listRootTheme = (
  root: string,
  id = 'default',
  nameLookup: Record<string, string> = BUILTIN_PET_THEME_NAMES
): PetThemeDirInfo[] => {
  if (!themeDirHasAssets(root)) return [];
  return [{ id, name: nameLookup[id] ?? id, dir: root }];
};
