import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clock3, Eye, Footprints, ListChecks, Pause, Play, Plus, RotateCcw, Settings as SettingsIcon, Trash2, X } from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  PET_SKINS,
  SETTINGS_LIMITS,
  TODO_TEXT_MAX,
  sortTodosForDisplay,
  type ActiveReminder,
  type Alarm,
  type AlarmRepeat,
  type PanelTab,
  type PetSkin,
  type ReminderKind,
  type ReminderStatus,
  type RuntimeInfo,
  type Settings,
  type TodoItem
} from '../../shared/types';

const DEFAULT_STATUS: ReminderStatus = {
  nextEyeAt: Date.now() + DEFAULT_SETTINGS.eyeIntervalMinutes * 60_000,
  nextWalkAt: Date.now() + DEFAULT_SETTINGS.walkIntervalMinutes * 60_000,
  pausedUntil: null,
  activeReminder: null
};

const ARTWORK_INTERVAL_MS = 2_200;
const eyeArtwork = Array.from({ length: 6 }, (_, index) => `./assets/reminders/eye-${index + 1}.png`);
const walkArtwork = Array.from({ length: 6 }, (_, index) => `./assets/reminders/walk-${index + 1}.png`);

const petArtwork: Record<PetSkin, string> = {
  stable: './assets/pet/pet-stable.png',
  eye: './assets/pet/pet-eye.png',
  fu: './assets/pet/pet-fu.png',
  sleep: './assets/pet/pet-sleep.png'
};

const petSkinLabel: Record<PetSkin, string> = {
  stable: '默认',
  eye: '揉眼',
  fu: '摸肚',
  sleep: '睡觉'
};

const reminderCopy: Record<ReminderKind, { title: string; detail: string; action: string }> = {
  eye: {
    title: '眼睛休息时间',
    detail: '看向远处，眨眨眼，离开屏幕一小会儿。',
    action: '放松眼睛'
  },
  walk: {
    title: '该起来走走',
    detail: '站起来活动肩颈和腿，喝口水也算完成。',
    action: '走动一下'
  },
  combined: {
    title: '休息眼睛，也走一走',
    detail: '这次把护眼和活动合并提醒，一次处理掉。',
    action: '休息一下'
  }
};

const formatClock = (timestamp: number): string => {
  if (!timestamp) {
    return '--:--';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(timestamp));
};

const minutesLeft = (timestamp: number): string => {
  const diff = Math.max(0, timestamp - Date.now());
  return `${Math.ceil(diff / 60_000)} 分钟`;
};

const route = window.location.hash.replace('#', '') || 'pet';

export function App(): JSX.Element {
  if (route === 'settings') {
    return <SettingsView />;
  }
  if (route === 'panel') {
    return <PanelView />;
  }
  if (route === 'bubble') {
    return <BubbleView />;
  }
  return <PetView />;
}

function useAppState() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<ReminderStatus>(DEFAULT_STATUS);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);

  useEffect(() => {
    let mounted = true;

    void Promise.all([
      window.eyeProtect.getSettings(),
      window.eyeProtect.getReminderStatus(),
      window.eyeProtect.getRuntimeInfo(),
      window.eyeProtect.getAlarms(),
      window.eyeProtect.getTodos()
    ]).then(([nextSettings, nextStatus, nextRuntime, nextAlarms, nextTodos]) => {
      if (!mounted) {
        return;
      }
      setSettings(nextSettings);
      setStatus(nextStatus);
      setRuntime(nextRuntime);
      setAlarms(nextAlarms);
      setTodos(nextTodos);
    });

    const offSettings = window.eyeProtect.onSettingsChanged(setSettings);
    const offReminder = window.eyeProtect.onReminderChanged(setStatus);
    const offAlarms = window.eyeProtect.onAlarmsChanged(setAlarms);
    const offTodos = window.eyeProtect.onTodosChanged(setTodos);
    return () => {
      mounted = false;
      offSettings();
      offReminder();
      offAlarms();
      offTodos();
    };
  }, []);

  return { settings, setSettings, status, setStatus, runtime, alarms, todos };
}

const COMPLETE_WAIT_SECONDS: Record<ReminderKind, number> = { eye: 30, walk: 60, combined: 60 };

const TODO_CONFIRM_RESET_MS = 2500;
const TODO_HINT_RESET_MS = 1800;
const TODO_CHAR_COUNTER_FROM = 48;

function PetView(): JSX.Element {
  const { settings, status, todos } = useAppState();
  const active = status.activeReminder;
  const copy = active ? reminderCopy[active.kind] : null;
  const alertClass = active ? 'is-alert' : '';
  const [firingAlarms, setFiringAlarms] = useState<Alarm[]>([]);
  const [waitSeconds, setWaitSeconds] = useState(0);

  // 「完成」必须先等倒计时走完；「跳过」随时可用；「稍后」只对每个提醒周期的
  // 第一次免等待，已经稍后过的提醒要像「完成」一样等完才能再点。
  const waiting = !!active && waitSeconds > 0;
  const completeLocked = waiting;
  const snoozeLocked = waiting && (active?.snoozeCount ?? 0) > 0;

  useEffect(() => {
    if (!active) {
      setWaitSeconds(0);
      return;
    }
    setWaitSeconds(COMPLETE_WAIT_SECONDS[active.kind]);
    const t = window.setInterval(() => {
      setWaitSeconds((prev) => Math.max(0, prev - 1));
    }, 1_000);
    return () => window.clearInterval(t);
  }, [active?.id]);

  const handleReminderDoubleClick = useCallback(() => {
    if (active && !completeLocked) {
      void window.eyeProtect.reminderAction('complete', active.id);
    }
  }, [active, completeLocked]);
  const handleSkinSelect = useCallback((skin: PetSkin) => {
    void window.eyeProtect.saveSettings({ petSkin: skin });
  }, []);
  const handleOpenAlarms = useCallback(() => {
    void window.eyeProtect.openPanel('alarms');
  }, []);
  const handleOpenTodos = useCallback(() => {
    void window.eyeProtect.openPanel('todos');
  }, []);

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    void window.eyeProtect.openPanel('alarms');
  }, []);

  useEffect(() => {
    const offFired = window.eyeProtect.onAlarmFired((alarm) => {
      setFiringAlarms((current) =>
        current.some((entry) => entry.id === alarm.id) ? current : [...current, alarm]
      );
    });
    return offFired;
  }, []);

  const dismissFiring = useCallback(() => {
    setFiringAlarms([]);
  }, []);

  const isFiring = firingAlarms.length > 0 && !active;
  const shellClass = `pet-shell ${alertClass} ${isFiring ? 'alarms-active' : ''}`;

  return (
    <main className={shellClass} onContextMenu={handleContextMenu}>
      {active ? null : (
        <>
          <button className="pet-alarm" title="闹钟" onClick={handleOpenAlarms}>
            <Clock3 size={18} />
          </button>
          <button className="pet-gear" title="打开设置" onClick={() => void window.eyeProtect.openSettings()}>
            <SettingsIcon size={18} />
          </button>
          <button
            className={`pet-todo-tab ${todos.length > 0 ? 'has-todos' : ''}`.trim()}
            title="待办"
            onClick={handleOpenTodos}
          >
            <ListChecks size={16} />
            <span className="pet-todo-tab-label">待办</span>
            {todos.length > 0 ? <span className="todo-count">{todos.length}</span> : null}
          </button>
        </>
      )}

      {active ? (
        <ReminderArtwork active={active} onDoubleClick={handleReminderDoubleClick} />
      ) : (
        <div className="character-stage">
          <PetCharacter skin={settings.petSkin} onSelect={handleSkinSelect} />
        </div>
      )}

      {isFiring ? (
        <button
          type="button"
          className="alarm-dismiss"
          title="关闭闹钟提醒"
          onClick={dismissFiring}
        >
          <X size={18} />
        </button>
      ) : null}

      {active ? (
        <section className="alert-panel">
          <div className="alert-heading">
            <span className={`kind-badge ${active.kind}`}>{active.kind === 'eye' ? '护眼' : active.kind === 'walk' ? '走动' : '休息'}</span>
            <h1>{copy?.title}</h1>
            <p>{copy?.detail}</p>
          </div>
          {completeLocked ? (
            <div className="alert-wait-hint">
              <span className="alert-wait-time">
                {waitSeconds} 秒后{snoozeLocked ? '可「完成」或「稍后」' : '可「完成」'}
              </span>
              <span className="alert-wait-note">「跳过」随时可用</span>
            </div>
          ) : null}
          <div className="alert-actions">
            <button
              className="primary"
              disabled={completeLocked}
              onClick={() => void window.eyeProtect.reminderAction('complete', active.id)}
            >
              <Check size={18} />
              完成
            </button>
            <button
              disabled={snoozeLocked}
              onClick={() => void window.eyeProtect.reminderAction('snooze', active.id)}
            >
              <Clock3 size={18} />
              稍后
            </button>
            <button onClick={() => void window.eyeProtect.reminderAction('skip', active.id)}>
              <X size={18} />
              跳过
            </button>
          </div>
        </section>
      ) : null}

    </main>
  );
}

function BubbleView(): JSX.Element {
  const [todos, setTodos] = useState<TodoItem[]>([]);

  useEffect(() => {
    let mounted = true;
    void window.eyeProtect.getTodos().then((next) => {
      if (mounted) {
        setTodos(next);
      }
    });
    const offTodos = window.eyeProtect.onTodosChanged(setTodos);
    return () => {
      mounted = false;
      offTodos();
    };
  }, []);

  const openTodos = useCallback(() => {
    void window.eyeProtect.openPanel('todos');
  }, []);

  const sorted = useMemo(() => sortTodosForDisplay(todos), [todos]);
  const pendingCount = useMemo(() => todos.filter((todo) => !todo.completed).length, [todos]);

  if (todos.length === 0) {
    // Defense in depth: the main process hides the bubble when the list is
    // empty, but never render a hollow card if a race ever shows it.
    return <></>;
  }

  const preview = sorted.slice(0, 3);
  const overflow = todos.length - preview.length;

  return (
    <div className="bubble-shell" role="button" title="查看全部待办" onClick={openTodos}>
      <div className="bubble-card">
        <div className="bubble-title">
          <ListChecks size={13} />
          <span>待办</span>
          <span className="bubble-count" title={`共 ${todos.length} 件，已完成 ${todos.length - pendingCount} 件`}>
            {pendingCount}
          </span>
        </div>
        <ul className="bubble-list">
          {preview.map((todo) => (
            <li key={todo.id} className={`bubble-item ${todo.completed ? 'is-done' : ''}`.trim()}>
              <span className="bubble-dot" />
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

function artworkFor(kind: ReminderKind): string[] {
  if (kind === 'eye') {
    return eyeArtwork;
  }
  if (kind === 'walk') {
    return walkArtwork;
  }
  return [...eyeArtwork, ...walkArtwork];
}

function ReminderArtwork({
  active,
  onDoubleClick
}: {
  active: ActiveReminder;
  onDoubleClick: () => void;
}): JSX.Element {
  const images = useMemo(() => artworkFor(active.kind), [active.kind]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (images.length <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % images.length);
    }, ARTWORK_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [images]);

  const src = images[index] ?? images[0];

  return (
    <div className="reminder-artwork" title="双击完成提醒" onDoubleClick={onDoubleClick}>
      <img src={src} alt={active.kind === 'walk' ? '走动提醒插画' : '护眼提醒插画'} draggable={false} />
    </div>
  );
}

function PetCharacter({ skin, onSelect }: { skin: PetSkin; onSelect: (skin: PetSkin) => void }): JSX.Element {
  return (
    <div className="pet-character" aria-label="EyeProtect 桌宠" title="按住拖动位置">
      <img src={petArtwork[skin]} alt="EyeProtect 桌宠" draggable={false} />
      <SkinPicker current={skin} onSelect={onSelect} />
    </div>
  );
}

function SkinPicker({ current, onSelect }: { current: PetSkin; onSelect: (skin: PetSkin) => void }): JSX.Element {
  return (
    <div className="skin-picker" role="group" aria-label="选择桌宠皮肤">
      {PET_SKINS.map((skin) => (
        <button
          key={skin}
          type="button"
          className="skin-thumb"
          aria-pressed={current === skin}
          title={petSkinLabel[skin]}
          onClick={() => onSelect(skin)}
        >
          <img src={petArtwork[skin]} alt={petSkinLabel[skin]} draggable={false} />
        </button>
      ))}
    </div>
  );
}

function formatAlarmClock(hour: number, minute: number): string {
  const hh = `${hour}`.padStart(2, '0');
  const mm = `${minute}`.padStart(2, '0');
  return `${hh}:${mm}`;
}

function clampAlarm(hour: number, minute: number): { hour: number; minute: number } {
  const h = Math.min(23, Math.max(0, Math.round(hour)));
  const m = Math.min(59, Math.max(0, Math.round(minute)));
  return { hour: h, minute: m };
}

function PanelView(): JSX.Element {
  const [tab, setTab] = useState<PanelTab>('todos');
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [nudge, setNudge] = useState(false);
  const dirtyRef = useRef(false);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let mounted = true;

    void Promise.all([
      window.eyeProtect.getPanelTab(),
      window.eyeProtect.getAlarms(),
      window.eyeProtect.getTodos()
    ]).then(([initialTab, nextAlarms, nextTodos]) => {
      if (!mounted) {
        return;
      }
      setTab(initialTab);
      setAlarms(nextAlarms);
      setTodos(nextTodos);
    });

    const offTab = window.eyeProtect.onPanelTab(setTab);
    const offAlarms = window.eyeProtect.onAlarmsChanged(setAlarms);
    const offTodos = window.eyeProtect.onTodosChanged(setTodos);
    return () => {
      mounted = false;
      offTab();
      offAlarms();
      offTodos();
    };
  }, []);

  // Smart close: when focus leaves the app entirely (main forwards panel:blur
  // only then), close automatically unless the user is mid-composition (todo
  // draft/edit or open alarm editor) — in that case stay open and nudge, so
  // alt-tabbing never destroys typed input.
  useEffect(() => {
    const offBlur = window.eyeProtect.onPanelBlur(() => {
      if (dirtyRef.current) {
        setNudge(true);
        if (nudgeTimerRef.current) {
          clearTimeout(nudgeTimerRef.current);
        }
        nudgeTimerRef.current = setTimeout(() => setNudge(false), TODO_HINT_RESET_MS);
        return;
      }
      void window.eyeProtect.closePanel();
    });
    return () => {
      offBlur();
      if (nudgeTimerRef.current) {
        clearTimeout(nudgeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !dirtyRef.current) {
        void window.eyeProtect.closePanel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  const handleAddTodo = useCallback((text: string) => {
    void window.eyeProtect.addTodo(text);
  }, []);
  const handleToggleTodo = useCallback((id: string) => {
    void window.eyeProtect.toggleTodo(id);
  }, []);
  const handleUpdateTodo = useCallback((id: string, text: string) => {
    void window.eyeProtect.updateTodo(id, text);
  }, []);
  const handleRemoveTodo = useCallback((id: string) => {
    void window.eyeProtect.removeTodo(id);
  }, []);
  const handleCancelAlarm = useCallback((id: string) => {
    void window.eyeProtect.cancelAlarm(id);
  }, []);

  const pendingCount = useMemo(() => todos.filter((todo) => !todo.completed).length, [todos]);

  return (
    <main className="panel-shell">
      <header className="panel-header">
        <div className="panel-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'todos'}
            className={tab === 'todos' ? 'is-active' : ''}
            title={`共 ${todos.length} 件，已完成 ${todos.length - pendingCount} 件`}
            onClick={() => setTab('todos')}
          >
            <ListChecks size={15} />
            待办
            {pendingCount > 0 ? <span className="panel-tab-count">{pendingCount}</span> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'alarms'}
            className={tab === 'alarms' ? 'is-active' : ''}
            onClick={() => setTab('alarms')}
          >
            <Clock3 size={15} />
            闹钟
            {alarms.length > 0 ? <span className="panel-tab-count">{alarms.length}</span> : null}
          </button>
        </div>
        <button
          type="button"
          className="panel-close"
          title="关闭"
          onClick={() => void window.eyeProtect.closePanel()}
        >
          <X size={16} />
        </button>
      </header>

      {nudge ? <span className="panel-nudge">有未保存内容，按 Esc 或点 × 关闭</span> : null}

      <div className="panel-body">
        {tab === 'todos' ? (
          <TodoSection
            todos={todos}
            onAdd={handleAddTodo}
            onToggle={handleToggleTodo}
            onUpdate={handleUpdateTodo}
            onRemove={handleRemoveTodo}
            onDirtyChange={handleDirtyChange}
          />
        ) : (
          <AlarmSection alarms={alarms} onCancel={handleCancelAlarm} onDirtyChange={handleDirtyChange} />
        )}
      </div>
    </main>
  );
}

function AlarmSection({
  alarms,
  onCancel,
  onDirtyChange
}: {
  alarms: Alarm[];
  onCancel: (id: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}): JSX.Element {
  const [editorOpen, setEditorOpen] = useState(false);
  const [hour, setHour] = useState(() => new Date().getHours());
  const [minute, setMinute] = useState(() => new Date().getMinutes());
  const [label, setLabel] = useState('');
  const [repeat, setRepeat] = useState<AlarmRepeat>('once');

  useEffect(() => {
    onDirtyChange?.(editorOpen);
    return () => onDirtyChange?.(false);
  }, [editorOpen, onDirtyChange]);

  const submit = useCallback(() => {
    const clamped = clampAlarm(hour, minute);
    void window.eyeProtect.setAlarm({
      hour: clamped.hour,
      minute: clamped.minute,
      label: label.trim() || undefined,
      repeat,
      enabled: true
    });
    setEditorOpen(false);
    setLabel('');
    setRepeat('once');
  }, [hour, minute, label, repeat]);

  return (
    <div className="panel-section">
      <div className="panel-scroll">
        <span className="alarm-section-title">已创建的闹钟</span>
        {alarms.length === 0 ? (
          <p className="alarm-menu-empty">还没有闹钟</p>
        ) : (
          <ul className="alarm-list">
            {alarms.map((alarm) => (
              <li key={alarm.id} className="alarm-list-item">
                <Clock3 size={14} />
                <span className="alarm-time">{formatAlarmClock(alarm.hour, alarm.minute)}</span>
                {alarm.label ? <span className="alarm-label">{alarm.label}</span> : null}
                <span className={`alarm-repeat ${alarm.repeat}`}>
                  {alarm.repeat === 'daily' ? '每天' : '单次'}
                </span>
                <button
                  type="button"
                  className="alarm-remove"
                  title="删除闹钟"
                  onClick={() => onCancel(alarm.id)}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editorOpen ? (
        <div className="alarm-editor">
          <span className="alarm-section-title">新建闹钟</span>
          <div className="alarm-time-inputs">
            <input
              type="number"
              min={0}
              max={23}
              value={hour}
              onChange={(event) => setHour(Number(event.currentTarget.value))}
              aria-label="小时"
            />
            <span className="alarm-time-sep">:</span>
            <input
              type="number"
              min={0}
              max={59}
              value={minute}
              onChange={(event) => setMinute(Number(event.currentTarget.value))}
              aria-label="分钟"
            />
          </div>
          <input
            className="alarm-label-input"
            type="text"
            placeholder="标签（可选）"
            value={label}
            maxLength={20}
            onChange={(event) => setLabel(event.currentTarget.value)}
          />
          <div className="alarm-repeat-toggle">
            <button
              type="button"
              className={repeat === 'once' ? 'is-active' : ''}
              onClick={() => setRepeat('once')}
            >
              单次
            </button>
            <button
              type="button"
              className={repeat === 'daily' ? 'is-active' : ''}
              onClick={() => setRepeat('daily')}
            >
              每天
            </button>
          </div>
          <div className="alarm-editor-actions">
            <button type="button" className="primary" onClick={submit}>
              确定
            </button>
            <button type="button" onClick={() => setEditorOpen(false)}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="alarm-add" onClick={() => setEditorOpen(true)}>
          <Plus size={14} />
          新建闹钟
        </button>
      )}
    </div>
  );
}

function TodoSection({
  todos,
  onAdd,
  onToggle,
  onUpdate,
  onRemove,
  onDirtyChange
}: {
  todos: TodoItem[];
  onAdd: (text: string) => void;
  onToggle: (id: string) => void;
  onUpdate: (id: string, text: string) => void;
  onRemove: (id: string) => void;
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
    (event: React.FormEvent) => {
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
    (event: React.KeyboardEvent) => {
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
                  <span className="todo-text" title="双击编辑" onDoubleClick={() => startEdit(todo)}>
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

function SettingsView(): JSX.Element {
  const { settings, setSettings, status, runtime } = useAppState();
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const update = useCallback(
    async (patch: Partial<Settings>) => {
      setSaving(true);
      const next = await window.eyeProtect.saveSettings(patch);
      setSettings(next);
      setSaving(false);
      setSavedAt(Date.now());
    },
    [setSettings]
  );

  const nextItems = useMemo(
    () => [
      { label: '下次护眼', value: formatClock(status.nextEyeAt), sub: minutesLeft(status.nextEyeAt), icon: <Eye size={20} /> },
      {
        label: '下次走动',
        value: formatClock(status.nextWalkAt),
        sub: minutesLeft(status.nextWalkAt),
        icon: <Footprints size={20} />
      }
    ],
    [status.nextEyeAt, status.nextWalkAt]
  );

  return (
    <main className="settings-shell">
      <header className="settings-header">
        <div>
          <span className="eyebrow">EyeProtect</span>
          <h1>提醒设置</h1>
        </div>
        <button className="icon-button" title="关闭设置" onClick={() => void window.eyeProtect.closeSettings()}>
          <X size={20} />
        </button>
      </header>

      <section className="status-strip">
        {nextItems.map((item) => (
          <div className="status-item" key={item.label}>
            {item.icon}
            <div>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <small>{item.sub}</small>
            </div>
          </div>
        ))}
      </section>

      <section className="settings-section">
        <h2>提醒间隔</h2>
        <NumberField
          label="护眼提醒"
          value={settings.eyeIntervalMinutes}
          min={SETTINGS_LIMITS.eyeIntervalMinutes.min}
          max={SETTINGS_LIMITS.eyeIntervalMinutes.max}
          suffix="分钟"
          icon={<Eye size={18} />}
          onCommit={(value) => void update({ eyeIntervalMinutes: value })}
        />
        <NumberField
          label="走动提醒"
          value={settings.walkIntervalMinutes}
          min={SETTINGS_LIMITS.walkIntervalMinutes.min}
          max={SETTINGS_LIMITS.walkIntervalMinutes.max}
          suffix="分钟"
          icon={<Footprints size={18} />}
          onCommit={(value) => void update({ walkIntervalMinutes: value })}
        />
        <NumberField
          label="稍后提醒"
          value={settings.snoozeMinutes}
          min={SETTINGS_LIMITS.snoozeMinutes.min}
          max={SETTINGS_LIMITS.snoozeMinutes.max}
          suffix="分钟"
          icon={<Clock3 size={18} />}
          onCommit={(value) => void update({ snoozeMinutes: value })}
        />
      </section>

      <section className="settings-section">
        <h2>桌宠</h2>
        <NumberField
          label="桌宠缩放"
          value={Math.round(settings.petScale * 100)}
          min={Math.round(SETTINGS_LIMITS.petScale.min * 100)}
          max={Math.round(SETTINGS_LIMITS.petScale.max * 100)}
          suffix="%"
          icon={<RotateCcw size={18} />}
          onCommit={(value) => void update({ petScale: value / 100 })}
        />
        <label className="switch-row">
          <span>
            <strong>提醒时置黑桌面</strong>
            <small>触发护眼/走动提醒时把其他界面全部置黑，只留提醒卡片</small>
          </span>
          <input
            type="checkbox"
            checked={settings.dimDesktop}
            onChange={(event) => void update({ dimDesktop: event.currentTarget.checked })}
          />
        </label>
        <label className="switch-row">
          <span>
            <strong>开机自启</strong>
            <small>便携版会在当前 exe 位置创建启动快捷方式</small>
          </span>
          <input
            type="checkbox"
            checked={settings.startWithWindows}
            onChange={(event) => void update({ startWithWindows: event.currentTarget.checked })}
          />
        </label>
      </section>

      <section className="settings-section compact">
        <h2>手动测试</h2>
        <div className="test-actions">
          <button onClick={() => void window.eyeProtect.testReminder('eye')}>
            <Eye size={18} />
            护眼提醒
          </button>
          <button onClick={() => void window.eyeProtect.testReminder('walk')}>
            <Footprints size={18} />
            走动提醒
          </button>
          <button onClick={() => void window.eyeProtect.pause(60)}>
            <Pause size={18} />
            暂停 1 小时
          </button>
          <button onClick={() => void window.eyeProtect.pause(1)}>
            <Play size={18} />
            暂停 1 分钟
          </button>
        </div>
      </section>

      <footer className="settings-footer">
        <span>{saving ? '保存中...' : savedAt ? `已保存 ${formatClock(savedAt)}` : '设置会自动保存'}</span>
        <span>{runtime?.riveAvailable ? 'Rive 角色已加载' : '使用内置占位角色'}</span>
      </footer>
    </main>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  suffix,
  icon,
  onCommit
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  icon: JSX.Element;
  onCommit: (value: number) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (): void => {
    const parsed = Number(draft);
    const next = Math.round(Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : value)));
    setDraft(String(next));
    if (next !== value) {
      onCommit(next);
    }
  };

  return (
    <label className="number-row">
      <span className="number-label">
        {icon}
        <strong>{label}</strong>
      </span>
      <span className="number-control">
        <input
          value={draft}
          inputMode="numeric"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
        />
        <small>{suffix}</small>
      </span>
    </label>
  );
}
