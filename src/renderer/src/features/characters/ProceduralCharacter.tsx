import { memo, useMemo } from 'react';
import type {
  CollectibleCharacter,
  PetAccessory,
  PetMood,
  ReminderKind
} from '../../../../shared/types';

export type CharacterAction = 'idle' | 'react' | ReminderKind;

const pointOnBody = (
  angle: number,
  width: number,
  height: number
): { x: number; y: number } => {
  const radians = angle * Math.PI / 180;
  return {
    x: 50 + Math.cos(radians) * width * 0.46,
    y: 52 + Math.sin(radians) * height * 0.46
  };
};

export const ProceduralCharacter = memo(function ProceduralCharacter({
  character,
  mood = 'calm',
  action = 'idle',
  accessory = character.accessory,
  compact = false,
  label
}: {
  character: CollectibleCharacter;
  mood?: PetMood;
  action?: CharacterAction;
  accessory?: PetAccessory;
  compact?: boolean;
  label?: string;
}): JSX.Element {
  const { recipe } = character;
  const [base, light, ink] = recipe.palette;
  const bodyX = 50 - recipe.bodyWidth / 2;
  const bodyY = 52 - recipe.bodyHeight / 2;
  const radius = Math.min(recipe.bodyWidth, recipe.bodyHeight) * recipe.bodyRoundness / 200;
  const attentionGap = recipe.attentionSpread;
  // Stable style object so React.memo can actually skip re-rendering the SVG
  // when the character (and thus palette) is unchanged — the alert window
  // re-renders every second for countdowns and must not redraw the artwork.
  const characterStyle = useMemo(
    () => ({ '--character-base': base, '--character-light': light, '--character-ink': ink }) as React.CSSProperties,
    [base, light, ink]
  );

  return (
    <div
      className={`procedural-character style-${character.style} material-${character.material} action-${action} mood-${mood} ${compact ? 'is-compact' : ''}`.trim()}
      style={characterStyle}
      role="img"
      aria-label={label ?? `${character.name}，${character.personality}`}
      data-character-id={character.id}
    >
      <svg viewBox="0 0 100 100" focusable="false" aria-hidden="true">
        <defs>
          <linearGradient id={`body-${character.id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={light} />
            <stop offset="0.55" stopColor={base} />
            <stop offset="1" stopColor={ink} stopOpacity="0.2" />
          </linearGradient>
          <filter id={`soft-${character.id}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.4" />
          </filter>
        </defs>
        <g className="character-orbits">
          {Array.from({ length: recipe.orbitCount }, (_, index) => (
            <circle
              key={index}
              className="character-orbit-dot"
              cx={50 + Math.cos(index * 2.1) * (recipe.bodyWidth / 2 + 8)}
              cy={50 + Math.sin(index * 2.1) * (recipe.bodyHeight / 2 + 7)}
              r={1.6 + index * 0.35}
              fill={index % 2 ? light : base}
            />
          ))}
        </g>
        <g className="character-limbs">
          {recipe.appendages.map((appendage, index) => {
            const origin = pointOnBody(appendage.angle, recipe.bodyWidth, recipe.bodyHeight);
            const end = character.rig.actionPoints[index] ?? character.rig.center;
            return (
              <g key={index} className={`character-limb limb-${index % 4}`}>
                <path
                  d={`M ${origin.x} ${origin.y} Q ${(origin.x + end.x) / 2 + appendage.bend} ${(origin.y + end.y) / 2 - appendage.bend} ${end.x} ${end.y}`}
                  fill="none"
                  stroke={ink}
                  strokeWidth={appendage.width}
                  strokeLinecap="round"
                />
                <circle cx={end.x} cy={end.y} r={appendage.tipSize / 2} fill={base} stroke={ink} strokeWidth="1.2" />
              </g>
            );
          })}
        </g>
        <g className="character-body" transform={`rotate(${recipe.bodyTilt} 50 52)`}>
          <rect
            x={bodyX}
            y={bodyY}
            width={recipe.bodyWidth}
            height={recipe.bodyHeight}
            rx={character.style === 'pixel' ? Math.min(3, radius) : radius}
            fill={`url(#body-${character.id})`}
            stroke={ink}
            strokeWidth={character.style === 'doodle' ? 2.4 : 1.4}
          />
          {recipe.pattern === 'spots' ? (
            <g className="character-pattern" fill={light} opacity="0.72">
              <circle cx="42" cy="42" r="4" /><circle cx="58" cy="62" r="3" /><circle cx="62" cy="43" r="2" />
            </g>
          ) : null}
          {recipe.pattern === 'stripes' ? (
            <g className="character-pattern" stroke={light} strokeWidth="3" opacity="0.65">
              <path d="M36 40 L61 34" /><path d="M35 50 L65 43" /><path d="M38 60 L64 54" />
            </g>
          ) : null}
          {recipe.pattern === 'sparkles' ? (
            <g className="character-pattern" fill={light}><path d="M40 43l2 3 3 2-3 2-2 3-2-3-3-2 3-2z" /><path d="M61 58l1.5 2 2 1.5-2 1.5-1.5 2-1.5-2-2-1.5 2-1.5z" /></g>
          ) : null}
        </g>
        <g className="character-face" transform={`translate(0 ${mood === 'sleeping' ? 2 : 0})`}>
          {recipe.attentionCount === 0 ? (
            <path className="character-signal" d="M44 45 Q50 40 56 45" fill="none" stroke={ink} strokeWidth="2.2" strokeLinecap="round" />
          ) : Array.from({ length: recipe.attentionCount }, (_, index) => {
            const offset = (index - (recipe.attentionCount - 1) / 2) * Math.min(7, attentionGap / Math.max(1, recipe.attentionCount - 1));
            return <circle key={index} className="character-eye" cx={50 + offset} cy={character.rig.attention.y} r="2.2" fill={ink} />;
          })}
          <path className="character-mouth" d={mood === 'happy' ? 'M46 54 Q50 59 55 53' : mood === 'tired' || mood === 'sleeping' ? 'M47 56 Q50 54 53 56' : 'M47 55 Q50 57 53 55'} fill="none" stroke={ink} strokeWidth="1.6" strokeLinecap="round" />
        </g>
        {accessory === 'glasses' ? <g className="character-accessory" fill="none" stroke={ink} strokeWidth="1.6"><circle cx="44" cy="45" r="6" /><circle cx="56" cy="45" r="6" /><path d="M50 45h0.5" /></g> : null}
        {accessory === 'leaf' ? <path className="character-accessory" d="M50 24 Q63 17 61 31 Q54 33 50 29 Q47 23 42 21" fill={base} stroke={ink} strokeWidth="1.4" /> : null}
        {accessory === 'cup' ? <g className="character-accessory"><path d="M68 64h12v13H68z" fill={light} stroke={ink} strokeWidth="1.4" /><path d="M80 67q7 0 4 7q-1 2-4 2" fill="none" stroke={ink} strokeWidth="1.4" /></g> : null}
        <g className="character-action-props">
          {(action === 'eye' || action === 'combined') ? <path className="eye-path" d="M12 49 Q50 20 88 49 Q50 78 12 49Z" fill="none" stroke={light} strokeWidth="2" /> : null}
          {(action === 'walk' || action === 'combined') ? <path className="walk-path" d="M18 86 Q34 73 50 86 T82 86" fill="none" stroke={light} strokeWidth="2.4" strokeLinecap="round" /> : null}
        </g>
      </svg>
    </div>
  );
});
