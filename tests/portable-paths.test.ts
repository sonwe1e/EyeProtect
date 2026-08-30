import assert from 'node:assert/strict';
import test from 'node:test';
import {
  migrateLegacyDataDirectory,
  resolveAppBaseDir,
  resolveDataDir,
  resolveLaunchExecutable,
  type RuntimePathInputs
} from '../src/main/settings';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const baseInputs = {
  isPackaged: true,
  execPath: 'C:\\Users\\Tester\\AppData\\Local\\Temp\\portable\\EyeProtect.exe',
  cwd: 'I:\\WorkStations\\EyeProtect'
} satisfies RuntimePathInputs;

test('development uses the working directory regardless of portable environment values', () => {
  assert.equal(
    resolveAppBaseDir({
      ...baseInputs,
      isPackaged: false,
      portableExecutableDir: 'D:\\Apps\\EyeProtect'
    }),
    baseInputs.cwd
  );
});

test('packaged portable data uses the original executable directory', () => {
  assert.equal(
    resolveAppBaseDir({
      ...baseInputs,
      portableExecutableDir: '  D:\\Portable Apps\\EyeProtect  '
    }),
    'D:\\Portable Apps\\EyeProtect'
  );
});

test('packaged data falls back to the runtime executable directory', () => {
  assert.equal(resolveAppBaseDir(baseInputs), 'C:\\Users\\Tester\\AppData\\Local\\Temp\\portable');
});

test('installed builds keep data in the stable Electron user-data directory', () => {
  assert.equal(
    resolveDataDir({
      ...baseInputs,
      userDataDir: 'C:\\Users\\Tester\\AppData\\Roaming\\eye-protect-pet'
    }),
    'C:\\Users\\Tester\\AppData\\Roaming\\eye-protect-pet\\data'
  );
});

test('portable and development builds preserve their existing local data directories', () => {
  assert.equal(
    resolveDataDir({
      ...baseInputs,
      portableExecutableDir: 'D:\\Portable Apps\\EyeProtect',
      userDataDir: 'C:\\Users\\Tester\\AppData\\Roaming\\eye-protect-pet'
    }),
    'D:\\Portable Apps\\EyeProtect\\data'
  );
  assert.equal(
    resolveDataDir({
      ...baseInputs,
      isPackaged: false,
      userDataDir: 'C:\\Users\\Tester\\AppData\\Roaming\\eye-protect-pet'
    }),
    'I:\\WorkStations\\EyeProtect\\data'
  );
});

test('legacy installed data migrates atomically without deleting the rollback source', () => {
  const root = mkdtempSync(join(tmpdir(), 'eyeprotect-data-migration-'));
  try {
    const source = join(root, 'legacy-data');
    const target = join(root, 'profile', 'data');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'settings.json'), '{"theme":"dark"}', 'utf8');
    writeFileSync(join(source, 'eyeprotect.db'), 'database', 'utf8');

    assert.equal(migrateLegacyDataDirectory(source, target), true);
    assert.equal(readFileSync(join(target, 'settings.json'), 'utf8'), '{"theme":"dark"}');
    assert.equal(readFileSync(join(target, 'eyeprotect.db'), 'utf8'), 'database');
    assert.equal(readFileSync(join(source, 'settings.json'), 'utf8'), '{"theme":"dark"}');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an existing stable data directory always wins over legacy data', () => {
  const root = mkdtempSync(join(tmpdir(), 'eyeprotect-data-conflict-'));
  try {
    const source = join(root, 'legacy-data');
    const target = join(root, 'profile', 'data');
    mkdirSync(source, { recursive: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(join(source, 'settings.json'), 'legacy', 'utf8');
    writeFileSync(join(target, 'settings.json'), 'stable', 'utf8');

    assert.equal(migrateLegacyDataDirectory(source, target), false);
    assert.equal(readFileSync(join(target, 'settings.json'), 'utf8'), 'stable');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('empty and relative portable directories cannot override the packaged fallback', () => {
  for (const portableExecutableDir of ['', '   ', '.\\EyeProtect']) {
    assert.equal(
      resolveAppBaseDir({ ...baseInputs, portableExecutableDir }),
      'C:\\Users\\Tester\\AppData\\Local\\Temp\\portable'
    );
  }
});

test('startup uses the original portable executable file', () => {
  assert.equal(
    resolveLaunchExecutable({
      ...baseInputs,
      portableExecutableFile: '  D:\\Portable Apps\\EyeProtect\\EyeProtect-0.5.1-win-x64.exe  '
    }),
    'D:\\Portable Apps\\EyeProtect\\EyeProtect-0.5.1-win-x64.exe'
  );
});

test('startup falls back to process.execPath for missing or invalid portable file values', () => {
  for (const portableExecutableFile of [undefined, '', 'EyeProtect.exe']) {
    assert.equal(
      resolveLaunchExecutable({ ...baseInputs, portableExecutableFile }),
      baseInputs.execPath
    );
  }
});
