import { useEffect, useState } from 'react';
import { fighterArtwork, PET_COMPANION_DETAILS, type PetCompanion } from '../../../../shared/petCompanions';
import type { PetOutfit } from '../../../../shared/pixelAnimals';
import type { CustomPetAssets } from '../../../../shared/types';
import { IllustratedPet } from './IllustratedPet';
import { PetImage } from './PetImage';
import { PixelAnimal } from './PixelAnimal';

export function CompanionArtwork({ companion, outfit = 'classic', action = 'idle', motion = true, animationKey }: {
  companion: PetCompanion; outfit?: PetOutfit; action?: string; motion?: boolean; animationKey?: string | number;
}): JSX.Element {
  const [custom, setCustom] = useState<CustomPetAssets | null>(null);
  useEffect(() => {
    let disposed = false;
    if (companion === 'custom') void window.eyeProtect.getCustomPetAssets().then((assets) => { if (!disposed) setCustom(assets); });
    return () => { disposed = true; };
  }, [companion]);
  const label = PET_COMPANION_DETAILS[companion].name;
  if (companion === 'fighter') return <PetImage key={['react', 'celebrate'].includes(action) ? animationKey : action} src={fighterArtwork(action)} label={label} motion={motion} />;
  if (companion === 'otter' || companion === 'penguin') return <IllustratedPet companion={companion} action={action} motion={motion} animationKey={animationKey} label={label} />;
  if (companion === 'custom' && custom?.hasCustomPet) {
    const resting = ['sleep', 'eye', 'combined', 'breathe', 'blink', 'gaze'].includes(action);
    // A GIF set has no cup either: 'sip' borrows the click pool so the moment is
    // still visible instead of falling back to a motionless idle frame.
    const pool = resting ? custom.sleeps : ['react', 'celebrate', 'sip'].includes(action) ? custom.clicks : action === 'fidget' ? custom.fidgets : custom.idles;
    const src = pool[0] ?? custom.idles[0] ?? custom.sleeps[0] ?? custom.clicks[0] ?? custom.fidgets[0];
    if (src) return <PetImage src={src} label={label} motion={motion} />;
  }
  return <PixelAnimal animal="cat" outfit={outfit} action={action} motion={motion} animationKey={animationKey} label={label} />;
}
