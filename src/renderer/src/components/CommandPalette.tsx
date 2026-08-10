import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Dialog, TextField } from './primitives';

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

export function CommandPalette({
  open,
  commands,
  onClose
}: {
  open: boolean;
  commands: PaletteCommand[];
  onClose: () => void;
}): JSX.Element | null {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return commands;
    return commands.filter((command) => `${command.label} ${command.keywords ?? ''}`.toLocaleLowerCase().includes(needle));
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => setActiveIndex((current) => Math.min(current, Math.max(0, filtered.length - 1))), [filtered.length]);

  const execute = (command: PaletteCommand | undefined): void => {
    if (!command) return;
    onClose();
    command.run();
  };

  return (
    <Dialog open={open} title="快速前往" description="搜索页面或操作；也可以使用方向键和回车。" onClose={onClose}>
      <div className="command-palette-search">
        <Search size={17} aria-hidden="true" />
        <TextField
          value={query}
          placeholder="输入命令…"
          aria-label="搜索命令"
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((current) => Math.min(filtered.length - 1, current + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((current) => Math.max(0, current - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              execute(filtered[activeIndex]);
            }
          }}
        />
      </div>
      <div className="command-palette-list" role="listbox" aria-label="命令">
        {filtered.map((command, index) => (
          <button
            key={command.id}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            className={index === activeIndex ? 'is-active' : ''}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => execute(command)}
          >
            <span>{command.label}</span>
            {command.hint ? <kbd>{command.hint}</kbd> : null}
          </button>
        ))}
        {filtered.length === 0 ? <p>没有匹配的命令</p> : null}
      </div>
    </Dialog>
  );
}
