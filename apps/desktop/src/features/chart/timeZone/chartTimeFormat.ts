import { TickMarkType } from 'lightweight-charts';
import { EXCHANGE_TIME_ZONE, UTC_TIME_ZONE, formatUtcOffset, utcOffsetMinutes } from './chartTimeZones';

export interface ChartTimeFormat {
  pointerLabel(barSeconds: number): string;
  tickMarkLabel(barSeconds: number, tickMarkType: TickMarkType): string | null;
  clockLabel(nowMs: number): string | null;
}

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;

/** A wall clock reading at midnight: the one tick time at which a date is the truth about the bar. */
const WALL_MIDNIGHT = '00:00';

interface ZoneFormats {
  readonly pointerClock: Intl.DateTimeFormat;
  readonly dateParts: Intl.DateTimeFormat;
  readonly weekday: Intl.DateTimeFormat;
  readonly clock: Intl.DateTimeFormat;
  readonly clockWithSeconds: Intl.DateTimeFormat;
  readonly year: Intl.DateTimeFormat;
  readonly shortMonth: Intl.DateTimeFormat;
  readonly dayOfMonth: Intl.DateTimeFormat;
}

/** Every formatter the labels need, built once: the axis and the clock call these constantly. */
function createZoneFormats(timeZone: string): ZoneFormats {
  return {
    // The readout's own clock keeps the option set it has always used, so its text cannot drift from today's chart.
    pointerClock: new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }),
    dateParts: new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: '2-digit' }),
    weekday: new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' }),
    clock: new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    clockWithSeconds: new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }),
    year: new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric' }),
    shortMonth: new Intl.DateTimeFormat('en-GB', { timeZone, month: 'short' }),
    dayOfMonth: new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric' }),
  };
}

/** `Wed 30 Sep '26  08:03` — the pointer readout, with the reference's two spaces before the clock. */
function formatPointerLabel(formats: ZoneFormats, atMs: number): string {
  const at = new Date(atMs);
  const dateParts = formats.dateParts.formatToParts(at);
  const datePart = (type: 'day' | 'month' | 'year') => dateParts.find((part) => part.type === type)?.value ?? '';
  const day = datePart('day');
  const month = datePart('month');
  const year = datePart('year');
  return `${formats.weekday.format(at)} ${day} ${month} '${year}  ${formats.pointerClock.format(at)}`;
}

function tickDateLabel(formats: ZoneFormats, atMs: number, tickMarkType: TickMarkType): string {
  if (tickMarkType === TickMarkType.Year) {
    return formats.year.format(atMs);
  }
  if (tickMarkType === TickMarkType.Month) {
    return formats.shortMonth.format(atMs);
  }
  return formats.dayOfMonth.format(atMs);
}

/**
 * The axis text of a tick. A broker-day boundary is only a date in a zone whose wall clock
 * stands at midnight there; anywhere else the time of day is the honest label.
 */
function formatTickLabel(formats: ZoneFormats, atMs: number, tickMarkType: TickMarkType): string {
  if (tickMarkType === TickMarkType.TimeWithSeconds) {
    return formats.clockWithSeconds.format(atMs);
  }
  const wallClock = formats.clock.format(atMs);
  if (tickMarkType === TickMarkType.Time || wallClock !== WALL_MIDNIGHT) {
    return wallClock;
  }
  return tickDateLabel(formats, atMs, tickMarkType);
}

/** `15:40:06 UTC+3` — the broker's wall clock, the time a trader schedules against; null while unknown. */
function brokerClockLabel(formats: ZoneFormats, nowMs: number, brokerUtcOffsetMinutes: number | null): string | null {
  if (brokerUtcOffsetMinutes === null) {
    return null;
  }
  const brokerNowMs = nowMs + brokerUtcOffsetMinutes * MS_PER_MINUTE;
  return `${formats.clockWithSeconds.format(brokerNowMs)} ${formatUtcOffset(brokerUtcOffsetMinutes)}`;
}

/** `13:40:06 UTC+1` — the zone's wall clock and the offset in force at that instant. */
function zoneClockLabel(formats: ZoneFormats, zone: string, nowMs: number): string {
  return `${formats.clockWithSeconds.format(nowMs)} ${formatUtcOffset(utcOffsetMinutes(zone, nowMs))}`;
}

/**
 * Broker time: the bar seconds are already wall clock readings, so they are shown as they are,
 * and the axis keeps the library's own labels. The offset is only needed for the clock.
 */
function createBrokerTimeFormat(brokerUtcOffsetMinutes: number | null): ChartTimeFormat {
  const formats = createZoneFormats(UTC_TIME_ZONE);
  return {
    pointerLabel: (barSeconds) => formatPointerLabel(formats, barSeconds * MS_PER_SECOND),
    tickMarkLabel: () => null,
    clockLabel: (nowMs) => brokerClockLabel(formats, nowMs, brokerUtcOffsetMinutes),
  };
}

/** A chosen zone: the current broker offset turns every bar into a real instant, which the zone formats. */
function createZoneTimeFormat(zone: string, brokerUtcOffsetMinutes: number): ChartTimeFormat {
  const formats = createZoneFormats(zone);
  const brokerShiftMs = brokerUtcOffsetMinutes * MS_PER_MINUTE;
  const instantMs = (barSeconds: number) => barSeconds * MS_PER_SECOND - brokerShiftMs;
  return {
    pointerLabel: (barSeconds) => formatPointerLabel(formats, instantMs(barSeconds)),
    tickMarkLabel: (barSeconds, tickMarkType) => formatTickLabel(formats, instantMs(barSeconds), tickMarkType),
    clockLabel: (nowMs) => zoneClockLabel(formats, zone, nowMs),
  };
}

/** Labels for the chosen zone; without a broker offset the bars can only be read as broker time. */
export function createChartTimeFormat(zone: string, brokerUtcOffsetMinutes: number | null): ChartTimeFormat {
  if (zone === EXCHANGE_TIME_ZONE || brokerUtcOffsetMinutes === null) {
    return createBrokerTimeFormat(brokerUtcOffsetMinutes);
  }
  return createZoneTimeFormat(zone, brokerUtcOffsetMinutes);
}
