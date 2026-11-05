import { OutlineIcon } from '../../shared/ui/icons/OutlineIcon';

/** The icon of the Indicators button: a rising line chart with the plus that adds one. */
export function IndicatorsIcon({ className }: { className: string }) {
  return (
    <OutlineIcon className={className}>
      <path d="M3 18l5-5 4 3 6-7" />
      <path d="M18 3v6M15 6h6" />
    </OutlineIcon>
  );
}
