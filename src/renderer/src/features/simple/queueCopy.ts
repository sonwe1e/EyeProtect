import { pickLine } from '../reminders/restCopyPool';

/**
 * Deterministic quirk copy for the today queue (quirk-ui A2, ux §8): the queue
 * meta line, the empty-state title and the all-done variant. Selection keys off
 * the local day key only — NEVER queue length or task ids, or every completed
 * task would rotate the line (§8.4). Same day ⇒ same line on every render;
 * rotation happens naturally at the midnight re-render.
 *
 * Pools are exported for tests and copy audits; WorkbenchView only calls the
 * composed functions below.
 */

// ── queueMeta 三槽位（§8.1：数字与状态词是信息，不入池；只有短语轮换）──────

/** empty 槽整句（≤10 字）。 */
export const META_EMPTY_LINES: readonly string[] = [
  '今天还没有事',
  '白纸一张，随便写',
  '队列在打哈欠'
];

/** open 槽「·」后短语（≤6 字），模板固定为 `N 件 · {短语}`。 */
export const META_OPEN_PHRASES: readonly string[] = [
  '按顺序做',
  '一件一件来',
  '我帮你数着'
];

/** done 槽「·」后短语（≤7 字），前缀固定为「都做完了 ·」。 */
export const META_DONE_PHRASES: readonly string[] = [
  '去走两步',
  '我先眯一会儿',
  '队列下班了'
];

// ── 空状态标题（§8.2：说明句保持原句稳定，不入池）───────────────────────────

/** 空状态 h3（≤8 字）。 */
export const EMPTY_TITLE_LINES: readonly string[] = [
  '今天还没有事',
  '白纸一张',
  '队列还没醒'
];

// ── 全完成变体（§8.3）───────────────────────────────────────────────────────

/** 全完成标题（≤10 字）。 */
export const ALL_DONE_TITLE_LINES: readonly string[] = [
  '都做完了',
  '今天的队，清完了'
];

/** 全完成说明（≤20 字；① 含沉底功能信息，② 纯情绪）。 */
export const ALL_DONE_NOTE_LINES: readonly string[] = [
  '完成的都沉在队尾，随时回看。',
  '去走两步，明天队列见。'
];

// ── Composed accessors (the only functions UI should call) ──────────────────

/**
 * Queue headline next to the date. The three slots mirror the existing fixed
 * copy: empty queue / open work (`N 件 · 短语`) / all done (`都做完了 · 短语`).
 */
export const queueMetaCopy = (input: { total: number; open: number; dayKey: string }): string => {
  if (input.total === 0) return pickLine(META_EMPTY_LINES, `queueMeta|empty|${input.dayKey}`);
  if (input.open > 0) return `${input.open} 件 · ${pickLine(META_OPEN_PHRASES, `queueMeta|open|${input.dayKey}`)}`;
  return `都做完了 · ${pickLine(META_DONE_PHRASES, `queueMeta|done|${input.dayKey}`)}`;
};

/** Empty-state headline; the how-to paragraph below it stays fixed (§8.2). */
export const emptyQueueTitle = (dayKey: string): string =>
  pickLine(EMPTY_TITLE_LINES, `emptyTitle|${dayKey}`);

/** All-done variant headline + note (§8.3), both deterministic per day. */
export const allDoneQueueCopy = (dayKey: string): { title: string; note: string } => ({
  title: pickLine(ALL_DONE_TITLE_LINES, `allDoneTitle|${dayKey}`),
  note: pickLine(ALL_DONE_NOTE_LINES, `allDoneNote|${dayKey}`)
});
