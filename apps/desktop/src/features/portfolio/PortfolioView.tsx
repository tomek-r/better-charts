import { PortfolioCard } from './PortfolioCard';
import { useBridgeActions } from '../bridge/BridgeSessionProvider';
import { useBridgeAccount, useBridgePortfolio } from '../bridge/bridgeSelectors';
import { usePartialCloseAvailable } from '../partial-close/usePartialCloseAvailable';
import { useExecutionPortfolio } from '../execution/ExecutionProvider';

export function PortfolioView() {
  const account = useBridgeAccount();
  const portfolio = useBridgePortfolio();
  const partialCloseAvailable = usePartialCloseAvailable();
  const { chooseSymbolByName } = useBridgeActions();
  const { closingTarget, requestClosePosition } = useExecutionPortfolio();
  if (!portfolio) {
    return null;
  }
  return (
    <PortfolioCard
      portfolio={portfolio}
      account={account}
      onOpenSymbol={chooseSymbolByName}
      partialCloseAvailable={partialCloseAvailable}
      closingTarget={closingTarget}
      requestClosePosition={requestClosePosition}
    />
  );
}
