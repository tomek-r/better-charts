import { DrawingToolRail } from './DrawingToolRail';
import { useChartResources } from '../chart/ChartWorkspaceProvider';
import { useChartDrawing } from './DrawingContextProvider';

export function DrawingToolsView() {
  const { drawingTool, setDrawingTool } = useChartDrawing();
  const { chart } = useChartResources();

  return (
    <DrawingToolRail
      drawingTool={drawingTool}
      onPick={(tool) => {
        setDrawingTool(tool);
        chart.current?.setDrawingTool(tool);
      }}
    />
  );
}
