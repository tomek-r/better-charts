/** The narrowest a body is ever drawn, in device pixels. */
const NARROWEST_BODY_WIDTH = 1;

/** The volumes the visible bars of a window trade between, which the bodies are scaled across. */
export interface VisibleVolumeRange {
  readonly min: number;
  readonly max: number;
}

/**
 * How far one bar's volume sits from the quietest visible bar towards the busiest, as a share of the way the
 * two span. A window whose bars all traded alike spans nothing, so every bar there counts as the busiest one.
 */
function relativeVolumeOf(volume: number, visibleVolumes: VisibleVolumeRange): number {
  const spread = visibleVolumes.max - visibleVolumes.min;
  if (spread <= 0) {
    return 1;
  }
  return (volume - visibleVolumes.min) / spread;
}

/**
 * How wide one bar's body is drawn: `fullWidth` less the share `widthSensitivity` takes off a bar as quiet as
 * the quietest visible one. The busiest visible bar fills the whole width and the quietest narrows to the
 * narrowest body, whatever volumes the two trade; a window with nothing to compare draws every body in full.
 */
export function volumeCandleWidth(
  volume: number,
  visibleVolumes: VisibleVolumeRange,
  fullWidth: number,
  widthSensitivity: number,
): number {
  const share = 1 - widthSensitivity * (1 - relativeVolumeOf(volume, visibleVolumes));
  return Math.max(NARROWEST_BODY_WIDTH, Math.round(fullWidth * share));
}
