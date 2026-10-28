import { useEffect, useState } from 'react';
import { PIXEL_ANIMAL_NAMES, PET_OUTFIT_DETAILS, type PixelAnimal, type PetOutfit } from '../../../../shared/pixelAnimals';
import { PET_COMPANION_DETAILS, type PetCompanion } from '../../../../shared/petCompanions';
import { CompanionArtwork } from '../characters/CompanionArtwork';
import { PetImage } from '../characters/PetImage';
import type { CustomPetAssets, PetReactionEvent } from '../../../../shared/types';

const IDLE_ACTION_INTERVAL_MIN_MS = 14_000;
const IDLE_ACTION_INTERVAL_MAX_MS = 24_000;
const IDLE_ACTION_DURATION_MS = 3_200;

export function PetCharacter({
  animal,
  companion,
  outfit,
  reacting,
  doubleClickHint,
  reaction = null,
  clickKey = 0,
  motion = true
}: {
  animal: PixelAnimal;
  companion: PetCompanion;
  outfit: PetOutfit;
  reacting: boolean;
  doubleClickHint: string;
  reaction?: PetReactionEvent | null;
  clickKey?: number;
  /** Manual override: false freezes idle fidget. prefers-reduced-motion still wins. */
  motion?: boolean;
}): JSX.Element {
  const [isAnimating, setIsAnimating] = useState(false);
  const [customAssets, setCustomAssets] = useState<CustomPetAssets | null>(null);
  const [activeClickSrc, setActiveClickSrc] = useState<string | null>(null);
  const [activeFidgetSrc, setActiveFidgetSrc] = useState<string | null>(null);
  const [actionNonce, setActionNonce] = useState(0);

  useEffect(() => {
    let disposed = false;
    const loadAssets = () => {
      void window.eyeProtect.getCustomPetAssets().then((assets) => {
        if (!disposed) setCustomAssets(assets);
      });
    };
    setCustomAssets(null);
    if (companion !== 'custom') return () => { disposed = true; };
    loadAssets();
    window.addEventListener('focus', loadAssets);
    return () => { disposed = true; window.removeEventListener('focus', loadAssets); };
  }, [companion]);

  useEffect(() => {
    if ((reacting || reaction) && customAssets?.hasCustomPet) {
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
  }, [reacting, reaction, clickKey, customAssets]);

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
    setIsAnimating(false);
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
  }, [motion]);

  const name = companion === 'pixel' ? PIXEL_ANIMAL_NAMES[animal] : PET_COMPANION_DETAILS[companion].name;
  const artworkAction = reaction?.action ?? (reacting ? 'react' : isAnimating && motion ? 'fidget' : 'idle');
  const interacting = reacting || Boolean(reaction);

  if (companion === 'custom' && customAssets?.hasCustomPet) {
    const defaultIdle =
      customAssets.idles[0] ??
      customAssets.fidgets[0] ??
      customAssets.clicks[0] ??
      customAssets.sleeps[0] ??
      null;

    const currentSrc =
      (interacting && (activeClickSrc || customAssets.clicks[0])) ||
      (isAnimating && (activeFidgetSrc || customAssets.fidgets[0])) ||
      defaultIdle;

    if (currentSrc) {
      const imgKey = interacting
        ? `click-${actionNonce}-${currentSrc}`
        : isAnimating
        ? `fidget-${actionNonce}-${currentSrc}`
        : `idle-${currentSrc}`;

      return (
        <div
          className={`pet-character ${isAnimating ? 'is-animating' : ''} ${reacting ? 'is-reacting' : ''}`.trim()}
          aria-label={name}
          title={`单击互动，${doubleClickHint}`}
        >
          <PetImage
            key={imgKey}
            src={currentSrc}
            label={name}
            motion={motion}
          />
        </div>
      );
    }
  }

  return (
    <div
      className={`pet-character ${isAnimating ? 'is-animating' : ''} ${reacting ? 'is-reacting' : ''}`.trim()}
      aria-label={name}
      title={`单击${companion === 'pixel' ? PET_OUTFIT_DETAILS[outfit].interaction : PET_COMPANION_DETAILS[companion].interaction}，${doubleClickHint}`}
    >
      <CompanionArtwork companion={companion} outfit={outfit} action={artworkAction} animationKey={reaction?.id ?? clickKey} motion={motion} />
    </div>
  );
}
