import type { BrokerSymbol } from '../../shared/bridge/types';

export const favoritesKey = 'better-charts.symbol-favorites.v1';
export const recentKey = 'better-charts.symbol-recent.v1';

export function loadSymbols(key: string) {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(value)) {
      return [];
    }
    const valid = value.filter(
      (item): item is BrokerSymbol =>
        item &&
        typeof item === 'object' &&
        typeof item.symbol === 'string' &&
        typeof item.description === 'string' &&
        typeof item.digits === 'number' &&
        typeof item.tickSize === 'string' &&
        typeof item.pointSize === 'string' &&
        typeof item.contractSize === 'string' &&
        typeof item.volumeMin === 'string' &&
        typeof item.volumeMax === 'string' &&
        typeof item.volumeStep === 'string' &&
        typeof item.stopsLevel === 'number' &&
        typeof item.freezeLevel === 'number' &&
        typeof item.fillingMode === 'number' &&
        typeof item.orderMode === 'number' &&
        typeof item.expirationMode === 'number' &&
        typeof item.tradeExecution === 'number' &&
        typeof item.tradeMode === 'number',
    );
    return valid
      .filter((item, index, all) => all.findIndex((candidate) => candidate.symbol === item.symbol) === index)
      .slice(0, 10);
  } catch {
    return [];
  }
}
export function saveSymbols(key: string, symbols: BrokerSymbol[]) {
  try {
    localStorage.setItem(key, JSON.stringify(symbols.slice(0, 10)));
  } catch {
    /* storage is optional */
  }
}
