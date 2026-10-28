import type { ReactNode } from 'react';
import { CommandButton, type CommandButtonProps } from './CommandButton';

/** The command's two faces: what it does while its toggle is off, and what it does while it is on. */
export interface ToggleCommandLabels {
  readonly off: string;
  readonly on: string;
}

interface ToggleCommandButtonProps extends Omit<CommandButtonProps, 'label' | 'pressed' | 'children'> {
  readonly labels: ToggleCommandLabels;
  readonly offIcon: ReactNode;
  readonly onIcon: ReactNode;
  readonly pressed: boolean;
}

/** A command button that names the next command and keeps the current state pressed. */
export function ToggleCommandButton({ labels, offIcon, onIcon, pressed, ...buttonProps }: ToggleCommandButtonProps) {
  return (
    <CommandButton label={pressed ? labels.on : labels.off} pressed={pressed} {...buttonProps}>
      {pressed ? onIcon : offIcon}
    </CommandButton>
  );
}
