import { OutlineIcon } from '../../shared/ui/icons/OutlineIcon';

/** Outline circle holding a person's head and shoulders, with a small card (a dashed line across its
 * middle) overlapping the bottom right. Sized in em by its class. */
export function AccountIcon({ className }: { className: string }) {
  return (
    <OutlineIcon className={className}>
      <path d="M21 12A9 9 0 1 0 12 21" />
      <circle cx="11" cy="9" r="3" />
      <path d="M6 18.5C6 16 8 14.5 11 14.5" />
      <rect x="12.5" y="14" width="10" height="7.5" rx="1.5" />
      <path d="M12.5 17.75H22.5" strokeDasharray="2 1.6" />
    </OutlineIcon>
  );
}
