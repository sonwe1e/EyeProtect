import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { isPetTaskEligible } from '../../../../../shared/petTasks';
import type { Settings } from '../../../../../shared/types';
import { useTasks } from '../../../hooks/useTasks';
import { useProjects } from '../../../hooks/useProjects';
import { useSettings } from '../../../hooks/useSettings';
import { useCommand } from '../../../hooks/useCommand';
import { commands } from '../../../lib/commands';

export function PetTasksView(): JSX.Element {
  const tasks = useTasks();
  const projects = useProjects();
  const { settings, setSettings } = useSettings();
  const [search, setSearch] = useState('');
  const save = useCommand(async (patch: Partial<Settings>) => {
    const result = await commands.settings.save(patch);
    if (result.ok) setSettings((previous) => ({ ...previous, ...patch }));
    return result;
  });
  const ids = settings.todoBubbleTaskIds;
  const selected = ids.flatMap((id) => {
    const task = tasks.find((entry) => entry.id === id);
    return task ? [task] : [];
  });
  const candidates = tasks.filter((task) => !ids.includes(task.id) && isPetTaskEligible(task, projects) &&
    task.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const move = (id: string, direction: number): void => {
    const next = selected.map((task) => task.id);
    const index = next.indexOf(id);
    const other = index + direction;
    if (other < 0 || other >= next.length) return;
    [next[index], next[other]] = [next[other], next[index]];
    void save.run({ todoBubbleTaskIds: next });
  };
  return (
    <section className="pet-tasks-page">
      <header><h1>浮窗任务</h1><p>只展示你选择的任务。最多显示三行，更多任务可以滚动查看。</p></header>
      <label className="pet-tasks-toggle"><input type="checkbox" checked={settings.todoBubbleEnabled} disabled={save.isPending}
        onChange={(event) => void save.run({ todoBubbleEnabled: event.currentTarget.checked })} />显示待办气泡</label>
      {save.error ? <p role="alert">{save.error.message}</p> : null}
      <h2>已选择 · {selected.length}</h2>
      {selected.length === 0 ? <p>从下方选择任务，它们会出现在桌宠旁。</p> : null}
      <ul className="pet-task-choices">{selected.map((task) => (
        <li key={task.id}>
          <label><input type="checkbox" checked disabled={save.isPending} onChange={() => void save.run({ todoBubbleTaskIds: ids.filter((id) => id !== task.id) })} />
            <span>{task.title}{!isPetTaskEligible(task, projects) ? <small>暂不展示 · 完成或项目只读</small> : null}</span></label>
          <button type="button" aria-label={`上移 ${task.title}`} disabled={save.isPending || selected[0]?.id === task.id} onClick={() => move(task.id, -1)}><ArrowUp size={16} /></button>
          <button type="button" aria-label={`下移 ${task.title}`} disabled={save.isPending || selected[selected.length - 1]?.id === task.id} onClick={() => move(task.id, 1)}><ArrowDown size={16} /></button>
        </li>
      ))}</ul>
      <h2>添加任务</h2>
      <input type="search" aria-label="搜索浮窗候选任务" placeholder="搜索任务名称" value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
      <ul className="pet-task-choices">{candidates.map((task) => (
        <li key={task.id}><label><input type="checkbox" checked={false} disabled={save.isPending}
          onChange={() => void save.run({ todoBubbleTaskIds: [...ids, task.id] })} /><span>{task.title}</span></label></li>
      ))}</ul>
      {candidates.length === 0 ? <p>没有符合条件的任务。</p> : null}
    </section>
  );
}
