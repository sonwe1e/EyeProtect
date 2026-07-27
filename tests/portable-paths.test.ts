import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveAppBaseDir,
  resolveLaunchExecutable,
  type RuntimePathInputs
} from '../src/main/settings';

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
