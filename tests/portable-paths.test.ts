import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import {
  getDataDir,
  getLegacyProfileDir,
  LEGACY_DATA_DIR_NAME,
  LEGACY_STARTUP_SHORTCUT,
  resolveAppBaseDir,
  resolveLaunchExecutable,
  type RuntimePathInputs
} from '../src/main/settings';

const packaged = {
  isPackaged: true,
  execPath: 'C:\\Users\\Tester\\AppData\\Local\\Temp\\legacy\\EyeProtect.exe',
  cwd: 'I:\\WorkStations\\EyeProtect'
} satisfies RuntimePathInputs;

test('portable data uses the original executable folder', () => {
  assert.equal(
    join(
      resolveAppBaseDir({ ...packaged, portableExecutableDir: 'D:\\Tools\\EyeProtect Legacy' }),
      LEGACY_DATA_DIR_NAME
    ),
    'D:\\Tools\\EyeProtect Legacy\\data-legacy-v0.3'
  );
});

test('packaged path falls back to the unpacked executable folder', () => {
  assert.equal(
    resolveAppBaseDir(packaged),
    'C:\\Users\\Tester\\AppData\\Local\\Temp\\legacy'
  );
});

test('development path stays under the working directory', () => {
  assert.equal(
    resolveAppBaseDir({
      ...packaged,
      isPackaged: false,
      portableExecutableDir: 'D:\\Ignored'
    }),
    packaged.cwd
  );
});

test('explicit data directory override remains exact', () => {
  const previous = process.env.EYEPROTECT_DATA_DIR;
  process.env.EYEPROTECT_DATA_DIR = 'D:\\Tests\\legacy-data';
  try {
    assert.equal(getDataDir(), 'D:\\Tests\\legacy-data');
  } finally {
    if (previous === undefined) delete process.env.EYEPROTECT_DATA_DIR;
    else process.env.EYEPROTECT_DATA_DIR = previous;
  }
});

test('profile and startup names are isolated from current EyeProtect', () => {
  assert.equal(
    getLegacyProfileDir('D:\\Tools\\EyeProtect Legacy\\data-legacy-v0.3'),
    'D:\\Tools\\EyeProtect Legacy\\data-legacy-v0.3\\electron-profile'
  );
  assert.equal(LEGACY_STARTUP_SHORTCUT, 'EyeProtect Legacy 0.3.lnk');
});

test('startup targets the original portable executable', () => {
  assert.equal(
    resolveLaunchExecutable({
      ...packaged,
      portableExecutableFile: 'D:\\Tools\\EyeProtect Legacy\\EyeProtect-Legacy-0.3.0-win-x64.exe'
    }),
    'D:\\Tools\\EyeProtect Legacy\\EyeProtect-Legacy-0.3.0-win-x64.exe'
  );
  assert.equal(resolveLaunchExecutable(packaged), packaged.execPath);
});
