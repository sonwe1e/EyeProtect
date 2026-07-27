import { useCallback, useMemo } from 'react';
import { Check, ListChecks } from 'lucide-react';
import { sortTodosForDisplay } from '../../../shared/types';
import { useTodos } from '../hooks/useTodos';

export default function BubbleView(): JSX.Element {
  const todos = useTodos();
  const openTodos = useCallback(() => {
    void window.eyeProtect.openPanel('todos');
  }, []);
  const pending = useMemo(() => todos.filter((todo) => !todo.completed), [todos]);
  const preview = useMemo(() => sortTodosForDisplay(pending).slice(0, 3), [pending]);

  if (todos.length === 0) {
    return <></>;
  }
  if (pending.length === 0) {
    return (
      <div className="bubble-shell" role="button" title="查看全部待办" onClick={openTodos}>
        <div className="bubble-card bubble-all-done">
          <div className="bubble-title">
            <Check size={13} />
            <span>待办都完成啦</span>
          </div>
          <p className="bubble-done-note">休息一下，晚点再添加新的。</p>
        </div>
        <span className="bubble-tail" />
      </div>
    );
  }

  const overflow = pending.length - preview.length;
  return (
    <div className="bubble-shell" role="button" title="查看全部待办" onClick={openTodos}>
      <div className="bubble-card">
        <div className="bubble-title">
          <ListChecks size={13} />
          <span>待办</span>
          <span className="bubble-count" title={`共 ${todos.length} 件，已完成 ${todos.length - pending.length} 件`}>
            {pending.length}
          </span>
        </div>
        <ul className="bubble-list">
          {preview.map((todo) => (
            <li key={todo.id} className="bubble-item">
              <span className="bubble-dot" data-priority={todo.priority} />
              <span className="bubble-text">{todo.text}</span>
            </li>
          ))}
        </ul>
        {overflow > 0 ? <span className="bubble-more">还有 {overflow} 项…</span> : null}
      </div>
      <span className="bubble-tail" />
    </div>
  );
}
