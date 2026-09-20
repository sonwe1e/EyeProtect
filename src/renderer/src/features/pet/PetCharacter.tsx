import { useEffect, useState } from 'react';
import { PIXEL_ANIMAL_NAMES, type PixelAnimal } from '../../../../shared/pixelAnimals';
import { PixelAnimal as PixelAnimalArtwork } from '../characters/PixelAnimal';

const IDLE_ACTION_INTERVAL_MS = 45_000;
const IDLE_ACTION_MAX_MS = 5_200;

export function PetCharacter({
  animal,
  reacting,
  doubleClickHint,
  motion = true
}: {
  animal: PixelAnimal;
  reacting: boolean;
  doubleClickHint: string;
  /** Manual override: false freezes idle fidget. prefers-reduced-motion still wins. */
  motion?: boolean;
}): JSX.Element {
  const [isAnimating, setIsAnimating] = useState(false);

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
      actionTimer = window.setTimeout(() => {
        setIsAnimating(true);
        settleTimer = window.setTimeout(() => {
          setIsAnimating(false);
          arm();
        }, IDLE_ACTION_MAX_MS);
      }, IDLE_ACTION_INTERVAL_MS);
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
