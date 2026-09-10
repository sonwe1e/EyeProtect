import { SIMPLE_SETTING_LIMITS, SETTINGS_LIMITS } from '../../../../shared/types';
import { useState } from 'react';
import type { Settings, LegacyData } from '../../../../shared/types';
import { PIXEL_ANIMALS, PIXEL_ANIMAL_NAMES } from '../../../../shared/pixelAnimals';
import { useSettings } from '../../hooks/useSettings';
import { useProjects } from '../../hooks/useProjects';
import { useTasks } from '../../hooks/useTasks';
import { useCommand } from '../../hooks/useCommand';
import { PixelAnimal } from '../characters/PixelAnimal';
import { run } from '../../lib/commands';

export function SimpleSettings(): JSX.Element {
  const { settings } = useSettings();
  const projects = useProjects();
  const tasks = useTasks();
  const [legacy, setLegacy] = useState<LegacyData | null>(null);
  const action = useCommand((callback: () => Promise<unknown>) => run(callback));
  const save = (patch: Partial<Settings>): void => { void action.run(() => window.eyeProtect.saveSettings(patch)); };
  const number = (key: 'eyeIntervalMinutes' | 'walkIntervalMinutes' | 'eyeRestSeconds' | 'walkRestSeconds' | 'petScale', label: string, min: number, max: number, step = 1): JSX.Element =>
    <label>{label}<input type="number" key={`${key}-${settings[key]}`} min={min} max={max} step={step} defaultValue={settings[key]} onBlur={(event) => { const value = Number(event.currentTarget.value); if (Number.isFinite(value) && value !== settings[key]) save({ [key]: value }); }} /></label>;
  return <div className="simple-settings"><h1>设置</h1>
    <section><h2>休息提醒</h2><p>到时显示遮罩提醒，开始休息后暂停正在进行的专注。</p>
      <div className="simple-field-grid"><label className="simple-check"><input type="checkbox" checked={settings.eyeEnabled} onChange={(e) => save({ eyeEnabled: e.currentTarget.checked })} />护眼提醒</label>{number('eyeIntervalMinutes', '间隔（分钟）', 1, 240)}{number('eyeRestSeconds', '休息（秒）', SIMPLE_SETTING_LIMITS.eyeRestSeconds.min, SIMPLE_SETTING_LIMITS.eyeRestSeconds.max)}</div>
      <div className="simple-field-grid"><label className="simple-check"><input type="checkbox" checked={settings.walkEnabled} onChange={(e) => save({ walkEnabled: e.currentTarget.checked })} />走动提醒</label>{number('walkIntervalMinutes', '间隔（分钟）', 1, 240)}{number('walkRestSeconds', '休息（秒）', SIMPLE_SETTING_LIMITS.walkRestSeconds.min, SIMPLE_SETTING_LIMITS.walkRestSeconds.max)}</div>
      <button disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.testReminder('eye'))}>试一下护眼提醒</button>
    </section>
    <section><h2>桌面外观</h2>      <div className="simple-animals">{PIXEL_ANIMALS.map((animal) => <button key={animal} aria-pressed={settings.petAppearance === animal} onClick={() => save({ petAppearance: animal })}><PixelAnimal animal={animal} action="idle" label={PIXEL_ANIMAL_NAMES[animal]} /><span>{PIXEL_ANIMAL_NAMES[animal]}</span></button>)}</div>
      <div className="simple-field-grid">{number('petScale', '桌宠大小', .5, 1.8, .1)}<label>主题<select value={settings.theme} onChange={(e) => save({ theme: e.currentTarget.value as Settings['theme'] })}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label></div>
    </section>
    <section><h2>应用</h2><label className="simple-check"><input type="checkbox" checked={settings.startWithWindows} onChange={(e) => save({ startWithWindows: e.currentTarget.checked })} />开机启动</label>
      <div className="simple-button-row"><button disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.exportBackup())}>导出备份</button><button disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.importBackup())}>恢复备份</button></div>
      <details><summary>旧资料与恢复</summary><p>旧规划、自动规则与专注资料仍保留在备份中，自动规则已停用。</p>
        {projects.filter((p) => p.status === 'completed' || p.status === 'archived').map((p) => <div className="simple-history-row" key={p.id}><span>{p.name}</span><button disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.updateProject(p.id, { status: 'active' }))}>恢复为清单</button></div>)}
        {tasks.filter((t) => !t.parentId && t.status === 'archived').map((t) => <div className="simple-history-row" key={t.id}><span>{t.title}</span><button disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.restoreLegacyTask(t.id))}>恢复任务</button></div>)}
        <button disabled={action.isPending} onClick={() => void action.run(async () => { setLegacy(await window.eyeProtect.getLegacyData()); })}>查看保留的旧资料</button>
        {legacy ? <div className="simple-legacy-data">{legacy.sections.map((section) => <section key={section.title}><h3>{section.title}</h3>{section.items.map((item, index) => <p key={index}><strong>{item.title}</strong><br />{item.detail}</p>)}{!section.items.length ? <p>无保留资料</p> : null}</section>)}</div> : null}
      </details>
    </section>
    {action.error ? <p role="alert">{action.error.message}</p> : null}
  </div>;
}
