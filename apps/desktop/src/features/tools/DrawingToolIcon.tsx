import type { ChartToolIconSpec } from './chartToolPlugin';
import { CHART_TOOL_PLUGINS, type ChartToolId } from './registry';

export function DrawingToolIcon({
  name,
  size = 18,
  className,
}: {
  name: ChartToolId;
  size?: number;
  className?: string;
}) {
  const spec: ChartToolIconSpec = CHART_TOOL_PLUGINS.find((plugin) => plugin.id === name)!.icon;
  return (
    <svg
      className={`drawing-tool-icon${className ? ` ${className}` : ''}`}
      data-icon={name}
      width={size}
      height={size}
      viewBox={spec.viewBox ?? '0 0 24 24'}
      fill="none"
      stroke="currentColor"
      strokeWidth={spec.strokeWidth ?? 2.2}
      strokeLinecap={spec.linecap ?? 'round'}
      strokeLinejoin={spec.linejoin ?? 'round'}
      aria-hidden="true"
      focusable="false"
    >
      {spec.node}
    </svg>
  );
}
