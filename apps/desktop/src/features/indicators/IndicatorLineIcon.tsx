import { OutlineIcon } from '../../shared/ui/icons/OutlineIcon';

/** The glyph of an indicator row: the line an overlay indicator draws across the price pane. */
export function IndicatorLineIcon({ className }: { readonly className: string }) {
  return (
    <OutlineIcon className={className}>
      <path d="M3 16l4-4 4 3 6-7 4 3" />
    </OutlineIcon>
  );
}
