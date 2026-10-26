import { useEffect, useState } from 'react';
import { useBridgeChartState, useBridgePortfolio } from '../bridge/BridgeSessionProvider';
import { useExecutionPortfolio } from '../execution/ExecutionProvider';
import { PartialCloseMenu } from '../partial-close/PartialCloseMenu';
import { PartialCloseVolumePopover } from '../partial-close/PartialCloseVolumePopover';
import { partialCloseLimits, partialCloseTitle } from '../partial-close/partialCloseVolume';
import { usePartialCloseAvailable } from '../partial-close/usePartialCloseAvailable';
import { ChartAnchoredPanel } from './ChartAnchoredPanel';
import { useChartResources } from './ChartWorkspaceProvider';
import type { PartialCloseMenuRequest } from './engine/trading/partialCloseChipPort';

type PartialCloseStage = PartialCloseMenuRequest & { view: 'menu' | 'custom-volume' };

/** DOM side of the painted ▾ chip: the preset menu and the custom-volume form, over the chart. */
export function ChartPartialClose() {
  const { partialCloseChipPortRef } = useChartResources();
  const { symbol } = useBridgeChartState();
  const portfolio = useBridgePortfolio();
  const available = usePartialCloseAvailable();
  const { requestClosePosition } = useExecutionPortfolio();
  const [stage, setStage] = useState<PartialCloseStage>();

  const position = stage && portfolio?.positions.find((item) => (item.positionId || item.ticket) === stage.positionId);
  const limits = position && position.symbol === symbol ? partialCloseLimits(position, available) : undefined;
  const active = stage && position && limits ? stage : undefined;
  const customVolumePositionId = active?.view === 'custom-volume' ? active.positionId : undefined;

  useEffect(() => {
    partialCloseChipPortRef.current = {
      // A form already open keeps its place: the ▾ must not silently swap it for the menu.
      openMenu: (request) =>
        setStage((current) => (current?.view === 'custom-volume' ? current : { ...request, view: 'menu' })),
      isFullCloseBlocked: (positionId) => positionId === customVolumePositionId,
      dismiss: () => setStage(undefined),
    };
    return () => {
      partialCloseChipPortRef.current = undefined;
    };
  }, [partialCloseChipPortRef, customVolumePositionId]);

  if (!active || !position || !limits) {
    return null;
  }
  const close = (volume: string | null) => {
    setStage(undefined);
    void requestClosePosition('portfolio', active.positionId, undefined, volume);
  };
  return (
    <ChartAnchoredPanel x={active.x} y={active.y} onDismiss={() => setStage(undefined)}>
      {active.view === 'menu' ? (
        <PartialCloseMenu
          limits={limits}
          onClosePart={close}
          onCustomVolume={() => setStage({ ...active, view: 'custom-volume' })}
        />
      ) : (
        <PartialCloseVolumePopover
          title={partialCloseTitle(position)}
          limits={limits}
          onConfirm={close}
          onDismiss={() => setStage(undefined)}
        />
      )}
    </ChartAnchoredPanel>
  );
}
