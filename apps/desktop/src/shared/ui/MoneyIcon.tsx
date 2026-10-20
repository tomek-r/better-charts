import { OutlineIcon } from './OutlineIcon';

/** Outline stack of banknotes: the front note has notched corners and a centre coin, two more notes
 * peek out behind it toward the top right. Sized in em by its class. */
export function MoneyIcon({ className }: { className: string }) {
  return (
    <OutlineIcon className={className}>
      <path d="M8.5 3H22.5V11" />
      <path d="M6 5.5H21V13.5" />
      <path d="M4.5 8H17.5A2 2 0 0 0 19.5 10V16A2 2 0 0 0 17.5 18H4.5A2 2 0 0 0 2.5 16V10A2 2 0 0 0 4.5 8Z" />
      <circle cx="11" cy="13" r="2.5" />
    </OutlineIcon>
  );
}
