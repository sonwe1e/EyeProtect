import type { ActiveReminder, ReminderKind } from '../../../../shared/types';
import { ProceduralCharacter } from '../characters/ProceduralCharacter';
import { activeCharacterFrom, useCharacterCollection } from '../../hooks/useCharacterCollection';

export const reminderCopy: Record<ReminderKind, { title: string; detail: string }> = {
  eye: { title: '眼睛休息时间', detail: '跟它一起看向远处，慢慢眨几次眼。' },
  walk: { title: '该起来走走', detail: '跟着脚步起身，活动肩颈，顺便喝口水。' },
  combined: { title: '休息眼睛，也走一走', detail: '先把视线移远，再跟着它离开座位活动一下。' }
};

export function ReminderArtwork({ active, canComplete, onDoubleClick }: { active: ActiveReminder; canComplete: boolean; onDoubleClick: () => void }): JSX.Element {
  const character = activeCharacterFrom(useCharacterCollection());
  return (
    <div className={`reminder-artwork reminder-stage kind-${active.kind}`} title={canComplete ? '双击完成提醒' : '倒计时结束后可双击完成'} onDoubleClick={onDoubleClick}>
      <div className="reminder-atmosphere" aria-hidden="true"><i /><i /><i /><i /></div>
      <ProceduralCharacter character={character} mood="happy" action={active.kind} label={`${character.name}正在演示${active.kind === 'eye' ? '护眼' : active.kind === 'walk' ? '走动' : '综合休息'}动作`} />
      <div className="reminder-stage-caption" aria-hidden="true">
        {active.kind === 'eye' ? '远望 · 眨眼 · 放松' : active.kind === 'walk' ? '起身 · 迈步 · 伸展' : '远望之后，走一小圈'}
      </div>
    </div>
  );
}
