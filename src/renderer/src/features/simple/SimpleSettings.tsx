import { SIMPLE_SETTING_LIMITS, SETTINGS_LIMITS } from '../../../../shared/types';
import { useEffect, useState } from 'react';
import type { Settings, LegacyData, CustomPetAssets } from '../../../../shared/types';
import { PIXEL_ANIMALS, PIXEL_ANIMAL_NAMES } from '../../../../shared/pixelAnimals';
import { useSettings } from '../../hooks/useSettings';
import { useProjects } from '../../hooks/useProjects';
import { useTasks } from '../../hooks/useTasks';
import { useCommand } from '../../hooks/useCommand';
import { PixelAnimal } from '../characters/PixelAnimal';
import { soundPlayer } from '../../lib/audio';
import { run } from '../../lib/commands';
import { FolderOpen, Sparkles } from 'lucide-react';

const toTimeStr = (minOfDay: number): string => {
  const h = String(Math.floor(minOfDay / 60)).padStart(2, '0');
  const m = String(minOfDay % 60).padStart(2, '0');
  return `${h}:${m}`;
};

const fromTimeStr = (timeStr: string, fallback: number): number => {
  const parts = timeStr.split(':');
  if (parts.length !== 2) return fallback;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return fallback;
  return Math.min(1439, Math.max(0, h * 60 + m));
};

export function SimpleSettings(): JSX.Element {
  const { settings } = useSettings();
  const projects = useProjects();
  const tasks = useTasks();
  const [legacy, setLegacy] = useState<LegacyData | null>(null);
  const [customAssets, setCustomAssets] = useState<CustomPetAssets | null>(null);
  const action = useCommand((callback: () => Promise<unknown>) => run(callback));
  const save = (patch: Partial<Settings>): void => { void action.run(() => window.eyeProtect.saveSettings(patch)); };

  useEffect(() => {
    const loadThemes = () => {
      void window.eyeProtect.getCustomPetAssets().then(setCustomAssets);
    };
    loadThemes();
    window.addEventListener('focus', loadThemes);
    return () => window.removeEventListener('focus', loadThemes);
  }, []);

  const number = (key: 'eyeIntervalMinutes' | 'walkIntervalMinutes' | 'eyeRestSeconds' | 'walkRestSeconds' | 'petScale', label: string, min: number, max: number, step = 1): JSX.Element =>
    <label>{label}<input type="number" key={`${key}-${settings[key]}`} min={min} max={max} step={step} defaultValue={settings[key]} onBlur={(event) => { const value = Number(event.currentTarget.value); if (Number.isFinite(value) && value !== settings[key]) save({ [key]: value }); }} /></label>;
  return <div className="simple-settings"><h1>设置</h1>
    <section><h2>休息提醒</h2><p>到时提醒休息，开始休息后暂停正在进行的专注。稍后只影响这一次，默认时长在这里改。</p>
      <div className="simple-field-grid"><label className="simple-check"><input type="checkbox" checked={settings.eyeEnabled} onChange={(e) => save({ eyeEnabled: e.currentTarget.checked })} />护眼提醒</label>{number('eyeIntervalMinutes', '间隔（分钟）', 1, 240)}{number('eyeRestSeconds', '休息（秒）', SIMPLE_SETTING_LIMITS.eyeRestSeconds.min, SIMPLE_SETTING_LIMITS.eyeRestSeconds.max)}</div>
      <div className="simple-field-grid"><label className="simple-check"><input type="checkbox" checked={settings.walkEnabled} onChange={(e) => save({ walkEnabled: e.currentTarget.checked })} />走动提醒</label>{number('walkIntervalMinutes', '间隔（分钟）', 1, 240)}{number('walkRestSeconds', '休息（秒）', SIMPLE_SETTING_LIMITS.walkRestSeconds.min, SIMPLE_SETTING_LIMITS.walkRestSeconds.max)}</div>
      <div className="simple-field-grid">
        <label>提醒方式
          <select value={settings.reminderMode} onChange={(e) => save({ reminderMode: e.currentTarget.value as Settings['reminderMode'] })}>
            <option value="focused">沉浸遮罩（全屏变暗 + 专注休息）</option>
            <option value="guided">浮窗卡片（适度提醒，屏幕中央卡片）</option>
            <option value="gentle">轻柔气泡（仅在桌宠旁显示轻气泡）</option>
          </select>
        </label>
        <label>默认稍后（分钟）<select value={settings.snoozeMinutes} onChange={(e) => save({ snoozeMinutes: Number(e.currentTarget.value) })}>{[1, 5, 10, 15].map((minutes) => <option key={minutes} value={minutes}>{minutes} 分钟</option>)}</select></label>
      </div>
      <div className="simple-field-grid">
        <label className="simple-check">
          <input type="checkbox" checked={settings.soundEnabled} onChange={(e) => save({ soundEnabled: e.currentTarget.checked })} />
          休息提示音（开始与结束轻柔铃声，便于闭目养神）
        </label>
        <button type="button" onClick={() => soundPlayer.playRestComplete(settings.soundVolume)}>试听结束铃声</button>
      </div>
      {/* 免打扰回答的是“什么时候不要提醒”，和提醒方式同属一组；设置页按精简契约保持三组。 */}
      <div className="simple-field-grid">
        <label className="simple-check">
          <input type="checkbox" checked={settings.fullscreenDndEnabled} onChange={(e) => save({ fullscreenDndEnabled: e.currentTarget.checked })} />
          全屏应用自动免打扰（游戏、全屏播放或幻灯片演示时自动推迟提醒）
        </label>
        <label className="simple-check">
          <input type="checkbox" checked={settings.quietHoursEnabled} onChange={(e) => save({ quietHoursEnabled: e.currentTarget.checked })} />
          定时免打扰时段
        </label>
      </div>
      {settings.quietHoursEnabled ? <div className="simple-field-grid">
        <label>开始时间<input type="time" defaultValue={toTimeStr(settings.quietHoursStartMinutes)} onBlur={(e) => save({ quietHoursStartMinutes: fromTimeStr(e.currentTarget.value, settings.quietHoursStartMinutes) })} /></label>
        <label>结束时间<input type="time" defaultValue={toTimeStr(settings.quietHoursEndMinutes)} onBlur={(e) => save({ quietHoursEndMinutes: fromTimeStr(e.currentTarget.value, settings.quietHoursEndMinutes) })} /></label>
      </div> : null}
      <div className="simple-button-row">
        <button disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.testReminder('eye'))}>试一下护眼提醒</button>
      </div>
    </section>
    <section>
      <h2>桌面外观</h2>
      <div className="simple-animals">
        {PIXEL_ANIMALS.map((animal) => {
          const isSelected = settings.customPetTheme === null && settings.petAppearance === animal;
          return (
            <button
              key={animal}
              type="button"
              aria-pressed={isSelected}
              onClick={() => save({ petAppearance: animal, customPetTheme: null })}
            >
              <PixelAnimal animal={animal} action="idle" label={PIXEL_ANIMAL_NAMES[animal]} />
              <span>{PIXEL_ANIMAL_NAMES[animal]}</span>
            </button>
          );
        })}
        {customAssets?.availableThemes.map((theme) => {
          const isSelected = settings.customPetTheme === theme.id;
          return (
            <button
              key={theme.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => save({ customPetTheme: theme.id })}
              title={`自定义角色：${theme.name}`}
            >
              <div className="simple-custom-preview">
                {theme.preview ? (
                  <img src={theme.preview} alt={theme.name} />
                ) : (
                  <Sparkles size={36} />
                )}
              </div>
              <span>{theme.name}</span>
            </button>
          );
        })}
      </div>
      <div className="simple-field-grid">
        {number('petScale', '桌宠大小', .5, 1.8, .1)}
        <label>
          主题
          <select value={settings.theme} onChange={(e) => save({ theme: e.currentTarget.value as Settings['theme'] })}>
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>
      </div>
      <label className="simple-check">
        <input
          type="checkbox"
          checked={settings.petMotion}
          onChange={(e) => save({ petMotion: e.currentTarget.checked })}
        />
        桌宠小动作（眨眼/伸懒腰；系统开启“减少动态效果”时始终静止）
      </label>
      <div className="simple-button-row" style={{ marginTop: '14px' }}>
        <button
          type="button"
          disabled={action.isPending}
          onClick={() => void action.run(() => window.eyeProtect.openCustomPetFolder(settings.customPetTheme ?? undefined))}
        >
          <FolderOpen size={15} style={{ marginRight: '6px', verticalAlign: '-2px' }} />
          打开自定义动图文件夹
        </button>
      </div>
      <div className="simple-custom-guide">
        <p><strong>自定义桌宠动图指南：</strong></p>
        <p>1. <strong>多动作随机互动：</strong>在文件夹中放入 <code>click1.gif</code>、<code>click2.gif</code> 等，点击桌宠时将随机触发不同动作；待机与小动作同样支持 <code>fidget1.gif</code>、<code>idle1.gif</code>。</p>
        <p>2. <strong>多种动物/角色皮肤：</strong>在 <code>custom-pet</code> 文件夹内新建子文件夹（如 <code>cat</code>、<code>dog</code> 等），每个子文件夹即为一个独立角色，会自动识别并列在上方供你一键切换；直接放在根目录的文件则为“默认角色”。</p>
      </div>
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
