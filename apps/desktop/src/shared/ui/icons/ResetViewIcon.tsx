import { OutlineIcon } from './OutlineIcon';

/** Counter-clockwise arrow: the "back to the starting view" mark. */
export function ResetViewIcon({ className }: { className: string }) {
  return (
    <OutlineIcon className={className}>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5" />
      <path d="M4.5 4.5V8.5H8.5" />
    </OutlineIcon>
  );
}
