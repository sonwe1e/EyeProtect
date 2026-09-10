import { memo, useEffect, useState } from 'react';
import type { PixelAnimal as Animal } from '../../../../shared/pixelAnimals';

// Every contour sits on a 64 x 64 grid. Stepped fills provide volume without
// gradients or subpixel transforms; ears, face and limbs switch whole frames.
// Memoized because the alert window re-renders once per countdown second and
// must not redraw the artwork.
export const PixelAnimal = memo(function PixelAnimal({ animal, action, label }: { animal: Animal; action: string; label: string }): JSX.Element {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = (): void => { clearInterval(timer); setFrame(0); };
    const start = (): void => {
      stop();
      if (action === 'idle' || document.hidden || reduced.matches) return;
      let step = 0;
      timer = setInterval(() => {
        step += 1;
        setFrame(step % 3);
        if (step >= 8) stop();
      }, 160);
    };
    document.addEventListener('visibilitychange', start);
    reduced.addEventListener('change', start);
    start();
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', start); reduced.removeEventListener('change', start); };
  }, [action, animal]);
  const cat = animal === 'cat';
  const rabbit = animal === 'rabbit';
  const ink = '#34303d';
  const dark = rabbit ? '#a5a1b0' : cat ? '#b5673e' : '#987055';
  const mid = rabbit ? '#dddce3' : cat ? '#eaa35d' : '#cca57a';
  const light = rabbit ? '#fff9f0' : cat ? '#ffd797' : '#f4dab0';
  const cream = '#fff0d4';
  const pink = '#eaa4a9';
  const blink = frame === 2;
  return <div className="pixel-animal" role="img" aria-label={label} data-animal={animal} data-frame={frame}>
    <svg viewBox="0 0 64 64" shapeRendering="crispEdges" aria-hidden="true">
      <path fill={ink} opacity=".15" d="M18 59H46V61H18Z" />
      {cat ? <g><path fill={ink} d={frame === 1 ? 'M44 47H50V41H54V49H52V53H44Z' : 'M43 49H49V45H53V51H51V55H43Z'} /><path fill={mid} d={frame === 1 ? 'M46 49H50V45H52V49H50V51H46Z' : 'M45 51H49V49H51V51H49V53H45Z'} /></g> : null}
      <path fill={ink} d="M23 39H41V43H44V54H42V60H33V57H31V60H22V54H20V44H23Z" />
      <path fill={dark} d="M24 41H40V45H42V53H40V58H35V54H29V58H24V53H22V46H24Z" />
      <path fill={mid} d="M24 42H38V49H40V54H35V52H28V56H24Z" />
      <path fill={light} d="M27 43H37V45H39V51H36V53H28V51H25V46H27Z" />
      <path fill={cream} d="M28 44H35V49H28Z" />
      <path fill={ink} d="M20 43H24V51H22V53H18V50H16V46H18V44H20ZM40 43H44V44H46V46H48V50H46V53H42V51H40Z" />
      <path fill={mid} d="M20 45H22V50H19V48H18V46H20ZM42 45H44V46H46V49H44V51H42Z" />
      <path fill={light} d="M19 46H21V49H19ZM43 46H45V49H43Z" />
      {rabbit ? <g>
        <path fill={ink} d={frame === 1 ? 'M19 8H25V10H27V28H18V12H19ZM37 10H40V8H46V12H47V28H37Z' : 'M18 8H25V10H27V28H18ZM37 10H39V8H46V28H37Z'} />
        <path fill={light} d="M20 10H24V26H20ZM40 10H44V26H39V14H40Z" />
        <path fill={pink} d="M22 12H24V26H22ZM41 12H43V26H40V16H41Z" />
      </g> : cat ? <g>
        <path fill={ink} d="M13 8H18V10H21V12H24V20H12V10H13ZM46 8H51V10H52V20H40V12H43V10H46Z" />
        <path fill={mid} d="M14 10H17V12H20V15H22V20H14ZM47 10H50V20H42V15H44V12H47Z" />
        <path fill={pink} d="M15 13H17V15H20V19H15ZM47 13H49V19H44V15H47Z" />
      </g> : <g>
        <path fill={ink} d="M13 8H22V12H24V28H12V26H9V15H11V11H13ZM42 8H51V11H53V15H55V26H52V28H40V12H42Z" />
        <path fill={dark} d="M14 10H21V24H12V16H14ZM43 10H50V16H52V24H43Z" />
        <path fill={mid} d="M15 11H19V21H14V15H15ZM44 11H48V15H50V21H46V17H44Z" />
      </g>}
      <path fill={ink} d={rabbit ? 'M24 22H40V24H46V27H50V30H52V38H50V42H46V45H40V47H24V45H18V42H14V38H12V30H14V27H18V24H24Z' : 'M24 14H40V16H46V19H50V24H52V36H50V40H46V43H40V45H24V43H18V40H14V36H12V24H14V19H18V16H24Z'} />
      <path fill={dark} d={rabbit ? 'M24 24H40V26H46V29H48V31H50V37H48V41H44V43H39V45H25V43H19V40H16V37H14V31H16V29H20V26H24Z' : 'M24 16H40V18H46V21H48V25H50V35H48V39H44V41H39V43H25V41H19V38H16V34H14V25H16V21H20V18H24Z'} />
      <path fill={mid} d={rabbit ? 'M24 24H40V26H45V29H47V31H48V36H46V39H43V41H21V39H18V36H16V31H18V29H21V26H24Z' : 'M24 16H40V18H45V21H47V25H48V34H46V37H43V39H21V37H18V34H16V25H18V21H21V18H24Z'} />
      <path fill={light} d={rabbit ? 'M24 26H39V28H44V30H46V32H42V30H23V32H18V30H20V29H24Z' : 'M24 18H39V20H44V22H46V25H42V23H23V25H18V23H20V21H24Z'} />
      <g transform={rabbit ? 'translate(0 4)' : undefined}>
        <path fill={light} d="M21 32H27V34H37V32H43V37H40V40H24V38H21Z" />
        <path fill={cream} d="M26 33H38V38H26Z" />
        {cat ? <path fill={dark} d="M27 17H30V23H27ZM33 17H36V23H33ZM16 28H21V30H16ZM43 28H48V30H43Z" /> : null}
        {!cat && !rabbit ? <path fill={cream} d="M30 19H34V28H37V32H27V28H30Z" /> : null}
        <path fill={ink} d={blink ? 'M22 29H27V31H22ZM37 29H42V31H37Z' : 'M23 26H27V32H23ZM37 26H41V32H37Z'} />
        {!blink ? <path fill="#fff9f0" d="M23 26H25V28H23ZM37 26H39V28H37Z" /> : null}
        <path fill={pink} d="M19 32H23V34H19ZM41 32H45V34H41Z" />
        <path fill={ink} d="M30 32H34V34H33V36H31V34H30ZM28 36H31V37H28ZM33 36H36V37H33Z" />
        {frame === 1 ? <path fill={pink} d="M31 37H33V39H31Z" /> : null}
      </g>
      <path fill={light} d="M24 56H28V58H24ZM36 56H40V58H36Z" />
    </svg>
  </div>;
});
