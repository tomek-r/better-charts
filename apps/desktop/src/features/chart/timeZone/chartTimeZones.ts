export const EXCHANGE_TIME_ZONE = 'exchange';
export const UTC_TIME_ZONE = 'UTC';

export interface ChartTimeZoneOption {
  readonly zone: string;
  readonly label: string;
}

interface TimeZoneCity {
  readonly name: string;
  readonly zone: string;
}

const MINUTES_PER_HOUR = 60;

/** The cities the menu offers; the menu orders them by the offset in force at the chosen instant. */
const CITIES: readonly TimeZoneCity[] = [
  { name: 'Honolulu', zone: 'Pacific/Honolulu' },
  { name: 'Anchorage', zone: 'America/Anchorage' },
  { name: 'Juneau', zone: 'America/Juneau' },
  { name: 'Los Angeles', zone: 'America/Los_Angeles' },
  { name: 'Phoenix', zone: 'America/Phoenix' },
  { name: 'Vancouver', zone: 'America/Vancouver' },
  { name: 'Denver', zone: 'America/Denver' },
  { name: 'Mexico City', zone: 'America/Mexico_City' },
  { name: 'San Salvador', zone: 'America/El_Salvador' },
  { name: 'Bogota', zone: 'America/Bogota' },
  { name: 'Chicago', zone: 'America/Chicago' },
  { name: 'Lima', zone: 'America/Lima' },
  { name: 'Caracas', zone: 'America/Caracas' },
  { name: 'New York', zone: 'America/New_York' },
  { name: 'Toronto', zone: 'America/Toronto' },
  { name: 'Buenos Aires', zone: 'America/Argentina/Buenos_Aires' },
  { name: 'Halifax', zone: 'America/Halifax' },
  { name: 'Santiago', zone: 'America/Santiago' },
  { name: 'Sao Paulo', zone: 'America/Sao_Paulo' },
  { name: 'Azores', zone: 'Atlantic/Azores' },
  { name: 'Dublin', zone: 'Europe/Dublin' },
  { name: 'Lisbon', zone: 'Europe/Lisbon' },
  { name: 'London', zone: 'Europe/London' },
  { name: 'Reykjavik', zone: 'Atlantic/Reykjavik' },
  { name: 'Amsterdam', zone: 'Europe/Amsterdam' },
  { name: 'Belgrade', zone: 'Europe/Belgrade' },
  { name: 'Berlin', zone: 'Europe/Berlin' },
  { name: 'Bratislava', zone: 'Europe/Bratislava' },
  { name: 'Brussels', zone: 'Europe/Brussels' },
  { name: 'Budapest', zone: 'Europe/Budapest' },
  { name: 'Casablanca', zone: 'Africa/Casablanca' },
  { name: 'Copenhagen', zone: 'Europe/Copenhagen' },
  { name: 'Lagos', zone: 'Africa/Lagos' },
  { name: 'Ljubljana', zone: 'Europe/Ljubljana' },
  { name: 'Luxembourg', zone: 'Europe/Luxembourg' },
  { name: 'Madrid', zone: 'Europe/Madrid' },
  { name: 'Malta', zone: 'Europe/Malta' },
  { name: 'Oslo', zone: 'Europe/Oslo' },
  { name: 'Paris', zone: 'Europe/Paris' },
  { name: 'Prague', zone: 'Europe/Prague' },
  { name: 'Rome', zone: 'Europe/Rome' },
  { name: 'Stockholm', zone: 'Europe/Stockholm' },
  { name: 'Vienna', zone: 'Europe/Vienna' },
  { name: 'Warsaw', zone: 'Europe/Warsaw' },
  { name: 'Zurich', zone: 'Europe/Zurich' },
  { name: 'Athens', zone: 'Europe/Athens' },
  { name: 'Bucharest', zone: 'Europe/Bucharest' },
  { name: 'Cairo', zone: 'Africa/Cairo' },
  { name: 'Helsinki', zone: 'Europe/Helsinki' },
  { name: 'Jerusalem', zone: 'Asia/Jerusalem' },
  { name: 'Johannesburg', zone: 'Africa/Johannesburg' },
  { name: 'Kyiv', zone: 'Europe/Kyiv' },
  { name: 'Riga', zone: 'Europe/Riga' },
  { name: 'Tallinn', zone: 'Europe/Tallinn' },
  { name: 'Vilnius', zone: 'Europe/Vilnius' },
  { name: 'Istanbul', zone: 'Europe/Istanbul' },
  { name: 'Moscow', zone: 'Europe/Moscow' },
  { name: 'Nairobi', zone: 'Africa/Nairobi' },
  { name: 'Riyadh', zone: 'Asia/Riyadh' },
  { name: 'Bahrain', zone: 'Asia/Bahrain' },
  { name: 'Kuwait', zone: 'Asia/Kuwait' },
  { name: 'Qatar', zone: 'Asia/Qatar' },
  { name: 'Dubai', zone: 'Asia/Dubai' },
  { name: 'Muscat', zone: 'Asia/Muscat' },
  { name: 'Tehran', zone: 'Asia/Tehran' },
  { name: 'Karachi', zone: 'Asia/Karachi' },
  { name: 'Kolkata', zone: 'Asia/Kolkata' },
  { name: 'Kathmandu', zone: 'Asia/Kathmandu' },
  { name: 'Dhaka', zone: 'Asia/Dhaka' },
  { name: 'Yangon', zone: 'Asia/Yangon' },
  { name: 'Bangkok', zone: 'Asia/Bangkok' },
  { name: 'Ho Chi Minh', zone: 'Asia/Ho_Chi_Minh' },
  { name: 'Jakarta', zone: 'Asia/Jakarta' },
  { name: 'Shanghai', zone: 'Asia/Shanghai' },
  { name: 'Hong Kong', zone: 'Asia/Hong_Kong' },
  { name: 'Singapore', zone: 'Asia/Singapore' },
  { name: 'Taipei', zone: 'Asia/Taipei' },
  { name: 'Perth', zone: 'Australia/Perth' },
  { name: 'Manila', zone: 'Asia/Manila' },
  { name: 'Seoul', zone: 'Asia/Seoul' },
  { name: 'Tokyo', zone: 'Asia/Tokyo' },
  { name: 'Adelaide', zone: 'Australia/Adelaide' },
  { name: 'Brisbane', zone: 'Australia/Brisbane' },
  { name: 'Sydney', zone: 'Australia/Sydney' },
  { name: 'Norfolk Island', zone: 'Pacific/Norfolk' },
  { name: 'Auckland', zone: 'Pacific/Auckland' },
  { name: 'Chatham Islands', zone: 'Pacific/Chatham' },
];

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** One formatter per zone, kept for the life of the process: the clock asks for an offset every second. */
function offsetFormatterFor(zone: string): Intl.DateTimeFormat {
  const cached = offsetFormatters.get(zone);
  if (cached !== undefined) {
    return cached;
  }
  const created = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
  offsetFormatters.set(zone, created);
  return created;
}

/** `longOffset` writes a bare `GMT`, or `GMT+05:30` and `GMT-03:00` when the zone is offset. */
const GMT_OFFSET_PATTERN = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/;

function parseGmtOffset(offsetText: string): number {
  const match = GMT_OFFSET_PATTERN.exec(offsetText);
  if (match === null) {
    throw new Error(`Unreadable UTC offset: ${offsetText}`);
  }
  const sign = match[1];
  if (sign === undefined) {
    return 0;
  }
  const magnitude = Number(match[2] ?? 0) * MINUTES_PER_HOUR + Number(match[3] ?? 0);
  return sign === '-' ? -magnitude : magnitude;
}

/** The zone's UTC offset in minutes at that instant, daylight saving included. */
export function utcOffsetMinutes(zone: string, atMs: number): number {
  const namePart = offsetFormatterFor(zone)
    .formatToParts(new Date(atMs))
    .find((part) => part.type === 'timeZoneName');
  if (namePart === undefined) {
    throw new Error(`No UTC offset reported for ${zone}`);
  }
  return parseGmtOffset(namePart.value);
}

/** `UTC`, `UTC+1`, `UTC-3`, `UTC+5:30` — the offset the way the menu writes it. */
export function formatUtcOffset(minutes: number): string {
  if (minutes === 0) {
    return UTC_TIME_ZONE;
  }
  const sign = minutes < 0 ? '-' : '+';
  const magnitude = Math.abs(minutes);
  const hours = Math.floor(magnitude / MINUTES_PER_HOUR);
  const remainingMinutes = magnitude % MINUTES_PER_HOUR;
  if (remainingMinutes === 0) {
    return `UTC${sign}${hours}`;
  }
  return `UTC${sign}${hours}:${String(remainingMinutes).padStart(2, '0')}`;
}

interface CityOffset {
  readonly city: TimeZoneCity;
  readonly offsetMinutes: number;
}

function cityOffset(city: TimeZoneCity, atMs: number): CityOffset {
  return { city, offsetMinutes: utcOffsetMinutes(city.zone, atMs) };
}

function byOffsetThenName(left: CityOffset, right: CityOffset): number {
  return left.offsetMinutes - right.offsetMinutes || left.city.name.localeCompare(right.city.name);
}

function cityOption({ city, offsetMinutes }: CityOffset): ChartTimeZoneOption {
  return { zone: city.zone, label: `(${formatUtcOffset(offsetMinutes)}) ${city.name}` };
}

/** The menu: UTC, then the exchange, then every city under the offset it is running at that instant. */
export function chartTimeZoneOptions(atMs: number): ChartTimeZoneOption[] {
  const cityOptions = CITIES.map((city) => cityOffset(city, atMs))
    .sort(byOffsetThenName)
    .map(cityOption);
  return [
    { zone: UTC_TIME_ZONE, label: UTC_TIME_ZONE },
    { zone: EXCHANGE_TIME_ZONE, label: 'Exchange' },
    ...cityOptions,
  ];
}

const knownZones: ReadonlySet<string> = new Set([
  EXCHANGE_TIME_ZONE,
  UTC_TIME_ZONE,
  ...CITIES.map((city) => city.zone),
]);

/** A stored zone id this build no longer offers is ignored instead of being formatted as garbage. */
export function isKnownChartTimeZone(zone: string): boolean {
  return knownZones.has(zone);
}
