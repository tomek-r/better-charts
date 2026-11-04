import { OutlineIcon } from './OutlineIcon';

/** A tick: the mark a menu row carries beside the value it holds, and a ticked box in a dialog. */
export function CheckIcon({ className }: { className: string }) {
  return (
    <OutlineIcon className={className}>
      <path d="M5 12.5 9.5 17 19 7.5" />
    </OutlineIcon>
  );
}
