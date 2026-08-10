import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes
} from 'react';

export function Field({
  label,
  hint,
  error,
  className = '',
  children,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className={`ui-field ${className}`.trim()} {...props}>
      <span className="ui-field__label">{label}</span>
      {children}
      {error ? <span className="ui-field__error" role="alert">{error}</span> : null}
      {!error && hint ? <span className="ui-field__hint">{hint}</span> : null}
    </label>
  );
}

export function TextField({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return <input className={`ui-input ${className}`.trim()} type="text" {...props} />;
}

export function Select({
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return <select className={`ui-select ${className}`.trim()} {...props}>{children}</select>;
}

export function DateTimeField({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return <input className={`ui-input ui-datetime-field ${className}`.trim()} type="datetime-local" {...props} />;
}
