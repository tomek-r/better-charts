import { OutlineIcon } from './OutlineIcon';

/** Outline classical bank kept minimal so it stays crisp at text size: a triangular roof, four evenly spaced plain
 * columns and one base line, all on whole or half units of the 24x24 box. Sized in em by its class. */
export function BankIcon({ className }: { className: string }) {
  return (
    <OutlineIcon className={className}>
      <path d="M12 3L21 9H3Z" />
      <path d="M6 12V18" />
      <path d="M10 12V18" />
      <path d="M14 12V18" />
      <path d="M18 12V18" />
      <path d="M3 21H21" />
    </OutlineIcon>
  );
}
