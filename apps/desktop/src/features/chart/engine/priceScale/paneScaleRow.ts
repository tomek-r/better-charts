import type { ScaleButtonsMode } from '../surface/chartScalesAppearance';

/** What one row says, so the price pane and an indicator pane can word their two buttons differently. */
export interface PaneScaleLabels {
  readonly group: string;
  readonly auto: string;
  readonly log: string;
}

/** The row the stylesheet in this folder paints; every pane's row carries it, the price pane's first. */
const ROW_CLASS = 'price-scale-controls';
const REVEALED_CLASS = 'price-scale-controls-revealed';
const ALWAYS_CLASS = 'price-scale-controls-always';
const PRESSED_CLASS = 'price-scale-control-on';
const AUTO_GLYPH = 'A';
const LOG_GLYPH = 'L';
/** The title the `L` button carries while its pane holds a value a logarithmic scale cannot draw. */
const LOG_NEEDS_POSITIVE_VALUES = 'Logarithmic scale needs values above zero';
/** How far above its pane's bottom line the row's foot stands, clear of the line the pane draws there. */
const ROW_FOOT_GAP_PX = 4;
/** The axis's left border, which the row's opaque fill leaves showing. */
const AXIS_BORDER_PX = 1;

function control(glyph: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = glyph;
  button.title = label;
  button.setAttribute('aria-label', label);
  return button;
}

function markPressed(button: HTMLButtonElement, pressed: boolean): void {
  button.setAttribute('aria-pressed', String(pressed));
  button.classList.toggle(PRESSED_CLASS, pressed);
}

/**
 * One pane's `A` / `L` row, sitting in that pane's own axis column at the foot of its axis.
 *
 * Ordinary HTML buttons rather than a primitive: the library paints the axis on its own canvas and
 * gives plugins no hit testing, cursor or focus there, so a drawn button could not be clicked with the
 * mouse or reached with the keyboard. A row is revealed by a pointer hit test built from public
 * geometry only — the pane's own axis width and the pane's element — which is also the region
 * Lightweight Charts itself treats as the price scale. The Scale modes setting keeps every row on
 * screen, or takes it away.
 *
 * The pressed state is read back from the scale, never held as the truth: the library changes those
 * options on its own too, by turning auto scale off when the axis is dragged and on again when it is
 * double-clicked. What the row holds is only what it last wrote, so a repeated read writes nothing.
 * Position and paint are CSS; only the runtime geometry (the axis width and the distance to the pane's
 * foot) is written here.
 */
export class PaneScaleRow {
  private readonly root: HTMLDivElement;
  private readonly autoButton: HTMLButtonElement;
  private readonly logButton: HTMLButtonElement;
  private readonly onAuto: () => void;
  private readonly onLog: () => void;
  /** The `L` button's own wording, restored when the pane allows a logarithmic scale again. */
  private readonly logLabel: string;
  private revealed = false;
  private autoScale = false;
  private logarithmic = false;
  private logAllowed = true;

  constructor(host: HTMLElement, labels: PaneScaleLabels, onAuto: () => void, onLog: () => void) {
    this.onAuto = onAuto;
    this.onLog = onLog;
    this.logLabel = labels.log;
    this.root = document.createElement('div');
    this.root.className = ROW_CLASS;
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', labels.group);
    this.autoButton = control(AUTO_GLYPH, labels.auto);
    this.logButton = control(LOG_GLYPH, labels.log);
    // Both buttons start unpressed and both fields say so, so the first read of a scale writes nothing.
    markPressed(this.autoButton, this.autoScale);
    markPressed(this.logButton, this.logarithmic);
    this.autoButton.addEventListener('click', onAuto);
    this.logButton.addEventListener('click', onLog);
    this.root.append(this.autoButton, this.logButton);
    host.appendChild(this.root);
  }

  /**
   * Puts the row's foot just above the pane's bottom line, measured from the host's own foot. A pane whose
   * DOM does not exist yet hands over `null`, and the stylesheet's default stays in place until it does.
   */
  place(host: HTMLElement, paneElement: HTMLElement | null): void {
    if (paneElement === null) {
      this.root.style.bottom = '';
      return;
    }
    const paneFootOffset = host.getBoundingClientRect().bottom - paneElement.getBoundingClientRect().bottom;
    this.root.style.bottom = `${paneFootOffset + ROW_FOOT_GAP_PX}px`;
  }

  /** Writes the state its scale reports, and only the part of it that moved; the caller knows the scale. */
  setPressed(autoScale: boolean, logarithmic: boolean): void {
    if (autoScale !== this.autoScale) {
      this.autoScale = autoScale;
      markPressed(this.autoButton, autoScale);
    }
    if (logarithmic !== this.logarithmic) {
      this.logarithmic = logarithmic;
      markPressed(this.logButton, logarithmic);
    }
  }

  /**
   * Whether the `L` button can be used: a logarithmic scale cannot draw a pane holding a value below
   * zero, so the button is disabled and its title says why until the pane's values allow it again.
   */
  setLogAllowed(allowed: boolean): void {
    if (allowed === this.logAllowed) {
      return;
    }
    this.logAllowed = allowed;
    this.logButton.disabled = !allowed;
    this.logButton.title = allowed ? this.logLabel : LOG_NEEDS_POSITIVE_VALUES;
  }

  /** Matches the row to its axis column, stopping short of the axis's left border so that border shows. */
  setWidth(axisWidth: number): void {
    const next = `${axisWidth - AXIS_BORDER_PX}px`;
    if (this.root.style.width !== next) {
      this.root.style.width = next;
    }
  }

  /**
   * Fills the row's box with the chart's own background colour. That fill is what masks the axis labels
   * behind the buttons, so it must be opaque; `null` drops the inline colour, leaving the row painted by
   * its opaque CSS default.
   */
  setMaskColor(color: string | null): void {
    this.root.style.backgroundColor = color ?? '';
  }

  /**
   * What the Scale modes setting asks of the row: `mouseOver` reveals it while the pointer is over the
   * axis, `always` keeps it on screen, and `hidden` removes it — a `hidden` element takes no pointer
   * press and no focus, so its buttons cannot be reached at all.
   */
  setModeButtons(mode: ScaleButtonsMode): void {
    this.root.hidden = mode === 'hidden';
    this.root.classList.toggle(ALWAYS_CLASS, mode === 'always');
    this.conceal();
  }

  isRevealed(): boolean {
    return this.revealed;
  }

  reveal(): void {
    if (this.revealed) {
      return;
    }
    this.revealed = true;
    this.root.classList.add(REVEALED_CLASS);
  }

  conceal(): void {
    if (!this.revealed) {
      return;
    }
    this.revealed = false;
    this.root.classList.remove(REVEALED_CLASS);
  }

  destroy(): void {
    this.autoButton.removeEventListener('click', this.onAuto);
    this.logButton.removeEventListener('click', this.onLog);
    this.root.remove();
  }
}
