import { fnv1a } from '../reminders/restCopyPool';

/**
 * Deterministic list accent mapping (quirk-ui Round 2, scope A): a project id
 * picks one decorative `--list-accent-*` token, so every row of a list wears
 * the same colour stripe forever — no randomness, no per-render flicker.
 *
 * FNV-1a comes from the shared restCopyPool module (one hash implementation
 * per repo). The accent slot space is intentionally NOT salted with anything:
 * ids are unique, so a bare `fnv1a(id)` distributes cleanly.
 *
 * `LIST_ACCENT_COUNT` must equal the number of `--list-accent-*` declarations
 * per theme block in theme.css — locked by the source-scan test (6 per block,
 * three blocks). The default list (null projectId) gets NO stripe at all:
 * "no ownership = no colour" (vision R2-0).
 */

/** Number of --list-accent-* tokens declared per theme block in theme.css. */
export const LIST_ACCENT_COUNT = 6;

/**
 * 0-based accent slot for a list, or null for the default list (no stripe).
 * Rename or recreate a list and the colour stays: the hash keys on the id.
 */
export const listAccentIndex = (projectId: string | null): number | null => {
  if (projectId === null) return null;
  return fnv1a(projectId) % LIST_ACCENT_COUNT;
};

/** CSS var reference like `var(--list-accent-3)`, or '' for the default list.
 *  TEST-ONLY for now: the card markup consumes the data-accent attribute
 *  instead. Kept exported so the mapping keeps a printable form in audits. */
export const listAccentVar = (projectId: string | null): string => {
  const index = listAccentIndex(projectId);
  return index === null ? '' : `var(--list-accent-${index + 1})`;
};
