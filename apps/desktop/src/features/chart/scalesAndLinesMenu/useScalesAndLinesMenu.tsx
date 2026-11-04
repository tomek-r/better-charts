import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChartAnchoredPanel } from '../../partial-close/ChartAnchoredPanel';
import { useChartResources } from '../ChartWorkspaceProvider';
import { useOpenChartSettings } from '../chartSettings/dialog/ChartSettingsDialogHost';
import { SCALES_AND_LINES_MENU_REQUESTED_EVENT } from '../engine/priceScale/chartSettingsCornerButton';
import { PRICE_SCALE_AUTO_CHANGED_EVENT, type PriceScaleAutoDetail } from '../engine/priceScale/priceScaleController';
import { ScalesAndLinesMenu } from './ScalesAndLinesMenu';

/** The tab of the settings dialog the menu's settings row opens: the scales, their labels and their lines. */
const SCALES_TAB_ID = 'scales';

/** Room between the menu and the gear it hangs above. */
const GAP_ABOVE_GEAR_PX = 4;

/** ChartAnchoredPanel starts the panel this far below the anchor point it is handed (its ANCHOR_GAP). */
const PANEL_ANCHOR_GAP_PX = 4;

/** The gear's top-right corner in chart-frame pixels: the point the menu is hung from. */
interface GearCorner {
  readonly right: number;
  readonly top: number;
}

/** The anchor point the panel is handed, in chart-frame pixels. */
interface PanelAnchor {
  readonly x: number;
  readonly y: number;
}

/** Whether the pointer pressed `gear` or something drawn inside it, such as the gear's own glyph. */
function pressesGear(target: EventTarget | null, gear: HTMLElement | null): boolean {
  return gear !== null && target instanceof Node && gear.contains(target);
}

/** Where the gear's corner sits in the chart frame, which is the box the frame's pixels are measured in. */
function gearCorner(gear: HTMLElement, frame: HTMLElement): GearCorner {
  const frameBox = frame.getBoundingClientRect();
  const gearBox = gear.getBoundingClientRect();
  return { right: gearBox.right - frameBox.left, top: gearBox.top - frameBox.top };
}

/** The anchor that puts a menu of this size above the gear, its right edge on the gear's. */
function anchorAboveGear(corner: GearCorner, menu: HTMLElement): PanelAnchor {
  return {
    x: corner.right - menu.offsetWidth,
    y: corner.top - menu.offsetHeight - GAP_ABOVE_GEAR_PX - PANEL_ANCHOR_GAP_PX,
  };
}

/**
 * Owns the Scales and lines menu the gear in the chart's corner opens. The gear is a button the engine draws
 * on the chart's canvas, out of React's reach: it asks for the menu with an event raised on the chart's host.
 * The menu's anchor above the gear and the auto scale it follows live are kept here.
 */
export function useScalesAndLinesMenu(): ReactNode {
  const { chart, chartHost } = useChartResources();
  const openChartSettings = useOpenChartSettings();
  const menuRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLElement>(null);
  /** Whether the menu is open as the presses below see it, which a render's state is too late for. */
  const openRef = useRef(false);
  /** Set by the press that closed the menu from the gear, whose click must not open the menu again. */
  const pressClosedRef = useRef(false);
  const [corner, setCorner] = useState<GearCorner>();
  const [anchor, setAnchor] = useState<PanelAnchor>();
  const [autoScale, setAutoScale] = useState(false);

  const close = useCallback(() => {
    openRef.current = false;
    setCorner(undefined);
    setAnchor(undefined);
  }, []);
  const closeToGear = useCallback(() => {
    close();
    gearRef.current?.focus();
  }, [close]);

  // The gear asks for the menu with an event raised on the chart's host. The auto scale is read as the menu
  // opens: it is the scale's own state, and none of the chart's saved settings.
  useEffect(() => {
    const host = chartHost.current;
    if (host === null) {
      return undefined;
    }
    const onMenuRequested = (event: Event) => {
      if (pressClosedRef.current) {
        pressClosedRef.current = false;
        return;
      }
      const gear = event.target;
      const controller = chart.current;
      if (!(gear instanceof HTMLElement) || controller === null) {
        return;
      }
      gearRef.current = gear;
      openRef.current = true;
      setAutoScale(controller.priceScaleState().autoScale);
      setCorner(gearCorner(gear, host));
    };
    host.addEventListener(SCALES_AND_LINES_MENU_REQUESTED_EVENT, onMenuRequested);
    return () => host.removeEventListener(SCALES_AND_LINES_MENU_REQUESTED_EVENT, onMenuRequested);
  }, [chart, chartHost]);

  // The press that dismisses the panel around the menu also lands on the gear, whose click then asks for the
  // menu again: a press on the gear closes the menu itself, and the request its click raises is left alone.
  useEffect(() => {
    const onPress = (event: PointerEvent) => {
      const onGear = pressesGear(event.target, gearRef.current);
      pressClosedRef.current = onGear && openRef.current;
      if (pressClosedRef.current) {
        close();
      }
    };
    window.addEventListener('pointerdown', onPress, true);
    return () => window.removeEventListener('pointerdown', onPress, true);
  }, [close]);

  // The auto scale moves on its own too — the A toggle, a dragged axis — and the row follows it while it is open.
  useEffect(() => {
    const host = chartHost.current;
    if (host === null || corner === undefined) {
      return undefined;
    }
    const onAutoScaleChanged = (event: Event) => {
      setAutoScale((event as CustomEvent<PriceScaleAutoDetail>).detail.autoScale);
    };
    host.addEventListener(PRICE_SCALE_AUTO_CHANGED_EVENT, onAutoScaleChanged);
    return () => host.removeEventListener(PRICE_SCALE_AUTO_CHANGED_EVENT, onAutoScaleChanged);
  }, [chartHost, corner]);

  // The menu is measured before it is painted, so it opens above the gear with the two right edges on each other.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (corner === undefined || menu === null) {
      return undefined;
    }
    const place = () => setAnchor(anchorAboveGear(corner, menu));
    place();
    // The reset row comes and goes with the auto scale, and whatever size the menu takes keeps its foot on the gear.
    const sizeChanges = new ResizeObserver(place);
    sizeChanges.observe(menu);
    return () => sizeChanges.disconnect();
  }, [corner]);

  const resetView = () => {
    chart.current?.resetChartView();
    closeToGear();
  };
  const setScaleAutoScale = (on: boolean) => {
    chart.current?.setAutoScale(on);
    closeToGear();
  };
  const openSettings = () => {
    closeToGear();
    openChartSettings(SCALES_TAB_ID);
  };

  if (corner === undefined) {
    return null;
  }
  return (
    <ChartAnchoredPanel x={anchor?.x ?? corner.right} y={anchor?.y ?? corner.top} onDismiss={close}>
      <ScalesAndLinesMenu
        menuRef={menuRef}
        autoScale={autoScale}
        onSetAutoScale={setScaleAutoScale}
        onResetView={resetView}
        onOpenSettings={openSettings}
        onClose={closeToGear}
      />
    </ChartAnchoredPanel>
  );
}
