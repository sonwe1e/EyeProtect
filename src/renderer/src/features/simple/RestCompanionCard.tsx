import { useEffect, useState } from 'react';
import { localDateKey } from '../../../../shared/calendar';
import type { RestCompanionSummary } from '../../../../shared/types';
import { CompanionArtwork } from '../characters/CompanionArtwork';
import { useClock } from '../../hooks/useClock';
import { useSettings } from '../../hooks/useSettings';

export function RestCompanionCard(): JSX.Element {
  const { settings } = useSettings();
  const day = localDateKey(useClock(30_000));
  const [summary, setSummary] = useState<RestCompanionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    const update = (next: RestCompanionSummary): void => {
      if (disposed) return;
      setSummary((previous) => !previous || next.generatedAt >= previous.generatedAt ? next : previous);
      setError(null);
    };
    const load = (): void => {
      void window.eyeProtect.getRestCompanion().then(update).catch(() => {
        if (!disposed) setError('暂时无法读取休息记录，重新打开此页可重试。');
      });
    };
    const unsubscribe = window.eyeProtect.onRestCompanionChanged(update);
    window.addEventListener('focus', load);
    load();
    return () => { disposed = true; unsubscribe(); window.removeEventListener('focus', load); };
  }, [day]);

  const max = Math.max(1, ...(summary?.days.map((entry) => entry.completed) ?? []));
  return <section className="simple-rest-companion" aria-labelledby="weekly-rest-title">
    <div className="simple-rest-companion-copy">
      <div className="simple-rest-companion-pet"><CompanionArtwork companion={settings.petCompanion} outfit={settings.petOutfit} action="sleep" motion={false} /></div>
      <div><h2 id="weekly-rest-title">本周休息{summary?.enabled ? <small>{summary.completed} 次</small> : null}</h2>
        <p>{error ?? summary?.message ?? '正在读取本周的小小休息…'}</p>
      </div>
    </div>
    {summary?.enabled ? <div className="simple-rest-week" role="img" aria-label={`本周完成休息：${summary.days.map((entry, index) => `周${'一二三四五六日'[index]} ${entry.completed} 次`).join('，')}`}>
      {summary.days.map((entry, index) => <div className="simple-rest-day" key={entry.date} title={`${entry.date} · ${entry.completed} 次休息`}>
        <span className="simple-rest-day-count">{entry.completed > 0 ? entry.completed : ''}</span>
        <div className="simple-rest-day-track"><span style={{ height: `${entry.completed / max * 100}%` }} /></div>
        <span>{'一二三四五六日'[index]}</span>
      </div>)}
    </div> : null}
  </section>;
}
