import { useEffect, useState } from 'react';

export function NumberField({
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
