import { DrawingToolRail } from './DrawingToolRail';
import { useChartResources } from '../chart/ChartWorkspaceProvider';
import { useChartDrawing } from './DrawingContextProvider';

export function DrawingToolsView() {
  const { activeChartToolId, selectChartTool } = useChartDrawing();
  const { chart } = useChartResources();

  return (
    <DrawingToolRail
      activeChartToolId={activeChartToolId}
      onPick={(tool) => {
        selectChartTool(tool);
        chart.current?.selectChartTool(tool);
      }}
    />
  );
}
