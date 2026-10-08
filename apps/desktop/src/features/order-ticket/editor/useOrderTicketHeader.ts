import { useShallow } from 'zustand/react/shallow';
import { useBridgeAccountSelector, useBridgeMarketSelector } from '../../bridge/BridgeSessionProvider';
import { accountEnvironment } from '../domain/ticketFormatting';

type HeaderEnvironment = ReturnType<typeof accountEnvironment>;
type HeaderState = { environment: HeaderEnvironment | undefined; symbol: string | undefined };

export function useOrderTicketHeader(): HeaderState {
  const { symbol } = useBridgeMarketSelector((market) => ({ symbol: market.snapshot.symbol }));
  const accountPresent = useBridgeAccountSelector((account) => account !== undefined);
  const { tradeModeName, tradeMode, accountLogin, brokerServer } = useBridgeAccountSelector(
    useShallow((account) => ({
      tradeModeName: account?.accountTradeModeName,
      tradeMode: account?.accountTradeMode,
      accountLogin: account?.accountLogin,
      brokerServer: account?.brokerServer,
    })),
  );
  const environment = accountPresent
    ? accountEnvironment({
        accountLogin,
        brokerServer,
        accountTradeModeName: tradeModeName,
        accountTradeMode: tradeMode,
      })
    : undefined;
  return { environment, symbol };
}
