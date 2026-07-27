import type { BreakActivity, ReminderKind, SingleReminderKind } from './types';

/**
 * Concrete micro-break suggestions shown during reminders (USERPLAN §一.3).
 * Plain rest/activity guidance — deliberately not framed as medical advice.
 * The main process picks activities when a reminder starts so a renderer
 * reload keeps the same suggestion.
 */
export const BREAK_ACTIVITIES: BreakActivity[] = [
  {
    id: 'eye-far-gaze',
    kind: 'eye',
    title: '看向远处，缓慢眨眼',
    steps: ['找一个 5 米外的目标', '放松地盯着它', '缓慢地眨眼 10 次'],
    durationSeconds: 30,
    tags: ['放松', '眨眼']
  },
  {
    id: 'eye-focus-switch',
    kind: 'eye',
    title: '远近焦点交替',
    steps: ['伸出食指放在眼前 20 厘米', '盯住指尖 3 秒', '切换到远处 3 秒', '来回交替 5 次'],
    durationSeconds: 30,
    tags: ['对焦']
  },
  {
    id: 'eye-close-rest',
    kind: 'eye',
    title: '闭眼放松',
    steps: ['轻轻闭上眼睛', '把双手搓热敷在眼皮上', '深呼吸 5 次'],
    durationSeconds: 30,
    tags: ['闭眼', '深呼吸']
  },
  {
    id: 'eye-window',
    kind: 'eye',
    title: '起身看看窗外',
    steps: ['离开屏幕走两步', '看向窗外最远的东西', '让眼睛失焦一会儿'],
    durationSeconds: 30,
    tags: ['远眺']
  },
  {
    id: 'eye-dim-break',
    kind: 'eye',
    title: '暂时离开高亮屏幕',
    steps: ['把视线移开屏幕', '闭眼或看暗处 20 秒', '顺便眨眨眼、伸个懒腰'],
    durationSeconds: 30,
    tags: ['避光']
  },
  {
    id: 'walk-water',
    kind: 'walk',
    title: '去接一杯水',
    steps: ['站起来走向饮水机', '接一杯温水', '慢慢喝完再回来'],
    durationSeconds: 60,
    tags: ['喝水']
  },
  {
    id: 'walk-neck',
    kind: 'walk',
    title: '肩颈活动',
    steps: ['双肩向上耸起再落下，重复 5 次', '头缓慢向左向右各转 3 圈', '手臂向上伸展 10 秒'],
    durationSeconds: 60,
    tags: ['拉伸', '肩颈']
  },
  {
    id: 'walk-in-place',
    kind: 'walk',
    title: '原地走动',
    steps: ['离开椅子', '在房间里原地踏步 30 秒', '甩甩手、活动脚踝'],
    durationSeconds: 60,
    tags: ['走动']
  },
  {
    id: 'walk-calf',
    kind: 'walk',
    title: '小腿伸展',
    steps: ['扶着桌沿站稳', '踮起脚尖保持 3 秒，重复 8 次', '轻轻抖动双腿放松'],
    durationSeconds: 60,
    tags: ['拉伸', '腿部']
  },
  {
    id: 'walk-loop',
    kind: 'walk',
    title: '在房间里走一圈',
    steps: ['站起来', '沿房间慢慢走一圈', '经过窗边时看一眼远处'],
    durationSeconds: 60,
    tags: ['走动', '远眺']
  }
];

const activityById = new Map(BREAK_ACTIVITIES.map((activity) => [activity.id, activity]));

export const getActivity = (id: string): BreakActivity | null => activityById.get(id) ?? null;

/**
 * Pick one activity per involved kind (combined reminders get an eye and a
 * walk suggestion). `recentIds` are excluded to avoid back-to-back repeats;
 * if every candidate was recent the pool falls back to all of them.
 */
export const pickActivityIds = (
  kind: ReminderKind,
  recentIds: readonly string[],
  random: () => number = Math.random
): string[] => {
  const kinds: SingleReminderKind[] = kind === 'combined' ? ['eye', 'walk'] : [kind];
  return kinds.map((single) => {
    const pool = BREAK_ACTIVITIES.filter((activity) => activity.kind === single);
    const fresh = pool.filter((activity) => !recentIds.includes(activity.id));
    const candidates = fresh.length > 0 ? fresh : pool;
    const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
    return candidates[index].id;
  });
};
