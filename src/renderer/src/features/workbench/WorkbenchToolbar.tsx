import { Search, X } from 'lucide-react';
import { CommandButton } from '../../components/CommandButton';
import { IconButton } from '../../components/primitives';
import type { CommandState } from '../../../../shared/types';

export interface WorkbenchToolbarProps {
  searchOpen: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onCloseSearch: () => void;
  onOpenPalette: () => void;
  continuousActiveMs: number;
  formatMinutes: (ms: number) => string;
  pausedUntil: number | null;
  resumeState: CommandState;
  resumeError?: string;
  onResume: () => void;
  pauseState: CommandState;
  pauseError?: string;
  onPause: (minutes: number) => void;
}

// Presentational shell: the global search/palette trigger plus the activity
// rhythm + pause/resume controls. State is owned by WorkbenchView.
export function WorkbenchToolbar({
  searchOpen,
  search,
  onSearchChange,
  onCloseSearch,
  onOpenPalette,
  continuousActiveMs,
  formatMinutes,
  pausedUntil,
  resumeState,
  resumeError,
  onResume,
  pauseState,
  pauseError,
  onPause
}: WorkbenchToolbarProps): JSX.Element {
  return (
    <header className="workspace-toolbar">
      {searchOpen ? (
        <label className="workspace-search">
          <Search size={17} />
          <input
            autoFocus
            value={search}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            placeholder="搜索标题、备注或标签"
          />
          <IconButton aria-label="关闭搜索" onClick={onCloseSearch}><X size={17} /></IconButton>
        </label>
      ) : (
        <button type="button" className="command-palette-trigger" onClick={onOpenPalette}>
          <Search size={18} />
          <span>搜索或运行命令</span>
          <kbd>Ctrl K</kbd>
        </button>
      )}
      <div className="toolbar-rhythm">
        <span>连续活跃 {formatMinutes(continuousActiveMs)}</span>
        {pausedUntil ? (
          <CommandButton state={resumeState} errorReason={resumeError} onClick={onResume}>恢复提醒</CommandButton>
        ) : (
          <CommandButton state={pauseState} errorReason={pauseError} onClick={() => onPause(30)}>暂停 30 分钟</CommandButton>
        )}
      </div>
    </header>
  );
}
