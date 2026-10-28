import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useEscapeDismissal, useOutsidePointerDismissal } from '../../shared/ui/popup/useDismissal';

const EDGE_MARGIN = 8;
/** Gap between the anchor point and the panel so the painted chip stays visible. */
const ANCHOR_GAP = 4;

interface ChartAnchoredPanelProps {
  /** Anchor in chart-frame pixels: the panel's top-left corner minus the gap. */
  x: number;
  y: number;
  onDismiss: () => void;
  children: ReactNode;
}

interface PanelOrigin {
  left: number;
  top: number;
}

/** A DOM panel hung from a point of the chart frame, kept inside it, dismissed by Escape or an outside press. */
export function ChartAnchoredPanel({ x, y, onDismiss, children }: ChartAnchoredPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState<PanelOrigin>({ left: x, top: y + ANCHOR_GAP });
  useEscapeDismissal(onDismiss);
  useOutsidePointerDismissal(panelRef, onDismiss);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const frame = panel?.offsetParent;
    if (!panel || !frame) {
      return;
    }
    const place = () => {
      const left = Math.max(EDGE_MARGIN, Math.min(x, frame.clientWidth - panel.offsetWidth - EDGE_MARGIN));
      const top = Math.max(
        EDGE_MARGIN,
        Math.min(y + ANCHOR_GAP, frame.clientHeight - panel.offsetHeight - EDGE_MARGIN),
      );
      setOrigin((current) => (current.left === left && current.top === top ? current : { left, top }));
    };
    place();
    // The form grows when it shows a validation message.
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [x, y]);

  return (
    <div ref={panelRef} className="chart-anchored-panel" style={origin}>
      {children}
    </div>
  );
}
