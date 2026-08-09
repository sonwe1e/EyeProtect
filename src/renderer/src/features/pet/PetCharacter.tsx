import { useEffect, useState, type MouseEvent } from 'react';
import type { CollectibleCharacter, PetAccessory, PetMood } from '../../../../shared/types';
import { ProceduralCharacter } from '../characters/ProceduralCharacter';

const IDLE_ACTION_INTERVAL_MS = 45_000;
const IDLE_ACTION_MAX_MS = 5_200;
const REACTION_MS = 1_100;

export function PetCharacter({
  character,
  mood,
  accessory,
  onDoubleClick,
  doubleClickHint
}: {
  character: CollectibleCharacter;
  mood: PetMood;
  accessory: PetAccessory;
  onDoubleClick: (event: MouseEvent<HTMLDivElement>) => void;
  doubleClickHint: string;
}): JSX.Element {
  const [isAnimating, setIsAnimating] = useState(false);
  const [reaction, setReaction] = useState<string | null>(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
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
  }, [character.id]);

  const react = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.detail !== 1) return;
    const action = character.favoriteActions[Math.floor(Math.random() * character.favoriteActions.length)];
    setReaction(action);
    window.setTimeout(() => setReaction(null), REACTION_MS);
  };

  return (
    <div
      className={`pet-character mood-${mood} ${isAnimating ? 'is-animating' : ''} ${reaction ? `is-reacting reaction-${reaction}` : ''}`.trim()}
      aria-label={character.name}
      title={`单击互动，按住拖动，${doubleClickHint}`}
      onClick={react}
      onDoubleClick={onDoubleClick}
    >
      <ProceduralCharacter character={character} mood={mood} action={reaction ? 'react' : 'idle'} accessory={accessory} />
    </div>
  );
}
