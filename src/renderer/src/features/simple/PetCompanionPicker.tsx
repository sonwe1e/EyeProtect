import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { PET_COMPANIONS, PET_COMPANION_DETAILS, type PetCompanion } from '../../../../shared/petCompanions';
import { CompanionArtwork } from '../characters/CompanionArtwork';

export function PetCompanionPicker({ companion, motion, disabled, onSelect }: {
  companion: PetCompanion; motion: boolean; disabled: boolean; onSelect: (companion: PetCompanion) => void;
}): JSX.Element {
  const [preview, setPreview] = useState<number | null>(null);
  const [customAvailable, setCustomAvailable] = useState(false);
  useEffect(() => {
    let disposed = false;
    const load = (): void => { void window.eyeProtect.getCustomPetAssets().then((assets) => { if (!disposed) setCustomAvailable(assets.hasCustomPet); }); };
    load();
    window.addEventListener('focus', load);
    return () => { disposed = true; window.removeEventListener('focus', load); };
  }, [companion]);
  useEffect(() => {
    setPreview(null);
  }, [companion]);
  useEffect(() => {
    if (preview === null) return;
    const timer = setTimeout(() => setPreview(null), 1600);
    return () => clearTimeout(timer);
  }, [preview]);
  return <div className="simple-companion-picker">
    <div className="simple-companion-grid" role="group" aria-label="选择桌面伙伴">
      {PET_COMPANIONS.filter((id) => id !== 'custom' || customAvailable).map((id) => <button key={id} type="button" data-companion-option={id}
        className={`simple-companion-option${companion === id ? ' is-selected' : ''}`}
        aria-pressed={companion === id} disabled={disabled} onClick={() => onSelect(id)}>
        <span className="simple-companion-art"><CompanionArtwork companion={id} action={companion === id && preview !== null ? 'react' : 'idle'} animationKey={preview ?? undefined} motion={motion && companion === id} /></span>
        <strong>{PET_COMPANION_DETAILS[id].name}</strong>
        <span>{PET_COMPANION_DETAILS[id].description}</span>
      </button>)}
    </div>
    <div className="simple-pet-preview-row">
      <button type="button" className="simple-companion-try" disabled={disabled || !motion} onClick={() => setPreview(Date.now())}>
        <Play size={16} aria-hidden="true" />试试动作：{PET_COMPANION_DETAILS[companion].interaction}
      </button>
      <span>单击桌宠也会回应，双击打开待办</span>
    </div>
  </div>;
}
