import { useEffect, useMemo, useState } from 'react';
import type { ActiveReminder, ReminderKind } from '../../../../shared/types';

const ARTWORK_INTERVAL_MS = 2_200;
const eyeArtwork = Array.from({ length: 6 }, (_, index) => `./assets/reminders/eye-${index + 1}.png`);
const walkArtwork = Array.from({ length: 6 }, (_, index) => `./assets/reminders/walk-${index + 1}.png`);

export const reminderCopy: Record<ReminderKind, { title: string; detail: string }> = {
  eye: {
    title: '眼睛休息时间',
    detail: '看向远处，眨眨眼，离开屏幕一小会儿。'
  },
  walk: {
    title: '该起来走走',
    detail: '站起来活动肩颈和腿，喝口水也算完成。'
  },
  combined: {
    title: '休息眼睛，也走一走',
    detail: '这次把护眼和活动合并提醒，一次处理掉。'
  }
};

const artworkFor = (kind: ReminderKind): string[] => {
  if (kind === 'eye') {
    return eyeArtwork;
  }
  if (kind === 'walk') {
    return walkArtwork;
  }
  return [...eyeArtwork, ...walkArtwork];
};

export function ReminderArtwork({
  active,
  canComplete,
  onDoubleClick
}: {
  active: ActiveReminder;
  canComplete: boolean;
  onDoubleClick: () => void;
}): JSX.Element {
  const images = useMemo(() => artworkFor(active.kind), [active.kind]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (images.length <= 1) {
      return;
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: number | null = null;

    const stop = (): void => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const sync = (): void => {
      stop();
      if (document.hidden || reducedMotion.matches) {
        setIndex(0);
        return;
      }
      timer = window.setInterval(() => {
        setIndex((current) => (current + 1) % images.length);
      }, ARTWORK_INTERVAL_MS);
    };

    document.addEventListener('visibilitychange', sync);
    reducedMotion.addEventListener('change', sync);
    sync();
    return () => {
      stop();
      document.removeEventListener('visibilitychange', sync);
      reducedMotion.removeEventListener('change', sync);
    };
  }, [images]);

  const src = images[index] ?? images[0];
  return (
    <div
      className="reminder-artwork"
      title={canComplete ? '双击完成提醒' : '倒计时结束后可双击完成'}
      onDoubleClick={onDoubleClick}
    >
      <img src={src} alt={active.kind === 'walk' ? '走动提醒插画' : '护眼提醒插画'} draggable={false} />
    </div>
  );
}
