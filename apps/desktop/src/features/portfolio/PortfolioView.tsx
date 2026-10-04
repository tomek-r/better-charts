import { PortfolioCard } from './PortfolioCard';
import { useBridgeActions, useBridgeAccount, useBridgePortfolio } from '../bridge/BridgeSessionProvider';
import { useExecutionPortfolio } from '../execution/ExecutionProvider';

export function PortfolioView() {
  const account = useBridgeAccount();
  const portfolio = useBridgePortfolio();
  const { chooseSymbolByName } = useBridgeActions();
  const { closingTarget, closeCancelStatus, requestClosePosition } = useExecutionPortfolio();
  if (!portfolio) {
    return null;
  }
  return (
    <PortfolioCard
      portfolio={portfolio}
      account={account}
      onOpenSymbol={chooseSymbolByName}
      closingTarget={closingTarget}
      requestClosePosition={requestClosePosition}
      closeCancelStatus={closeCancelStatus}
    />
  );
}
