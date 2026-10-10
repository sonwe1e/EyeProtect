import { useEffect, useState } from 'react';
import { Check, Play } from 'lucide-react';
import { PET_OUTFITS, PET_OUTFIT_DETAILS, type PetOutfit } from '../../../../shared/pixelAnimals';
import { PixelAnimal } from '../characters/PixelAnimal';

export function PetOutfitPicker({ outfit, motion, disabled, onSelect }: {
  outfit: PetOutfit;
  motion: boolean;
  disabled: boolean;
  onSelect: (outfit: PetOutfit) => void;
}): JSX.Element {
  const [preview, setPreview] = useState<number | null>(null);
  useEffect(() => { setPreview(null); }, [outfit]);
  useEffect(() => {
    if (preview === null) return;
    const timer = window.setTimeout(() => setPreview(null), 1_600);
    return () => clearTimeout(timer);
  }, [preview]);

  return <div className="simple-pet-outfits">
    <div className="simple-pet-grid" role="group" aria-label="奋斗猫装扮">
      {PET_OUTFITS.map((id) => {
        const detail = PET_OUTFIT_DETAILS[id];
        const selected = id === outfit;
        return <button
          type="button"
          key={id}
          className="simple-pet-card"
          data-outfit-option={id}
          aria-pressed={selected}
          disabled={disabled}
          onClick={() => { if (!selected) onSelect(id); }}
        >
          {selected ? <span className="simple-pet-badge" aria-hidden="true"><Check size={11} strokeWidth={3} /></span> : null}
          <span className="simple-pet-preview">
            <PixelAnimal animal="cat" outfit={id} action={selected && preview !== null ? 'react' : 'idle'}
              animationKey={preview ?? undefined} motion={motion} label={`奋斗猫 · ${detail.name}`} />
          </span>
          <span className="simple-pet-name">{detail.name}</span>
          <span className="simple-pet-description">{detail.description}</span>
        </button>;
      })}
    </div>
    <div className="simple-pet-try">
      <button type="button" className="simple-pet-try-button" disabled={!motion}
        onClick={() => setPreview(Date.now())}>
        <Play size={14} aria-hidden="true" />
        试试动作：{PET_OUTFIT_DETAILS[outfit].interaction}
      </button>
      <span>单击桌宠也会回应你</span>
    </div>
  </div>;
}
