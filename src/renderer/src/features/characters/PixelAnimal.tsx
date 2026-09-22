import { memo } from 'react';
import { useAnimalFrame } from './useAnimalFrame';
import type { PixelAnimal as Animal } from '../../../../shared/pixelAnimals';

// Contour sits on a 64 x 64 grid. Stepped fills provide volume without
// gradients or subpixel transforms; ears, face and limbs switch whole frames.
// Memoized because the alert window re-renders once per countdown second and
// must not redraw the artwork.
export const PixelAnimal = memo(function PixelAnimal({ animal, action, label, motion = true }: { animal: Animal; action: string; label: string; motion?: boolean }): JSX.Element {
  const frame = useAnimalFrame(action, animal, motion);
  const beat = [0, 1, 2, 3, 2, 1, 0, -1, -2, -3, -2, -1][frame];
  const resting = action === 'eye' || action === 'sleep';
  const walking = action === 'walk' || action === 'combined';
  const stretch = action === 'fidget' ? Math.abs(beat) : 0;
  const ink = '#34303d';
  const dark = '#b5673e';
  const mid = '#eaa35d';
  const light = '#ffd797';
  const cream = '#fff0d4';
  const pink = '#eaa4a9';
  const blink = resting || frame === 5;
  return <div className="pixel-animal" role="img" aria-label={label} data-animal={animal} data-action={action} data-frame={frame}>
    <svg viewBox="0 0 64 64" shapeRendering="crispEdges" aria-hidden="true">
      <path fill={ink} opacity=".15" d="M18 59H46V61H18Z" />
      <g>
      <g transform={`rotate(${beat * 6} 44 53)`}><path fill={ink} d={frame === 1 ? 'M44 47H50V41H54V49H52V53H44Z' : 'M43 49H49V45H53V51H51V55H43Z'} /><path fill={mid} d={frame === 1 ? 'M46 49H50V45H52V49H50V51H46Z' : 'M45 51H49V49H51V51H49V53H45Z'} /></g>
      <path fill={ink} d="M23 39H41V43H44V54H42V60H33V57H31V60H22V54H20V44H23Z" />
      <path fill={dark} d="M24 41H40V45H42V53H40V58H35V54H29V58H24V53H22V46H24Z" />
      <path fill={mid} d="M24 42H38V49H40V54H35V52H28V56H24Z" />
      <path fill={light} d="M27 43H37V45H39V51H36V53H28V51H25V46H27Z" />
      <path fill={cream} d="M28 44H35V49H28Z" />
      <g transform={`translate(0 ${walking ? beat : -stretch * 2})`}>
        <path fill={ink} d="M20 43H24V51H22V53H18V50H16V46H18V44H20Z" />
        <path fill={mid} d="M20 45H22V50H19V48H18V46H20Z" />
        <path fill={light} d="M19 46H21V49H19Z" />
      </g>
      <g transform={`translate(0 ${walking ? -beat : action === 'react' ? -Math.abs(beat) * 2 : -stretch * 2})`}>
        <path fill={ink} d="M40 43H44V44H46V46H48V50H46V53H42V51H40Z" />
        <path fill={mid} d="M42 45H44V46H46V49H44V51H42Z" />
        <path fill={light} d="M43 46H45V49H43Z" />
      </g>
      <g transform={`translate(0 ${resting ? 2 : -stretch})`}>
      <g>
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
        {frame === 1 ? <path fill={pink} d="M31 37H33V39H31Z" /> : null}
      </g>
      </g>
      <path transform={`translate(0 ${walking ? -Math.abs(beat) : 0})`} fill={light} d="M24 56H28V58H24ZM36 56H40V58H36Z" />
      </g>
    </svg>
  </div>;
});
