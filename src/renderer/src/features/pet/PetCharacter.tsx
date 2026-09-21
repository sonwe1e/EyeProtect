import { useEffect, useState } from 'react';
import { PIXEL_ANIMAL_NAMES, type PixelAnimal } from '../../../../shared/pixelAnimals';
import { PixelAnimal as PixelAnimalArtwork } from '../characters/PixelAnimal';
import type { CustomPetAssets } from '../../../../shared/types';

const IDLE_ACTION_INTERVAL_MIN_MS = 14_000;
const IDLE_ACTION_INTERVAL_MAX_MS = 24_000;
const IDLE_ACTION_DURATION_MS = 3_200;

export function PetCharacter({
  animal,
  theme,
  reacting,
  doubleClickHint,
  motion = true
}: {
  animal: PixelAnimal;
  theme?: string | null;
  reacting: boolean;
  doubleClickHint: string;
  /** Manual override: false freezes idle fidget. prefers-reduced-motion still wins. */
  motion?: boolean;
}): JSX.Element {
  const [isAnimating, setIsAnimating] = useState(false);
  const [customAssets, setCustomAssets] = useState<CustomPetAssets | null>(null);
  const [activeClickSrc, setActiveClickSrc] = useState<string | null>(null);
  const [activeFidgetSrc, setActiveFidgetSrc] = useState<string | null>(null);
  const [actionNonce, setActionNonce] = useState(0);

  useEffect(() => {
    const loadAssets = () => {
      void window.eyeProtect.getCustomPetAssets(theme).then(setCustomAssets);
    };
    loadAssets();
    window.addEventListener('focus', loadAssets);
    return () => window.removeEventListener('focus', loadAssets);
  }, [theme, animal]);

  useEffect(() => {
    if (reacting && customAssets?.hasCustomPet) {
      const pool =
        customAssets.clicks.length > 0
          ? customAssets.clicks
          : customAssets.fidgets.length > 0
          ? customAssets.fidgets
          : customAssets.idles;
      if (pool.length > 0) {
        const picked = pool[Math.floor(Math.random() * pool.length)];
        setActiveClickSrc(picked);
        setActionNonce((prev) => prev + 1);
      }
    }
  }, [reacting, customAssets]);

  useEffect(() => {
    if (isAnimating && customAssets?.hasCustomPet) {
      const pool =
        customAssets.fidgets.length > 0
          ? customAssets.fidgets
          : customAssets.clicks.length > 0
          ? customAssets.clicks
          : customAssets.idles;
      if (pool.length > 0) {
        const picked = pool[Math.floor(Math.random() * pool.length)];
        setActiveFidgetSrc(picked);
        setActionNonce((prev) => prev + 1);
      }
    }
  }, [isAnimating, customAssets]);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!motion) return;
    let actionTimer: number | null = null;
    let settleTimer: number | null = null;
    const clearTimers = (): void => {
      if (actionTimer !== null) window.clearTimeout(actionTimer);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      actionTimer = null;
      settleTimer = null;
    };
    const arm = (): void => {
      if (document.hidden || reducedMotion.matches) return;
      const interval =
        IDLE_ACTION_INTERVAL_MIN_MS +
        Math.floor(Math.random() * (IDLE_ACTION_INTERVAL_MAX_MS - IDLE_ACTION_INTERVAL_MIN_MS));
      actionTimer = window.setTimeout(() => {
        setIsAnimating(true);
        settleTimer = window.setTimeout(() => {
          setIsAnimating(false);
          arm();
        }, IDLE_ACTION_DURATION_MS);
      }, interval);
    };
    const sync = (): void => {
      clearTimers();
      setIsAnimating(false);
      arm();
    };
    document.addEventListener('visibilitychange', sync);
    reducedMotion.addEventListener('change', sync);
    arm();
    return () => {
      clearTimers();
      document.removeEventListener('visibilitychange', sync);
      reducedMotion.removeEventListener('change', sync);
    };
  }, [animal, motion]);

  const name = PIXEL_ANIMAL_NAMES[animal];

  if (customAssets?.hasCustomPet) {
    const defaultIdle =
      customAssets.idles[0] ??
      customAssets.fidgets[0] ??
      customAssets.clicks[0] ??
      customAssets.sleeps[0] ??
      null;

    const currentSrc =
      (reacting && (activeClickSrc || customAssets.clicks[0])) ||
      (isAnimating && (activeFidgetSrc || customAssets.fidgets[0])) ||
      defaultIdle;

    if (currentSrc) {
      const imgKey = reacting
        ? `click-${actionNonce}-${currentSrc}`
        : isAnimating
        ? `fidget-${actionNonce}-${currentSrc}`
        : `idle-${currentSrc}`;

      return (
        <div
          className={`pet-character ${isAnimating ? 'is-animating' : ''} ${reacting ? 'is-reacting' : ''}`.trim()}
          aria-label="自定义桌宠"
          title={`单击互动，${doubleClickHint}`}
        >
          <img
            key={imgKey}
            src={currentSrc}
            alt="自定义桌宠"
            style={{
              display: 'block',
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              imageRendering: 'pixelated',
              userSelect: 'none',
              pointerEvents: 'none'
            }}
          />
        </div>
      );
    }
  }

  return (
    <div
      className={`pet-character ${isAnimating ? 'is-animating' : ''} ${reacting ? 'is-reacting' : ''}`.trim()}
      aria-label={name}
      title={`单击互动，${doubleClickHint}`}
    >
      <PixelAnimalArtwork animal={animal} action={reacting || isAnimating ? 'react' : 'idle'} label={name} />
    </div>
  );
}
