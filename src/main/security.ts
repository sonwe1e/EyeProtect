import { pathToFileURL } from 'node:url';

const ALLOWED_RENDERER_HASHES = new Set([
  '',
  '#pet',
  '#settings',
  '#bubble',
  '#alert',
  '#workbench'
]);

const normalizedPathname = (value: string): string =>
  decodeURIComponent(value).replace(/\/+$/, '').toLowerCase();

/**
 * Accept only the renderer entry point owned by this application. Hashes are
 * view selectors; arbitrary same-origin dev routes and sibling file:// pages
 * are not trusted IPC callers.
 */
export const isTrustedRendererUrl = (
  value: string,
  rendererUrl: string | undefined,
  packagedIndexPath: string
): boolean => {
  try {
    const candidate = new URL(value);
    const expected = rendererUrl ? new URL(rendererUrl) : pathToFileURL(packagedIndexPath);
    return (
      candidate.protocol === expected.protocol &&
      candidate.host.toLowerCase() === expected.host.toLowerCase() &&
      normalizedPathname(candidate.pathname) === normalizedPathname(expected.pathname) &&
      candidate.search === expected.search &&
      !candidate.username &&
      !candidate.password &&
      ALLOWED_RENDERER_HASHES.has(candidate.hash)
    );
  } catch {
    return false;
  }
};
