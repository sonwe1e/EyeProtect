import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const mainSource = readFileSync('src/main/index.ts', 'utf8');

test('legacy package has a distinct portable identity', () => {
  assert.equal(packageJson.version, '0.3.0');
  assert.equal(packageJson.build.appId, 'local.eyeprotect.legacy.v03');
  assert.equal(packageJson.build.productName, 'EyeProtect Legacy 0.3');
  assert.equal(
    packageJson.build.portable.artifactName,
    'EyeProtect-Legacy-${version}-win-x64.exe'
  );
});

test('legacy profile is set before the single-instance lock', () => {
  const profileCall = "app.setPath('userData', ensureLegacyProfileDir(getDataDir()));";
  const profile = mainSource.indexOf(profileCall);
  const lock = mainSource.indexOf('app.requestSingleInstanceLock()');
  assert.ok(profile >= 0, 'legacy userData path must be configured');
  assert.ok(lock > profile, 'profile must be configured before the lock');
});

test('legacy AppUserModelId is exact', () => {
  assert.match(mainSource, /app\.setAppUserModelId\('local\.eyeprotect\.legacy\.v03'\);/);
});
