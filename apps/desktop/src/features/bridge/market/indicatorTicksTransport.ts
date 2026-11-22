import type { IndicatorTicksPage } from '../../../shared/bridge/types';
import type {
  IndicatorTicksAnswer,
  IndicatorTicksQuery,
  IndicatorTickSource,
} from '../../chart/engine/indicators/indicatorTickSource';
import { createKeyedReadSource, type KeyedReadRoute } from './keyedReadRoute';

const UNAVAILABLE: IndicatorTicksAnswer = { kind: 'unavailable' };

/** The bridge's raw-tick route: a half-open range of the chart symbol, one page of ticks at a time. */
const TICKS_ROUTE: KeyedReadRoute<IndicatorTicksQuery, IndicatorTicksPage, IndicatorTicksAnswer> = {
  command: 'request_indicator_ticks',
  pageEvent: 'indicator-ticks',
  refusalEvent: 'indicator-ticks-unavailable',
  wireArgs: (query, symbol) => ({
    key: query.key,
    symbol,
    fromMs: query.fromMs,
    toMs: query.toMs,
    maxTicks: query.maxTicks,
  }),
  answerOf: (page) => ({
    kind: 'page',
    fromMs: page.fromMs,
    toMs: page.toMs,
    complete: page.complete,
    ticks: page.ticks,
  }),
  refusal: UNAVAILABLE,
};

/**
 * The bridge's read-only raw-tick route as an indicator gets it. A refused request is an unread range, which an
 * indicator keeps its last values for rather than asking again.
 */
export function createIndicatorTickSource(chartSymbol: () => string | undefined): IndicatorTickSource {
  return createKeyedReadSource(TICKS_ROUTE, chartSymbol);
}
