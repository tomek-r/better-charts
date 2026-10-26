/** Where the partial-close menu hangs: the bottom-left corner of the ▾ chip, in chart-host pixels. */
export interface PartialCloseMenuRequest {
  positionId: string;
  x: number;
  y: number;
}

/**
 * What the painted position chip needs from the DOM host that renders the menu and the
 * custom-volume form. The engine never imports React; the host registers this port.
 */
export interface PartialCloseChipPort {
  openMenu(request: PartialCloseMenuRequest): void;
  /** True while the custom-volume form is open for this position: its ✕ must do nothing. */
  isFullCloseBlocked(positionId: string): boolean;
  /** Drops a lingering menu when the ✕ goes ahead with a full close. */
  dismiss(): void;
}
