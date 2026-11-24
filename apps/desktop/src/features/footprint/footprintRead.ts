import type {
  BarFootprint as WireBarFootprint,
  ChartFootprintRow as WireChartFootprintRow,
} from '../../shared/bridge/types';
import type { BarFootprint, ChartFootprintRow } from '../chart/engine/barStyle/volumeFootprint/footprintData';

/** One wire price or volume as the number the cells are measured with; text no decimal reads counts as nothing. */
function readAmount(text: string): number {
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : 0;
}

/** One wire row as the renderer draws it: its two prices and the volume each side traded read into numbers. */
function readRow(row: WireChartFootprintRow): ChartFootprintRow {
  return {
    row: row.row,
    downPrice: readAmount(row.downPrice),
    upPrice: readAmount(row.upPrice),
    buyVolume: readAmount(row.buyVolume),
    sellVolume: readAmount(row.sellVolume),
    buyTrades: row.buyTrades,
    sellTrades: row.sellTrades,
    buyImbalance: row.buyImbalance,
    sellImbalance: row.sellImbalance,
  };
}

/**
 * One bar's footprint as the chart draws it. The host sends prices and volumes as the decimal strings trading-core
 * serializes, so this is the one place they are read into numbers: the renderer measures rows in numbers only, and
 * the trade counts, row numbers and summary levels reach it as they are.
 */
export function readBarFootprint(bar: WireBarFootprint): BarFootprint {
  return {
    openMs: bar.openMs,
    rows: bar.rows.map(readRow),
    buyVolume: readAmount(bar.buyVolume),
    sellVolume: readAmount(bar.sellVolume),
    buyTrades: bar.buyTrades,
    sellTrades: bar.sellTrades,
    poc: bar.poc,
    vah: bar.vah,
    val: bar.val,
    volume: bar.volume,
  };
}
