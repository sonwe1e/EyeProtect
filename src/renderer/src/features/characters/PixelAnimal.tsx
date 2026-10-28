import { memo } from 'react';
import { useAnimalFrame } from './useAnimalFrame';
import type { PixelAnimal as Animal, PetOutfit } from '../../../../shared/pixelAnimals';
import { CatOutfitBody, CatOutfitHead, CatOutfitProp } from './CatOutfit';

// Contour sits on a 64 x 64 grid. Stepped fills provide volume without
// gradients or subpixel transforms; ears, face and limbs switch whole frames.
// Memoized because the alert window re-renders once per countdown second and
// must not redraw the artwork.
/**
 * How full the glass is on a given sip frame, 3 = just poured, 0 = finished.
 *
 * Pure and exported so the artwork's timing can be asserted without a browser:
 * twelve frames at 216ms cover the 2.6s the main process allows for the sip, and
 * the level falls in three visible steps rather than a smooth fade (pixel art
 * reads state changes, not gradients). An out-of-range frame — which is what
 * `motion: false` produces for every action except this one — shows an empty
 * glass rather than inventing a frame.
 */
export const sipWaterLevel = (frame: number): 0 | 1 | 2 | 3 => {
  if (!Number.isFinite(frame) || frame < 0 || frame > 11) return 0;
  if (frame < 4) return 3;
  if (frame < 7) return 2;
  if (frame < 10) return 1;
  return 0;
};

/** Water rectangle inside the glass for each level; null means "nothing left". */
const SIP_WATER: Record<0 | 1 | 2 | 3, { y: number; height: number } | null> = {
  3: { y: 44, height: 7 },
  2: { y: 46, height: 5 },
  1: { y: 48, height: 3 },
  0: null
};

export const PixelAnimal = memo(function PixelAnimal({ animal, outfit = 'classic', action, label, motion = true, animationKey }: { animal: Animal; outfit?: PetOutfit; action: string; label: string; motion?: boolean; animationKey?: string | number }): JSX.Element {
  const frame = useAnimalFrame(action, `${animal}:${outfit}`, motion, animationKey);
  const idle = action === 'idle' || action === 'breathe';
  const interacting = outfit !== 'classic' && (action === 'react' || action === 'fidget');
  const gesture = interacting ? [0, 1, 2, 3, 3, 3, 2, 1, 0, 0, 0, 0][frame] ?? 0 : 0;
  const beat = idle ? 0 : [0, 1, 2, 3, 2, 1, 0, -1, -2, -3, -2, -1][frame] ?? 0;
  const resting = action === 'sleep' || action === 'focus';
  const walking = action === 'walk' || (action === 'combined' && frame >= 6);
  const looking = action === 'eye' || action === 'gaze' || (action === 'combined' && frame < 6);
  const stretch = action === 'stretch' || (action === 'fidget' && !interacting) ? Math.abs(beat) : 0;
  const breathing = idle && frame % 20 >= 10 ? -1 : 0;
  const jump = action === 'celebrate' ? -Math.abs(beat) : 0;
  const ink = '#38313e';
  const dark = '#b5673e';
  const mid = '#eaa35d';
  const light = '#ffd797';
  const cream = '#fff0d4';
  const pink = '#eaa4a9';
  // Glass and water: the only cool colours in the palette, because the prop is
  // an object from outside the cat's warm world (see design/pet-moments.html).
  const glass = '#dff0f4';
  const water = '#6fbfd0';
  const sip = action === 'sip';
  const sipWater = sip ? SIP_WATER[sipWaterLevel(frame)] : null;
  const sipLift = sip ? -Math.min(3, Math.max(0, frame % 4)) : 0;
  const blink = resting || (idle ? frame % 50 === 43 : action === 'blink' || looking ? frame === 4 || frame === 8 : frame === 5);
  return <div className="pixel-animal" role="img" aria-label={label} data-animal={animal} data-outfit={outfit} data-action={action} data-frame={frame}>
    <svg viewBox="0 0 64 64" shapeRendering="crispEdges" aria-hidden="true">
      <path fill={ink} opacity=".15" d="M18 59H46V61H18Z" />
      <g transform={`translate(0 ${breathing + jump})`}>
      <g transform={`translate(${beat > 0 ? 1 : beat < 0 ? -1 : 0} 0)`}><path fill={ink} d={!idle && frame === 1 ? 'M44 47H50V41H54V49H52V53H44Z' : 'M43 49H49V45H53V51H51V55H43Z'} /><path fill={mid} d={!idle && frame === 1 ? 'M46 49H50V45H52V49H50V51H46Z' : 'M45 51H49V49H51V51H49V53H45Z'} /></g>
      <path fill={ink} d="M23 39H41V43H44V54H42V60H33V57H31V60H22V54H20V44H23Z" />
      <path fill={dark} d="M24 41H40V45H42V53H40V58H35V54H29V58H24V53H22V46H24Z" />
      <path fill={mid} d="M24 42H38V49H40V54H35V52H28V56H24Z" />
      <path fill={light} d="M27 43H37V45H39V51H36V53H28V51H25V46H27Z" />
      <path fill={cream} d="M28 44H35V49H28Z" />
      <CatOutfitBody outfit={outfit} />
      <g transform={`translate(${outfit === 'explorer' ? gesture : 0} ${walking ? beat : outfit === 'explorer' ? -gesture * 3 : -stretch * 2})`}>
        <path fill={ink} d="M20 43H24V51H22V53H18V50H16V46H18V44H20Z" />
        <path fill={mid} d="M20 45H22V50H19V48H18V46H20Z" />
        <path fill={light} d="M19 46H21V49H19Z" />
      </g>
      <g transform={`translate(${outfit === 'coffee' ? -gesture * 2 : 0} ${walking ? -beat : interacting ? -gesture * 4 : action === 'react' ? -Math.abs(beat) * 2 : -stretch * 2})`}>
        <path fill={ink} d="M40 43H44V44H46V46H48V50H46V53H42V51H40Z" />
        <path fill={mid} d="M42 45H44V46H46V49H44V51H42Z" />
        <path fill={light} d="M43 46H45V49H43Z" />
      </g>
      <g transform={`translate(0 ${resting ? 2 : looking && frame > 0 ? -1 : -stretch})`}>
      <g transform={sip ? 'translate(0 -1)' : undefined}>{/* A sip lifts the ears by one whole pixel. */}
        <path fill={ink} d="M13 8H18V10H21V12H24V20H12V10H13ZM46 8H51V10H52V20H40V12H43V10H46Z" />
        <path fill={mid} d="M14 10H17V12H20V15H22V20H14ZM47 10H50V20H42V15H44V12H47Z" />
        <path fill={pink} d="M15 13H17V15H20V19H15ZM47 13H49V19H44V15H47Z" />
      </g>
      <path fill={ink} d="M24 14H40V16H46V19H50V24H52V36H50V40H46V43H40V45H24V43H18V40H14V36H12V24H14V19H18V16H24Z" />
      <path fill={dark} d="M24 16H40V18H46V21H48V25H50V35H48V39H44V41H39V43H25V41H19V38H16V34H14V25H16V21H20V18H24Z" />
      <path fill={mid} d="M24 16H40V18H45V21H47V25H48V34H46V37H43V39H21V37H18V34H16V25H18V21H21V18H24Z" />
      <path fill={light} d="M24 18H39V20H44V22H46V25H42V23H23V25H18V23H20V21H24Z" />
      <g>
        <path fill={light} d="M21 32H27V34H37V32H43V37H40V40H24V38H21Z" />
        <path fill={cream} d="M26 33H38V38H26Z" />
        <path fill={dark} d="M27 17H30V23H27ZM33 17H36V23H33ZM16 28H21V30H16ZM43 28H48V30H43Z" />
        <path fill={ink} d={blink ? 'M22 29H27V31H22ZM37 29H42V31H37Z' : 'M23 26H27V32H23ZM37 26H41V32H37Z'} />
        {!blink ? <path fill="#fff9f0" d="M23 26H25V28H23ZM37 26H39V28H37Z" /> : null}
        <path fill={pink} d="M19 32H23V34H19ZM41 32H45V34H41Z" />
        <path fill={ink} d="M30 32H34V34H33V36H31V34H30ZM28 36H31V37H28ZM33 36H36V37H33Z" />
        {!idle && frame === 1 ? <path fill={pink} d="M31 37H33V39H31Z" /> : null}
      </g>
      <CatOutfitHead outfit={outfit} />
      </g>
      <CatOutfitProp outfit={outfit} gesture={gesture} />
      {/* The glass sits in the right paw, in front of the body, and the water
          level is a whole step per few frames — pixel art communicates state by
          changing shape, not by fading. */}
      {sip ? <g transform={`translate(0 ${sipLift})`}>
        <path fill={ink} d="M39 41H51V43H50V50H49V54H41V50H40V43H39Z" />
        <path fill={glass} d="M41 43H49V50H48V52H42V50H41Z" />
        {sipWater ? <path fill={water} d={`M42 ${sipWater.y}H48V${sipWater.y + sipWater.height}H42Z`} /> : null}
        <path fill={cream} d="M42 43H43V46H42Z" />
      </g> : null}
      <path transform={`translate(0 ${walking && beat > 0 ? -1 : 0})`} fill={light} d="M24 56H28V58H24Z" />
      <path transform={`translate(0 ${walking && beat < 0 ? -1 : 0})`} fill={light} d="M36 56H40V58H36Z" />
      </g>
    </svg>
  </div>;
});
