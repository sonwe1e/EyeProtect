import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { isTrustedRendererUrl } from '../src/main/security';

const packagedIndex = join('I:\\', 'EyeProtect', 'out', 'renderer', 'index.html');
const packagedUrl = pathToFileURL(packagedIndex).href;

test('packaged renderer accepts only the known index views', () => {
  for (const hash of ['', '#pet', '#settings', '#panel', '#bubble', '#alert', '#workbench']) {
    assert.equal(isTrustedRendererUrl(`${packagedUrl}${hash}`, undefined, packagedIndex), true);
  }

  assert.equal(isTrustedRendererUrl(`${packagedUrl}#unknown`, undefined, packagedIndex), false);
  assert.equal(
    isTrustedRendererUrl(
      pathToFileURL(join('I:\\', 'EyeProtect', 'out', 'renderer', 'other.html')).href,
      undefined,
      packagedIndex
    ),
    false
  );
});

test('development renderer rejects arbitrary same-origin paths and external origins', () => {
  const rendererUrl = 'http://127.0.0.1:5173/';
  assert.equal(
    isTrustedRendererUrl('http://127.0.0.1:5173/#settings', rendererUrl, packagedIndex),
    true
  );
  assert.equal(
    isTrustedRendererUrl('http://127.0.0.1:5173/other#settings', rendererUrl, packagedIndex),
    false
  );
  assert.equal(
    isTrustedRendererUrl('https://example.com/#settings', rendererUrl, packagedIndex),
    false
  );
});

test('renderer trust rejects malformed URLs, credentials and query variants', () => {
  const rendererUrl = 'http://127.0.0.1:5173/';
  assert.equal(isTrustedRendererUrl('not a url', rendererUrl, packagedIndex), false);
  assert.equal(
    isTrustedRendererUrl('http://user:pass@127.0.0.1:5173/#pet', rendererUrl, packagedIndex),
    false
  );
  assert.equal(
    isTrustedRendererUrl('http://127.0.0.1:5173/?debug=1#pet', rendererUrl, packagedIndex),
    false
  );
});
