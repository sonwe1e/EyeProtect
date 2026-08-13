import { memo, useMemo, useState } from 'react';
import { Dice5, Gift, Heart, Pin, Sparkles, Trash2 } from 'lucide-react';
import { CHARACTER_MATERIALS } from '../../../../shared/characters';
import type { CharacterMaterial, CollectibleCharacter, PetAccessory } from '../../../../shared/types';
import { commands } from '../../lib/commands';
import { useCommand } from '../../hooks/useCommand';
import { CommandButton } from '../../components/CommandButton';
import { useCharacterCollection } from '../../hooks/useCharacterCollection';
import { ProceduralCharacter } from './ProceduralCharacter';

const MATERIAL_LABELS: Record<CharacterMaterial, string> = {
  paper: '纸感',
  glow: '微光',
  plush: '绒绒',
  candy: '糖果',
  cosmic: '星云'
};
const ACCESSORIES: Array<{ value: PetAccessory; label: string }> = [
  { value: 'none', label: '无配饰' },
  { value: 'cup', label: '水杯' },
  { value: 'glasses', label: '眼镜' },
  { value: 'leaf', label: '叶子' }
];

export function CharacterCollectionView(): JSX.Element {
  const state = useCharacterCollection();
  const candidate = state.candidate?.decision === 'pending' ? state.candidate.character : null;
  const characters = useMemo(
    () =>
      [...state.characters].sort(
        (left, right) =>
          Number(right.favorite) - Number(left.favorite) || right.createdAt - left.createdAt
      ),
    [state.characters]
  );
  const collect = useCommand(() => commands.characters.collect());
  const discard = useCommand(() => commands.characters.discard());
  const setDailyRandom = useCommand(() => commands.characters.setAppearance('daily-random'));

  return (
    <div className="collection-page">
      <header className="collection-header">
        <div><span className="eyebrow">每日随机生成</span><h1>公仔收藏</h1><p>角色形状、材质和动作相互独立。每天的新朋友只在本机生成与保存。</p></div>
        <CommandButton className={state.appearanceMode === 'daily-random' ? 'primary' : ''} type="button" state={setDailyRandom.state} errorReason={setDailyRandom.error?.message} onClick={() => void setDailyRandom.run()}>
          <Dice5 size={16} /> 每日随机出场
        </CommandButton>
      </header>
      {candidate ? (
        <section className="candidate-card">
          <div className="candidate-stage"><ProceduralCharacter character={candidate} mood="happy" action="react" /></div>
          <div className="candidate-copy"><span className="eyebrow"><Gift size={14} /> 今日来访</span><h2>{candidate.name}</h2><p>{personalityCopy(candidate)}</p><small>{candidate.style} · 喜欢 {candidate.favoriteActions.join('、')}</small>
            <div className="candidate-actions">
              <CommandButton className="primary" state={collect.state} errorReason={collect.error?.message} successContent="已加入收藏" onClick={() => void collect.run()}><Sparkles size={15} /> 收下它</CommandButton>
              <CommandButton state={discard.state} errorReason={discard.error?.message} onClick={() => void discard.run()}>这次不收</CommandButton>
            </div>
          </div>
        </section>
      ) : <div className="candidate-empty"><Gift size={18} /><span>今天的来访已经处理，明天会出现新的随机公仔。</span></div>}
      <section className="collection-section">
        <div className="collection-section-heading"><h2>我的角色</h2><span>{characters.length} 位</span></div>
        {characters.length ? <div className="character-grid">{characters.map((character) => <CharacterCard key={character.id} character={character} active={state.activeCharacterId === character.id} pinned={state.appearanceMode === 'pinned' && state.pinnedCharacterId === character.id} />)}</div> : (
          <div className="collection-empty"><Sparkles size={28} /><h3>收藏还是空的</h3><p>桌面上会先住着默认小家伙，收下每日来访后就能切换。</p></div>
        )}
      </section>
    </div>
  );
}

const CharacterCard = memo(function CharacterCard({ character, active, pinned }: { character: CollectibleCharacter; active: boolean; pinned: boolean }): JSX.Element {
  const [name, setName] = useState(character.name);
  const rename = useCommand((name: string) => commands.characters.rename(character.id, name));
  const setMaterial = useCommand((material: CharacterMaterial) => commands.characters.setMaterial(character.id, material));
  const setAccessory = useCommand((accessory: PetAccessory) => commands.characters.setAccessory(character.id, accessory));
  const pin = useCommand((id: string) => commands.characters.setAppearance('pinned', id));
  const favorite = useCommand((favorite: boolean) => commands.characters.setFavorite(character.id, favorite));
  const remove = useCommand(() => commands.characters.remove(character.id));
  const commitName = (): void => {
    if (name.trim() && name.trim() !== character.name) void rename.run(name);
  };
  return (
    <article className={`character-card ${active ? 'is-active' : ''}`.trim()}>
      <div className="character-card-stage"><ProceduralCharacter character={character} mood={active ? 'happy' : 'calm'} /></div>
      <div className="character-card-body">
        <input aria-label="角色名字" aria-invalid={rename.error ? true : undefined} value={name} onChange={(event) => setName(event.currentTarget.value)} onBlur={commitName} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
        <p>{personalityCopy(character)}</p>
        <div className="character-card-fields">
          <label>材质<select value={character.material} onChange={(event) => void setMaterial.run(event.currentTarget.value as CharacterMaterial)}>{CHARACTER_MATERIALS.map((material) => <option key={material} value={material}>{MATERIAL_LABELS[material]}</option>)}</select></label>
          <label>配饰<select value={character.accessory} onChange={(event) => void setAccessory.run(event.currentTarget.value as PetAccessory)}>{ACCESSORIES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label>
        </div>
        <div className="character-card-actions">
          <CommandButton type="button" className={pinned ? 'primary' : ''} state={pin.state} errorReason={pin.error?.message} onClick={() => void pin.run(character.id)}><Pin size={14} />{pinned ? '正在出场' : '固定出场'}</CommandButton>
          <CommandButton type="button" className={character.favorite ? 'is-favorite' : ''} title="收藏置顶" aria-label={character.favorite ? '取消收藏置顶' : '收藏置顶'} state={favorite.state} errorReason={favorite.error?.message} onClick={() => void favorite.run(!character.favorite)}><Heart size={14} fill={character.favorite ? 'currentColor' : 'none'} /></CommandButton>
          <CommandButton type="button" className="danger-icon" title="删除角色" aria-label={`删除角色「${character.name}」`} state={remove.state} errorReason={remove.error?.message} onClick={() => { if (window.confirm(`删除「${character.name}」？`)) void remove.run(); }}><Trash2 size={14} /></CommandButton>
        </div>
      </div>
    </article>
  );
});

const personalityCopy = (character: CollectibleCharacter): string => ({
  curious: '总想看看屏幕外面发生了什么。',
  mischievous: '喜欢突然动一下，确认你还醒着。',
  dreamy: '慢悠悠地漂着，也提醒你放松。',
  brave: '休息时会认真带你走完全程。',
  gentle: '安静陪伴，偶尔给你一个小提示。'
}[character.personality]);
