/**
 * 奋斗猫 custom GIF discovery helpers.
 * Pure functions so main-process IPC and unit tests share one policy: only the
 * user custom-pet root is loaded — multi-character skins are out of product.
 */
import { existsSync, readdirSync } from 'fs';

export const PET_DISPLAY_NAME = '奋斗猫';

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

/** The only pet theme: user GIFs in custom-pet root personalize 奋斗猫. */
export const listRootTheme = (root: string): PetThemeDirInfo[] => {
  if (!themeDirHasAssets(root)) return [];
  return [{ id: 'default', name: PET_DISPLAY_NAME, dir: root }];
};
