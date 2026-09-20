import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

export const buttonClassNames = (
  variant: ButtonVariant = 'secondary',
  className: string = ''
): string => `ui-button ui-button--${variant} ${className}`.trim();

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  children,
  ...props
}: ButtonProps): JSX.Element {
  return (
    <button
      type={type}
      className={buttonClassNames(variant, className)}
      {...props}
    >
      {children}
    </button>
  );
}

export function IconButton({
  className = '',
  type = 'button',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }): JSX.Element {
  return (
    <button type={type} className={`ui-icon-button ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
