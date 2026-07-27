import { useEffect, useState, type MouseEvent } from 'react';
import { Coffee, Glasses, Leaf } from 'lucide-react';
import {
  PET_SKINS,
  type PetAccessory,
  type PetMood,
  type PetSkin
} from '../../../../shared/types';

const IDLE_ACTION_INTERVAL_MS = 45_000;
const IDLE_ACTION_MAX_MS = 5_200;

const petArtwork: Record<PetSkin, string> = {
  stable: './assets/pet/pet-stable.png',
  eye: './assets/pet/pet-eye.png',
  fu: './assets/pet/pet-fu.png',
  sleep: './assets/pet/pet-sleep.png'
};

const petSkinLabel: Record<PetSkin, string> = {
  stable: '默认',
  eye: '揉眼',
  fu: '摸肚',
  sleep: '睡觉'
};

export function PetCharacter({
  skin,
  selectedSkin,
  mood,
  accessory,
  onSelect,
  onDoubleClick,
  doubleClickHint
}: {
  skin: PetSkin;
  selectedSkin: PetSkin;
  mood: PetMood;
  accessory: PetAccessory;
  onSelect: (skin: PetSkin) => void;
  onDoubleClick: (event: MouseEvent<HTMLDivElement>) => void;
  doubleClickHint: string;
}): JSX.Element {
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let actionTimer: number | null = null;
    let settleTimer: number | null = null;

    const clearTimers = (): void => {
      if (actionTimer !== null) {
        window.clearTimeout(actionTimer);
        actionTimer = null;
      }
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
        settleTimer = null;
      }
    };
    const arm = (): void => {
      if (document.hidden || reducedMotion.matches) {
        return;
      }
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
  }, [skin]);

  return (
    <div
      className={`pet-character skin-${skin} mood-${mood} ${isAnimating ? 'is-animating' : ''}`.trim()}
      aria-label="EyeProtect 桌宠"
      title={`按住拖动位置，${doubleClickHint}`}
      onDoubleClick={onDoubleClick}
    >
      <img src={petArtwork[skin]} alt="EyeProtect 桌宠" draggable={false} />
      <PetAccessoryMark accessory={accessory} />
      <SkinPicker current={selectedSkin} onSelect={onSelect} />
    </div>
  );
}

function PetAccessoryMark({ accessory }: { accessory: PetAccessory }): JSX.Element | null {
  if (accessory === 'none') {
    return null;
  }
  return (
    <span className="pet-accessory" data-accessory={accessory} aria-hidden="true">
      {accessory === 'cup' ? (
        <Coffee />
      ) : accessory === 'glasses' ? (
        <Glasses />
      ) : (
        <Leaf />
      )}
    </span>
  );
}

function SkinPicker({
  current,
  onSelect
}: {
  current: PetSkin;
  onSelect: (skin: PetSkin) => void;
}): JSX.Element {
  return (
    <div className="skin-picker" role="group" aria-label="选择桌宠皮肤">
      {PET_SKINS.map((skin) => (
        <button
          key={skin}
          type="button"
          className="skin-thumb"
          aria-pressed={current === skin}
          title={petSkinLabel[skin]}
          onClick={() => onSelect(skin)}
        >
          <img src={petArtwork[skin]} alt={petSkinLabel[skin]} draggable={false} />
        </button>
      ))}
    </div>
  );
}
