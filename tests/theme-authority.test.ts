/**
 * Theme runtime authority guard (USERPLAN 1.2 PR0).
 *
 * The workbench used to have TWO theme authorities: styles/theme.css
 * (`color-scheme` per [data-theme]) and App.tsx setting
 * `document.documentElement.style.colorScheme`. Inline styles always win the
 * cascade, so the JS side silently overruled the CSS design tokens — the
 * packaged smoke couldn't tell which authority produced the visible theme.
 *
 * CSS is now the single authority. This test fails if an inline colorScheme
 * assignment returns to the renderer, or if the CSS loses coverage of any
 * theme mode.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer', 'src');

test('renderer never assigns an inline colorScheme (CSS is the single authority)', () => {
  const appSource = readFileSync(join(ROOT, 'App.tsx'), 'utf8');
  assert.ok(
    !/style\.colorScheme\s*=/.test(appSource),
    'App.tsx must not set style.colorScheme — theme.css owns color-scheme via [data-theme]'
  );
});

test('theme.css covers light, dark and system modes with color-scheme', () => {
  const themeCss = readFileSync(join(ROOT, 'styles', 'theme.css'), 'utf8');
  assert.match(themeCss, /:root[^{]*\{[^}]*color-scheme:\s*light/s, 'light mode');
  assert.match(themeCss, /\[data-theme='dark'\][^{]*\{[^}]*color-scheme:\s*dark/s, 'dark mode');
  assert.match(
    themeCss,
    /prefers-color-scheme:\s*dark[\s\S]*?\[data-theme='system'\][^{]*\{[^}]*color-scheme:\s*dark/s,
    'system mode follows the OS preference'
  );
});
