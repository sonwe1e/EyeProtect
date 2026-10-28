import type { ReminderKind } from '../../../../shared/types';

/**
 * Quirk copy pools for the rest surface (B1/B4) and the hydration strip (B2).
 *
 * Selection is a pure function of a stable key (reminder id / prompt id salted
 * with kind, phase and slot): FNV-1a 32-bit + modulo. The alert window
 * re-renders once per second, so `now` and countdown values must never enter
 * the key — the same reminder id keeps its line for the whole rest, and the
 * render path contains no Math.random (contract 6).
 *
 * Round 1 algorithm: design/quirk-ui/interaction-spec.md §5.1 (pickLine /
 * pickWithEggs, the released anchor). Round 2: three tiers per §9 (85/12/3,
 * bands 0-84 / 85-96 / 97-99) with the never-empty fallback chain; pool copy
 * from §4 + §10 verbatim. The baseline hydration line stays common[0].
 */

export type RestCopyPhase = 'ready' | 'resting' | 'finished';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32-bit; Math.imul keeps the multiplication in uint32, >>>0 normalises. */
export const fnv1a = (input: string): number => {
  let hash = FNV_OFFSET;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
};

/** Plain deterministic pick; an empty pool yields '' so callers keep fixed copy. */
export const pickLine = (pool: readonly string[], key: string): string => {
  if (pool.length === 0) return '';
  return pool[fnv1a(key) % pool.length] ?? '';
};

/** Share of hash space (percent) reserved for easter eggs — lead decision: 10%. */
const EGG_BAND_PERCENT = 10;

/**
 * Egg-gated pick: keys inside the band draw from `eggs`, everything else from
 * `normal`. The two sources must stay disjoint (asserted by tests); a missing
 * pool falls back to '' like pickLine.
 *
 * @deprecated Round 2 supersedes this with {@link pickTier} (three tiers, ux
 * interaction-spec §9). Kept as the released-behaviour anchor: semantics and
 * the existing assertions stay untouched.
 */
export const pickWithEggs = (normal: readonly string[], eggs: readonly string[], key: string): string => {
  const hash = fnv1a(key);
  const source = eggs.length > 0 && hash % 100 < EGG_BAND_PERCENT ? eggs : normal;
  if (source.length === 0) return '';
  return source[Math.floor(hash / 100) % source.length] ?? '';
};

// ── Three-tier selection (Round 2, ux §9: 85 / 12 / 3) ──────────────────────

export type CopyTier = 'common' | 'rare' | 'legendary';

export interface TieredPool {
  common: readonly string[];
  rare?: readonly string[];
  legendary?: readonly string[];
}

/** Which tier a key lands in; shares the band math with {@link pickTier}. */
export const pickTierName = (key: string): CopyTier => {
  const band = fnv1a(key) % 100;
  return band < 85 ? 'common' : band < 97 ? 'rare' : 'legendary';
};

const firstNonEmpty = (...pools: Array<readonly string[] | undefined>): readonly string[] =>
  pools.find((pool) => pool !== undefined && pool.length > 0) ?? [];

/**
 * Tiered pick that never returns empty: a legendary hit falls back
 * legendary → rare → common, a rare hit falls back rare → common (ux §9.2).
 * The in-pool index reuses the same hash, so one key keeps one line forever.
 */
export const pickTier = (pool: TieredPool, key: string): string => {
  const wanted = pickTierName(key);
  const source = wanted === 'legendary'
    ? firstNonEmpty(pool.legendary, pool.rare, pool.common)
    : wanted === 'rare'
      ? firstNonEmpty(pool.rare, pool.common)
      : pool.common;
  return pickLine(source, key);
};

// ── Pools (interaction-spec.md §4 + §10, verbatim) ──────────────────────────
// Exported for tests and copy audits only; UI goes through the composed
// functions below.

/** Finished-phase main titles, one pool per kind (≤14 chars). */
export const FINISHED_TITLE_POOLS: Record<ReminderKind, readonly string[]> = {
  eye: [
    '眼睛回来了，气色不错。',
    '这一趟远，看得值。',
    '屏幕还在，不着急。',
    '你和眼睛都到齐了。',
    '休息结清，不记账。',
    '望远归来，轻装上阵。',
    '眼睛遛弯回来了，拴好了。',
    '远方已阅，无异常。',
    '你望的时候，风也在。',
    '眼睛吃饱了远处。',
    '望远结束，不用交钱。',
    '眼睛回来得比外卖快。'
  ],
  walk: [
    '归队，位子还热着。',
    '腿很满意这次出差。',
    '这两步，走得值。',
    '步数不记，感觉记了。',
    '回来啦，接着慢慢来。',
    '你回来，屏幕都精神了。',
    '腿去遛了自己一圈。',
    '椅子接驾完毕。',
    '这趟出差零报销。',
    '开门风也跟去转了转。',
    '地板说脚步很轻快。',
    '回来时顺便带了精神。'
  ],
  combined: [
    '两件事，一起办完了。',
    '眼睛和腿，都谢过了。',
    '这一趟，满载而归。',
    '都齐了，屏幕随便你。',
    '眼和腿的团建结束。',
    '一趟出门，两处都喂饱。',
    '屏幕孤独了一会儿。',
    '全员到齐，解散。'
  ]
};

/** Rare finished titles (the Round 1 easter-egg pools, demoted one tier). */
export const EGG_POOLS: Record<ReminderKind, readonly string[]> = {
  eye: [
    '窗外有人路过，我目送了。',
    '我趁你看远处，擦了擦屏幕。',
    '远方评价：还行，下次再去。',
    '这段休息，由我承包了。'
  ],
  walk: [
    '你的椅子刚才偷偷转了半圈。',
    '我数了，你走了八步半。',
    '楼下的猫问你去哪儿了。'
  ],
  combined: []
};

/** Legendary finished titles (Round 2 §10.2, ≤14 chars, 2-3 per kind). */
export const LEGENDARY_TITLE_POOLS: Record<ReminderKind, readonly string[]> = {
  eye: [
    '月亮刚才替你眨了下眼。',
    '眼睛刚从云上出差回来。',
    '刚才远处那朵云朝你挥手。'
  ],
  walk: [
    '你离开的三十秒，椅子睡了。',
    '地板刚数完你的脚步声。',
    '你的影子先回去了，在等你。'
  ],
  combined: [
    '眼睛和腿在路上聊到你。',
    '这一趟，你把自己找回来了。',
    '你回来时，屏幕松了口气。'
  ]
};

/** Combined owns its ready/resting titles; eye/walk keep the activity instruction. */
export const COMBINED_PHASE_TITLES: Record<Exclude<RestCopyPhase, 'finished'>, readonly string[]> = {
  ready: [
    '眼睛和腿一起点名了。',
    '这次连人一起休息。',
    '一举两得：望远加散步。',
    '离开屏幕，顺便活动活动。',
    '一次放风，两处都到。',
    '全身都在催你起立。',
    '这轮休息是双份的。',
    '眼睛背包，腿带路。',
    '离席两分钟，随时回来。',
    '望远和散步打包出发。'
  ],
  resting: [
    '先望远，再走一小圈。',
    '眼睛和腿都有份。',
    '屏幕你先忙着，我们走开一下。',
    '一圈走完，两处都到账。',
    '远处看了，路也走了，齐活。',
    '两件事慢慢办，不急。',
    '远处看累就看看路。',
    '你的工位在充电。',
    '走完这圈，两清了。'
  ]
};

/** Pet captions for eye/walk during ready/resting (≤12 chars); combined stays fixed. */
export const CAPTION_POOLS: Record<'eye' | 'walk', Record<Exclude<RestCopyPhase, 'finished'>, readonly string[]>> = {
  eye: {
    ready: [
      '眼睛申请出趟远门。',
      '屏幕先放一放，我望风。',
      '远处不收门票，去看看。',
      '眼睛加班到这儿，放个风。',
      '五米外有风景，替我看看。',
      '我望风，你放心走神。',
      '眼睛在拍窗户了。',
      '远处在等你点名。',
      '眼睛想出去野了。',
      '望远处不用穿外套。',
      '屏幕先冷却一下。',
      '眼睛的假期批下来了。'
    ],
    resting: [
      '我替你盯着屏幕。',
      '眨眼三下，不数也行。',
      '远处那条线还在。',
      '眼睛在放假，别喊它。',
      '我在，慢慢来。',
      '你看远处，我看你。',
      '我替你值这个班。',
      '眼睛在那边玩得开心。',
      '远处一时半会看不腻。',
      '屏幕被我暂时没收。',
      '你看远处，我数秒。',
      '眨眼是免费的。'
    ]
  },
  walk: {
    ready: [
      '椅子暂时用不上你了。',
      '腿敲了敲门，去应一下。',
      '我看着位子，你去晃晃。',
      '你的工位，我暂时看管。',
      '两分钟的路，不用带包。',
      '出发吧，屏幕我盯着。',
      '腿已在门口待命。',
      '工位我先替你暖着。',
      '走廊今天没人排队。',
      '你的影子想出去。',
      '两步就好，不用装备。',
      '椅子同意放你了。'
    ],
    resting: [
      '我在原地守着屏幕。',
      '走匀一点，不赶时间。',
      '绕桌子一圈也算远行。',
      '椅子想你了，快回了。',
      '一步一步，不着急。',
      '肩膀顺路也遛一遛。',
      '我盯着屏幕不眨眼。',
      '走到拐角再回来。',
      '脚步声很好听。',
      '走姿很正，像风。',
      '回程记得顺路绕一下。',
      '全楼的空气都新鲜了。'
    ]
  }
};

/** Hydration strip common lines (≤16 chars); baseline sentence stays common[0]. */
export const HYDRATION_BUBBLE_LINES: readonly string[] = [
  '我喝了三口。你第几杯了？',
  '今天的水，我示范第一口。',
  '杯子空了会寂寞的。',
  '你的杯子在假装满了。',
  '隔着屏幕都闻到水味了。',
  '喝水不用排队，就现在。',
  '我这边是玻璃杯，你随意。',
  '下一轮话筒归你。',
  '杯子今天还想再忙一次。',
  '顺便的水，不算任务。',
  '杯子在敲杯垫催你。',
  '我这一口，敬你的杯子。',
  '水位线在往下走，懂的。',
  '你的水杯在演空城计。',
  '喝口水，接着慢慢来。',
  '今天的水还没开场呢。',
  '杯子说它认得你的手。',
  '我先干为敬，你随意。',
  '你的补给到货了，自取。',
  '别管第几杯，这口算数。'
];

/** Hydration rare lines (Round 2 §10.5, ≤16 chars). */
export const HYDRATION_RARE_LINES: readonly string[] = [
  '这杯水我盯了很久了。',
  '喝完这口，杯子退休半小时。',
  '水在杯里转圈，想出来。'
];

/** Hydration legendary lines (Round 2 §10.5, ≤16 chars). */
export const HYDRATION_LEGENDARY_LINES: readonly string[] = [
  '水说它想见见你。',
  '我替你尝过了，是水味。'
];

// ── Composed accessors (the only functions UI should call) ──────────────────

const rareFor = (kind: ReminderKind): readonly string[] =>
  kind === 'combined' ? [...EGG_POOLS.eye, ...EGG_POOLS.walk] : EGG_POOLS[kind];

/**
 * Main title for one rest moment. Serves finished (every kind, three tiers)
 * and combined ready/resting; eye/walk ready/resting return '' because the
 * activity instruction (suggestion?.title) stays the title there.
 */
export const restTitleLine = (id: string, kind: ReminderKind, phase: RestCopyPhase): string => {
  if (phase === 'finished') {
    return pickTier(
      { common: FINISHED_TITLE_POOLS[kind], rare: rareFor(kind), legendary: LEGENDARY_TITLE_POOLS[kind] },
      `${id}|${kind}|finished|title`
    );
  }
  if (kind !== 'combined') return '';
  return pickLine(COMBINED_PHASE_TITLES[phase], `${id}|combined|${phase}|title`);
};

/**
 * Pet caption for eye/walk during ready/resting; combined and finished keep
 * their fixed captions ('我在这里陪你' / '一起慢慢来'). Captions carry no
 * tiers (ux §9.3): low-significance slots skip the 3% surprise cost.
 */
export const restCaptionLine = (id: string, kind: ReminderKind, phase: Exclude<RestCopyPhase, 'finished'>): string => {
  if (kind !== 'eye' && kind !== 'walk') return '';
  return pickLine(CAPTION_POOLS[kind][phase], `${id}|caption|${kind}|${phase}`);
};

/** Hydration strip line, keyed by prompt id only (the strip lives 8s). */
export const hydrationBubbleLine = (promptId: string): string =>
  pickTier(
    { common: HYDRATION_BUBBLE_LINES, rare: HYDRATION_RARE_LINES, legendary: HYDRATION_LEGENDARY_LINES },
    `${promptId}|bubble`
  );
