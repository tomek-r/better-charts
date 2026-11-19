import { OutlineIcon } from '../../shared/ui/icons/OutlineIcon';

/** The icon of the Indicators button: three bars stepping up, with a trend line rising over them. */
export function IndicatorsIcon({ className }: { className: string }) {
  return (
    <OutlineIcon className={className}>
      <path d="M5 20v-4M10 20v-7M15 20v-10" />
      <path d="M3.5 12l15.5-7M19 5l-3-0.6M19 5l-1.5 2.6" />
    </OutlineIcon>
  );
}
