import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');

test('NSIS upgrades preserve legacy install-directory data before the old uninstaller runs', () => {
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    build: { nsis: { include?: string } };
  };
  assert.equal(packageJson.build.nsis.include, 'build/installer.nsh');

  const includePath = resolve(root, packageJson.build.nsis.include);
  assert.equal(existsSync(includePath), true);
  const source = readFileSync(includePath, 'utf8');
  assert.match(source, /!macro customCheckAppRunning/);
  assert.match(source, /!macro customCheckAppRunning[\s\S]*?!insertmacro _CHECK_APP_RUNNING[\s\S]*?!insertmacro preserveEyeProtectData/);
  assert.match(source, /\$INSTDIR\\data/);
  assert.match(source, /\$APPDATA\\eye-protect-pet\\data/);
  assert.match(source, /robocopy\.exe/);
  assert.match(source, /Abort/);
});
