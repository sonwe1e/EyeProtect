import { useAnimalFrame } from './useAnimalFrame';

// Whole-grid shapes and stepped animation echo the original fighter cat while
// keeping each companion's own silhouette, props and response to interaction.
export function IllustratedPet({ companion, action = 'idle', motion = true, animationKey, label }: {
  companion: 'otter' | 'penguin'; action?: string; motion?: boolean; animationKey?: string | number; label: string;
}): JSX.Element {
  const frame = useAnimalFrame(action, companion, motion, animationKey);
  const idle = action === 'idle' || action === 'breathe';
  const sleeping = ['sleep', 'focus', 'eye', 'combined'].includes(action);
  const blink = sleeping || (idle ? frame % 50 === 43 : action === 'blink' || action === 'gaze' ? frame === 4 || frame === 8 : frame === 5);
  const gesture = !idle ? [0, 1, 2, 3, 3, 3, 2, 1, 0, 0, 0, 0][frame] ?? 0 : 0;
  const interacting = ['react', 'fidget', 'celebrate', 'sip'].includes(action);
  const lift = idle && frame % 20 >= 10 ? -1 : action === 'celebrate' ? -gesture : 0;
  const ink = '#38313e';
  const cream = '#fff0d4';
  const shine = '#fff9e9';
  const eye = (x: number, y: number): JSX.Element => blink
    ? <path fill={ink} d={`M${x} ${y + 3}h5v2h-5z`} />
    : <g><path fill={ink} d={`M${x} ${y}h5v7h-5z`} /><path fill={shine} d={`M${x} ${y}h2v2h-2z`} /></g>;
  const star = (x: number, y: number): JSX.Element => <path fill="#ffce72" d={`M${x + 2} ${y}h2v2h2v2h-2v2h-2v-2h-2v-2h2z`} />;

  return <div className="illustrated-pet" data-companion={companion} data-action={action} data-frame={frame} data-motion={motion ? 'on' : 'off'}>
    <svg viewBox="0 0 64 64" shapeRendering="crispEdges" role="img" aria-label={label}>
      {companion === 'otter' ? <>
        {/* The pool anchors the floating otter, while small highlights stay on the pixel grid. */}
        <path fill={ink} d="M10 48H54V50H59V53H61V57H58V59H53V61H12V59H7V57H4V53H7V50H10Z" />
        <path fill="#609f9f" d="M10 50H54V52H58V54H59V56H56V58H52V59H13V57H8V56H6V54H9V52H10Z" />
        <path fill="#8bcac2" d="M10 51H54V53H57V55H54V57H14V56H9V54H10Z" />
        <path fill="#d6f2dc" d="M10 54H20V55H10ZM45 54H54V55H45ZM18 57H31V58H18Z" />
        <g className="illustrated-pet-body" transform={`translate(0 ${lift})`}>
          <path fill={ink} d="M43 37H51V39H56V41H59V44H60V47H58V49H53V48H49V47H44Z" />
          <path fill="#a77555" d="M45 39H51V41H55V43H57V46H55V47H52V46H48V44H45Z" />
          <path fill="#e0b38a" d="M48 40H51V42H54V43H50V42H48Z" />
          <path fill={ink} d="M24 27H41V29H47V32H50V36H52V42H51V46H48V49H43V51H28V49H23V47H20V43H18V36H20V32H22V29H24Z" />
          <path fill="#9d694e" d="M25 29H40V31H46V34H48V37H50V42H49V45H46V48H42V49H29V47H24V45H22V42H20V37H22V33H25Z" />
          <path fill="#c69269" d="M25 30H39V32H44V35H47V39H48V42H46V45H42V47H30V45H25V43H23V38H24V34H25Z" />
          <path fill="#f0cda0" d="M28 33H38V35H42V38H44V42H42V45H38V46H30V44H27V41H26V37H28Z" />
          <path fill={ink} d="M37 45H45V43H49V45H50V48H47V50H40V49H37ZM25 45H32V47H34V50H31V52H25V50H23V47H25Z" />
          <path fill="#bb855e" d="M39 46H45V45H48V47H46V48H40ZM26 47H31V49H32V50H26V49H25V48H26Z" />
          {/* Rounded ears become small stepped ears, matching the cat's outline weight. */}
          <path fill={ink} d="M11 12H13V9H19V11H21V16H12ZM30 11H32V8H38V10H40V16H31Z" />
          <path fill="#c69269" d="M13 11H18V13H19V16H13ZM33 10H37V12H38V16H32V12H33Z" />
          <path fill="#e3a899" d="M14 13H17V15H14ZM34 12H37V14H34Z" />
          <path fill={ink} d="M18 12H33V14H38V17H41V21H42V27H40V31H37V34H33V36H19V34H15V32H12V29H10V22H11V18H13V15H18Z" />
          <path fill="#a97150" d="M18 14H33V16H37V19H39V22H40V27H38V30H35V32H32V34H20V32H16V30H14V27H12V22H14V19H16V16H18Z" />
          <path fill="#c9966c" d="M19 15H32V17H36V20H38V26H36V29H33V31H20V30H17V28H15V25H14V21H16V18H19Z" />
          <path fill="#e4b58a" d="M20 16H31V18H35V20H31V19H21V20H17V19H20Z" />
          <path fill={cream} d="M16 25H21V24H24V26H28V24H32V25H37V29H35V31H32V33H20V31H17V29H16Z" />
          {eye(18, 21)}{eye(30, 21)}
          <path fill="#df9f91" d="M15 27H19V29H15ZM34 27H38V29H34Z" />
          <path fill={ink} d="M24 27H29V29H28V30H26V29H24ZM23 30H26V31H23ZM28 30H31V31H28Z" />
          <path fill="#8d634e" d="M13 30H19V31H13ZM34 30H40V31H34Z" />
          {/* Pink shell with two paws: it remains legible in the small picker. */}
          <path fill={ink} d="M27 33H30V32H36V33H39V36H40V40H38V42H28V41H26V38H25V35H27Z" />
          <path fill="#c9827d" d="M28 34H30V33H36V34H38V36H39V39H37V41H29V40H28V38H27V35H28Z" />
          <path fill="#f2b4a5" d="M29 34H35V35H37V38H35V40H30V39H29V37H28V35H29Z" />
          <path fill="#d88f88" d="M30 35H31V39H30ZM33 34H34V39H33ZM36 35H37V38H36Z" />
          <path fill={ink} d="M23 33H27V35H28V39H26V40H23V39H21V35H23Z" />
          <path fill="#d3a178" d="M23 35H26V38H24V37H23Z" />
          <g transform={`translate(0 ${interacting ? -gesture : 0})`}>
            <path fill={ink} d="M39 33H42V35H44V38H42V40H39V39H38V35H39Z" />
            <path fill="#d3a178" d="M40 35H42V37H41V38H40Z" />
          </g>
        </g>
        {interacting && gesture > 0 ? <g transform={`translate(${gesture} ${-gesture * 2})`}>
          <path fill="#6faeae" d="M45 14H51V16H53V22H51V24H45V22H43V16H45Z" />
          <path fill="#d6f2e4" d="M45 16H51V17H52V21H50V22H46V21H44V17H45Z" />
          <path fill={shine} d="M46 17H48V19H46Z" />
          <path fill="#b6ded1" d="M56 11H58V13H60V16H58V18H56V16H54V13H56Z" />
        </g> : null}
      </> : <>
        <path fill="#e8d1b6" d="M18 58H47V60H18Z" />
        {star(7, 16)}{star(54, 29)}
        <g className="illustrated-pet-body" transform={`translate(0 ${lift})`}>
          {/* Backpack and boots make the astronaut silhouette distinct. */}
          <path fill={ink} d="M45 30H52V32H55V45H53V48H46V46H44V33H45Z" />
          <path fill="#84aaa9" d="M47 32H52V34H53V44H51V46H47Z" />
          <path fill="#d3e7d8" d="M49 34H51V42H49Z" />
          <path fill={ink} d="M19 51H29V54H31V57H29V59H17V58H15V55H17V53H19ZM35 51H45V53H47V55H49V58H47V59H35V57H33V54H35Z" />
          <path fill="#d9955c" d="M19 53H28V55H29V57H17V56H18V54H19ZM36 53H44V54H46V56H47V57H35V55H36Z" />
          <path fill="#f6c47d" d="M20 54H27V55H18V56H17V55H19V54H20ZM37 54H43V55H45V56H36V55H37Z" />
          <path fill={ink} d="M22 30H42V32H47V35H49V39H50V49H48V53H45V55H39V56H25V55H19V53H16V49H15V39H16V35H18V32H22Z" />
          <path fill="#c9d5cb" d="M22 32H42V34H46V37H48V40H48V48H46V51H43V53H39V54H25V53H21V51H18V48H17V40H18V37H20V34H22Z" />
          <path fill="#f7edda" d="M22 33H41V35H45V38H46V47H44V50H41V52H25V51H22V49H20V46H19V38H20V35H22Z" />
          <path fill={ink} d="M17 37H14V39H12V42H11V46H12V48H15V47H18V45H20V40H19V38H17Z" />
          <path fill="#dbe8da" d="M16 39H18V44H16V46H13V44H14V41H15V40H16Z" />
          <g transform={`translate(0 ${interacting ? -gesture * 2 : 0})`}>
            <path fill={ink} d="M47 37H50V39H52V42H53V46H52V48H49V47H46V45H44V40H45V38H47Z" />
            <path fill="#dbe8da" d="M47 39H49V40H50V41H51V44H52V46H49V44H47Z" />
          </g>
          <path fill="#88afa9" d="M21 38H24V39H41V38H44V41H41V42H24V41H21Z" />
          <path fill={ink} d="M26 44H39V45H41V51H39V52H26V51H24V45H26Z" />
          <path fill="#9fc6b8" d="M26 45H39V50H38V51H26V50H25V46H26Z" />
          <path fill="#f8c574" d="M28 47H30V49H28Z" /><path fill={shine} d="M32 47H37V48H32ZM32 49H36V50H32Z" />
          {/* A stepped helmet rim frames the dark penguin face. */}
          <path fill={ink} d="M24 7H40V9H45V11H48V14H50V18H51V27H50V31H48V34H45V36H40V38H24V36H19V34H16V31H14V27H13V18H14V14H16V11H19V9H24Z" />
          <path fill="#c2d3c9" d="M24 9H40V11H44V13H47V16H49V19H49V27H48V30H46V32H43V34H39V36H25V34H21V32H18V30H16V27H15V19H16V16H18V13H21V11H24Z" />
          <path fill="#f8f0dd" d="M24 10H39V12H43V14H46V17H47V20H47V26H46V29H44V31H41V33H38V34H26V33H22V31H20V29H18V26H17V20H18V17H20V14H23V12H24Z" />
          <path fill="#485264" d="M25 13H39V15H43V17H45V20H46V26H45V29H43V31H39V33H25V31H21V29H19V26H18V20H19V17H21V15H25Z" />
          <path fill="#f8e9d1" d="M23 21H24V18H28V19H30V22H34V19H36V18H40V21H41V24H42V27H40V29H37V31H27V30H24V29H22V27H21V24H22V21H23Z" />
          {eye(24, 22)}{eye(35, 22)}
          <path fill="#eda99b" d="M21 27H24V29H21ZM40 27H43V29H40Z" />
          <path fill="#b9794e" d="M29 27H35V29H34V30H30V29H29Z" /><path fill="#ffd28a" d="M30 27H34V28H30Z" />
          <path fill={shine} d="M22 14H25V13H30V14H25V15H22ZM19 16H21V19H19Z" />
          <path fill={ink} d="M12 22H16V24H17V29H15V31H12V29H11V24H12ZM48 22H52V24H53V29H52V31H49V29H47V24H48Z" />
          <path fill="#8cbab1" d="M12 24H15V29H12ZM49 24H52V29H49Z" />
        </g>
        {interacting && gesture > 0 ? <g transform={`translate(${-gesture} ${gesture})`}>
          <path fill="#c0d8ca" d="M56 22H63V23H59V24H54V23H56ZM57 26H63V27H57Z" />
          <path fill={ink} d="M52 22H55V24H58V27H55V30H52V28H49V25H52Z" />
          <path fill="#ffd278" d="M53 23H54V25H56V27H54V29H53V27H51V25H53Z" />
          <path fill={shine} d="M53 25H54V26H53Z" />
        </g> : null}
      </>}
      {sleeping ? <g>{star(51, 6)}<path fill="#e9c88d" d="M45 5H47V8H48V9H51V11H47V10H45V8H44V6H45Z" /></g> : null}
      {action === 'celebrate' && gesture > 0 ? <g>{star(7, 7)}{star(53, 7)}</g> : null}
    </svg>
  </div>;
}
