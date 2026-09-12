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

/**
 * The `system` dark block is a hand-maintained copy of the `[data-theme='dark']`
 * block (CSS has no way to share a declaration block across a media query). The
 * two silently drifted: the reminder glass material (--glass-panel and friends)
 * was added to light/dark but never to the system copy, so a user on
 * `theme: 'system'` with a dark OS got the LIGHT glass tokens on a dark card —
 * near-white text on a near-white panel, i.e. an unreadable reminder window.
 * `verify:ui-contract` only reads the light/dark blocks, so it could not catch
 * this; asserting set equality here makes any future drift a test failure.
 */
test('the system dark block mirrors the dark block token for token', () => {
  const themeCss = readFileSync(join(ROOT, 'styles', 'theme.css'), 'utf8');
  // Strip comments first: the blocks document themselves, and a comment that
  // happens to look like a declaration would otherwise be read as one.
  const withoutComments = themeCss.replace(/\/\*[\s\S]*?\*\//g, '');

  const declarations = (body: string): Map<string, string> => {
    const map = new Map<string, string>();
    const declaration = /(--[a-z0-9-]+)\s*:\s*([^;]+);/g;
    let match: RegExpExecArray | null;
    while ((match = declaration.exec(body)) !== null) map.set(match[1], match[2].trim());
    return map;
  };

  const darkBody = withoutComments.match(/:root\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/)?.[1];
  const systemDarkBody = withoutComments.match(
    /@media\s*\(prefers-color-scheme:\s*dark\)[\s\S]*?\[data-theme='system'\]\s*\{([\s\S]*?)\n\s*\}/
  )?.[1];
  assert.ok(darkBody, "theme.css must declare a [data-theme='dark'] block");
  assert.ok(systemDarkBody, "theme.css must declare a [data-theme='system'] block inside the dark media query");

  const dark = declarations(darkBody);
  const systemDark = declarations(systemDarkBody);
  const missing = [...dark.keys()].filter((name) => !systemDark.has(name));
  const extra = [...systemDark.keys()].filter((name) => !dark.has(name));
  const differing = [...dark.keys()]
    .filter((name) => systemDark.has(name) && systemDark.get(name) !== dark.get(name))
    .map((name) => `${name}: dark=${dark.get(name)} system=${systemDark.get(name)}`);

  assert.deepEqual(
    missing,
    [],
    `[data-theme='system'] dark block is missing tokens declared for [data-theme='dark']: ${missing.join(', ')}`
  );
  assert.deepEqual(
    extra,
    [],
    `[data-theme='system'] dark block declares tokens absent from [data-theme='dark']: ${extra.join(', ')}`
  );
  assert.deepEqual(differing, [], `system dark block disagrees with the dark block:\n${differing.join('\n')}`);
});
