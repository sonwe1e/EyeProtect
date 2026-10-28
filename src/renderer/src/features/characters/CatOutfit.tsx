import type { PetOutfit } from '../../../../shared/pixelAnimals';

// Artwork colors belong to the character, independently of the app theme.
const ink = '#38313e';
const mint = '#6eb7a5';
const mintDark = '#3a796b';
const gold = '#f6ce75';
const violet = '#8d86c9';
const navy = '#4e4b78';

export function CatOutfitBody({ outfit }: { outfit: PetOutfit }): JSX.Element | null {
  if (outfit === 'coffee') return <g>
    <path fill={ink} d="M25 40H29V43H35V40H39V55H25Z" />
    <path fill={mintDark} d="M27 41H28V45H36V41H37V54H27Z" />
    <path fill={mint} d="M28 44H36V53H28Z" />
    <path fill="#e5f1db" d="M29 48H35V51H29Z" />
    <path fill={gold} d="M31 45H33V47H31Z" />
  </g>;
  if (outfit === 'explorer') return <g>
    <path fill={ink} d="M24 40H39V45H33V48H28V45H24Z" />
    <path fill={mintDark} d="M26 41H37V43H32V46H29V43H26Z" />
    <path fill={mint} d="M27 41H36V42H31V44H29V42H27Z" />
    <path fill={ink} d="M25 44H28V47H31V49H35V51H38V53H35V52H31V50H28V48H25Z" />
    <path fill="#aa7751" d="M34 49H43V57H34Z" />
    <path fill={ink} d="M34 49H43V51H34ZM34 55H43V57H34Z" />
    <path fill={gold} d="M37 51H40V54H37Z" />
  </g>;
  if (outfit === 'stargazer') return <g>
    <path fill={ink} d="M23 40H41V45H43V56H37V53H27V56H21V45H23Z" />
    <path fill={navy} d="M24 42H40V46H41V54H38V51H26V54H23V46H24Z" />
    <path fill={violet} d="M25 42H39V44H35V46H29V44H25Z" />
    <path fill={gold} d="M31 43H33V46H31ZM25 48H27V50H25ZM37 49H39V51H37Z" />
  </g>;
  return null;
}

export function CatOutfitHead({ outfit }: { outfit: PetOutfit }): JSX.Element | null {
  if (outfit === 'coffee') return <g>
    <path fill={ink} d="M22 13H37V15H43V20H20V15H22Z" />
    <path fill={mintDark} d="M24 14H36V16H41V18H22V16H24Z" />
    <path fill={mint} d="M25 14H35V16H38V17H24Z" />
    <path fill={gold} d="M29 15H33V17H29Z" />
  </g>;
  if (outfit === 'explorer') return <g>
    <path fill={ink} d="M24 6H40V8H43V15H48V20H16V15H21V8H24Z" />
    <path fill="#cfad72" d="M25 8H39V10H41V15H23V10H25ZM18 17H46V18H18Z" />
    <path fill="#f0d69c" d="M26 8H38V10H26Z" />
    <path fill={mintDark} d="M23 13H41V16H23Z" />
    <path fill={mint} d="M35 9H39V11H37V13H35Z" />
  </g>;
  if (outfit === 'stargazer') return <g>
    <path fill={ink} d="M31 3H38V5H35V8H37V11H39V14H42V17H46V21H18V17H22V14H25V10H28V6H31Z" />
    <path fill={navy} d="M32 5H35V6H33V9H35V12H37V15H40V17H24V15H27V11H30V7H32Z" />
    <path fill={violet} d="M32 5H34V6H32V9H31V12H29V15H27V11H30V7H32ZM20 18H44V19H20Z" />
    <path fill={gold} d="M33 11H35V13H37V15H35V17H33V15H31V13H33Z" />
  </g>;
  return null;
}

/** Gesture 0 is the resting prop; 1–3 lift it through a single short action. */
export function CatOutfitProp({ outfit, gesture }: { outfit: PetOutfit; gesture: number }): JSX.Element | null {
  if (outfit === 'coffee') return <g transform={`translate(${-gesture * 3} ${-gesture * 4})`}>
    <path fill={ink} d="M43 45H53V47H56V52H53V55H44V53H43Z" />
    <path fill="#fff0d4" d="M45 47H51V53H45ZM53 48H54V51H53Z" />
    <path fill="#b5673e" d="M45 46H51V48H45Z" />
    <path fill={mint} d="M45 50H51V52H45Z" />
    {gesture > 0 ? <path fill="#fff0d4" d="M46 40H48V43H46ZM50 38H52V41H50Z" /> : null}
  </g>;
  if (outfit === 'explorer') return <g transform={`translate(${-gesture * 6} ${-gesture * 6})`}>
    <path fill={ink} d="M39 44H47V46H53V44H61V54H53V51H47V54H39Z" />
    <path fill={mintDark} d="M41 45H45V53H41ZM55 45H59V53H55ZM46 47H54V50H46Z" />
    <path fill="#b3ddd0" d="M40 50H46V52H40ZM54 50H60V52H54Z" />
  </g>;
  if (outfit === 'stargazer') return <g>
    <g transform={`translate(${-gesture} ${-gesture})`}>
      <path fill={ink} d="M46 38H49V53H46Z" />
      <path fill="#aa7751" d="M47 39H48V52H47Z" />
      <path fill={ink} d="M46 29H50V32H53V36H50V39H46V36H43V32H46Z" />
      <path fill={gold} d="M47 30H49V33H52V35H49V38H47V35H44V33H47Z" />
      <path fill="#fff0d4" d="M47 32H49V34H47Z" />
    </g>
    {gesture > 0 ? <g fill={gold}>
      <path d={`M${53 + gesture} 24h2v2h2v2h-2v2h-2v-2h-2v-2h2Z`} />
      <path d={`M${11 - gesture} 36h2v2h2v2h-2v2h-2v-2H${9 - gesture}v-2h2Z`} />
      {gesture === 3 ? <path fill="#fff0d4" d="M54 14H56V16H54ZM16 23H18V25H16Z" /> : null}
    </g> : null}
  </g>;
  return null;
}
