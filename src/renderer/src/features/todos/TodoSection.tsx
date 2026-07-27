import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import {
  TODO_TEXT_MAX,
  nextTodoPriority,
  sortTodosForDisplay,
  type TodoItem,
  type TodoPriority
} from '../../../../shared/types';

const TODO_CONFIRM_RESET_MS = 2500;
const TODO_HINT_RESET_MS = 1800;
const TODO_CHAR_COUNTER_FROM = 48;

const PRIORITY_LABELS: Record<TodoPriority, string> = {
  normal: '普通',
  important: '重要',
  urgent: '紧急'
};

export function TodoSection({
  todos,
  onAdd,
  onToggle,
  onUpdate,
  onRemove,
  onPriorityChange,
  onDirtyChange
}: {
  todos: TodoItem[];
  onAdd: (text: string) => void;
  onToggle: (id: string) => void;
  onUpdate: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  onPriorityChange: (id: string, priority: TodoPriority) => void;
  onDirtyChange: (dirty: boolean) => void;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldScrollRef = useRef(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sorted = useMemo(() => sortTodosForDisplay(todos), [todos]);
  const completedCount = useMemo(() => todos.filter((todo) => todo.completed).length, [todos]);
  const dirty = draft.trim().length > 0 || editingId !== null;

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current);
      }
      if (hintTimerRef.current) {
        clearTimeout(hintTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (shouldScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      shouldScrollRef.current = false;
    }
  }, [sorted.length]);

  const showHint = useCallback((message: string) => {
    setHint(message);
    if (hintTimerRef.current) {
      clearTimeout(hintTimerRef.current);
    }
    hintTimerRef.current = setTimeout(() => setHint(null), TODO_HINT_RESET_MS);
  }, []);

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const text = draft.trim();
      if (!text) {
        return;
      }
      if (todos.some((todo) => !todo.completed && todo.text === text)) {
        showHint('已有相同待办');
        return;
      }
      shouldScrollRef.current = true;
      onAdd(text);
      setDraft('');
    },
    [draft, todos, onAdd, showHint]
  );

  const handleRemoveClick = useCallback(
    (id: string) => {
      if (confirmingId === id) {
        if (confirmTimerRef.current) {
          clearTimeout(confirmTimerRef.current);
          confirmTimerRef.current = null;
        }
        setConfirmingId(null);
        onRemove(id);
        return;
      }
      setConfirmingId(id);
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current);
      }
      confirmTimerRef.current = setTimeout(() => setConfirmingId(null), TODO_CONFIRM_RESET_MS);
    },
    [confirmingId, onRemove]
  );

  const startEdit = useCallback((todo: TodoItem) => {
    setEditingId(todo.id);
    setEditText(todo.text);
  }, []);

  const commitEdit = useCallback(() => {
    if (editingId === null) {
      return;
    }
    const text = editText.trim();
    if (text) {
      onUpdate(editingId, text);
    }
    setEditingId(null);
    setEditText('');
  }, [editingId, editText, onUpdate]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditText('');
  }, []);

  const handleDraftKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.stopPropagation();
      if (draft) {
        setDraft('');
      } else {
        void window.eyeProtect.closePanel();
      }
    },
    [draft]
  );

  return (
    <div className="panel-section">
      <div className="panel-scroll" ref={scrollRef}>
        {sorted.length === 0 ? (
          <p className="todo-empty">还没有待办，添加一件吧。</p>
        ) : (
          <ul className="todo-list">
            {sorted.map((todo) => (
              <li key={todo.id} className={`todo-item ${todo.completed ? 'is-done' : ''}`.trim()}>
                <button
                  type="button"
                  className="todo-priority-dot"
                  data-priority={todo.priority}
                  title={`优先级：${PRIORITY_LABELS[todo.priority]}（点击切换）`}
                  aria-label={`优先级：${PRIORITY_LABELS[todo.priority]}`}
                  onClick={() => onPriorityChange(todo.id, nextTodoPriority(todo.priority))}
                />
                <button
                  type="button"
                  className="todo-toggle"
                  title={todo.completed ? '标记为未完成' : '标记为完成'}
                  aria-pressed={todo.completed}
                  onClick={() => onToggle(todo.id)}
                >
                  {todo.completed ? <Check size={11} /> : null}
                </button>
                {editingId === todo.id ? (
                  <input
                    className="todo-edit-input"
                    type="text"
                    autoFocus
                    value={editText}
                    maxLength={TODO_TEXT_MAX}
                    onChange={(event) => setEditText(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitEdit();
                      } else if (event.key === 'Escape') {
                        event.stopPropagation();
                        cancelEdit();
                      }
                    }}
                    onBlur={commitEdit}
                  />
                ) : (
                  <span
                    className="todo-text"
                    title={`${todo.text}（双击编辑）`}
                    onDoubleClick={() => startEdit(todo)}
                  >
                    {todo.text}
                  </span>
                )}
                {confirmingId === todo.id ? (
                  <button
                    type="button"
                    className="todo-remove-confirm"
                    onClick={() => handleRemoveClick(todo.id)}
                  >
                    确认?
                  </button>
                ) : (
                  <button
                    type="button"
                    className="todo-remove"
                    title="删除"
                    aria-label={`删除「${todo.text}」`}
                    onClick={() => handleRemoveClick(todo.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {completedCount > 0 ? (
        <div className="todo-clear-row">
          <button
            type="button"
            className="todo-clear-done"
            onClick={() => void window.eyeProtect.clearCompletedTodos()}
          >
            清除已完成（{completedCount}）
          </button>
        </div>
      ) : null}
      <form className="todo-compose" onSubmit={submit}>
        {hint ? <span className="todo-hint">{hint}</span> : null}
        <div className="todo-compose-row">
          <input
            type="text"
            placeholder="添加待办..."
            value={draft}
            maxLength={TODO_TEXT_MAX}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={handleDraftKeyDown}
          />
          {draft.length >= TODO_CHAR_COUNTER_FROM ? (
            <span className="char-counter">
              {draft.length}/{TODO_TEXT_MAX}
            </span>
          ) : null}
          <button type="submit" title="添加" aria-label="添加" disabled={!draft.trim()}>
            <Plus size={14} />
          </button>
        </div>
      </form>
    </div>
  );
}
