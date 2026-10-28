import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface CommandButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'title' | 'aria-label' | 'aria-pressed' | 'children'
> {
  /** Both the accessible name and the tooltip: the button shows only an icon. */
  readonly label: string;
  /** Only toggles set it; a plain command leaves the attribute off. */
  readonly pressed?: boolean;
  readonly children: ReactNode;
}

/** An icon-only command button named by its label. Extra props (className, tabIndex, handlers) pass through. */
export function CommandButton({ label, pressed, children, ...buttonProps }: CommandButtonProps) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={pressed} {...buttonProps}>
      {children}
    </button>
  );
}
