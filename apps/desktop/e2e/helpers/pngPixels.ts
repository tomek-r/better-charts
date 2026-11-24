import zlib from 'node:zlib';

/** Decoded 8-bit PNG: `rgb` holds 3 bytes per pixel (alpha, if present, is dropped). */
export interface DecodedPng {
  width: number;
  height: number;
  rgb: Uint8Array;
}

/** One pixel of a screenshot, by its column and row. */
export interface PixelSite {
  readonly x: number;
  readonly y: number;
}

/** The part of a screenshot a test reads: columns from `left` up to `right`, rows `top` to `bottom` included. */
export interface PixelRegion {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** One colour as a screenshot decodes it: three channels, the alpha aside. */
export type PixelChannels = readonly [number, number, number];

/** How far a channel of a screenshot pixel may stray from a colour and still be that colour, where an edge blends. */
const COLOR_TOLERANCE = 8;

/**
 * How far a channel of a screenshot pixel may stray from the straight blend it sits on and still count as a blend
 * toward a colour: a little wider than `COLOR_TOLERANCE`, since what lies under the blend may differ from the
 * background by a few levels.
 */
const TINT_TOLERANCE = 12;

/** Paeth predictor from the PNG specification (filter type 4). */
function paethPredictor(left: number, above: number, aboveLeft: number): number {
  const estimate = left + above - aboveLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceAbove = Math.abs(estimate - above);
  const distanceAboveLeft = Math.abs(estimate - aboveLeft);
  if (distanceLeft <= distanceAbove && distanceLeft <= distanceAboveLeft) {
    return left;
  }
  return distanceAbove <= distanceAboveLeft ? above : aboveLeft;
}

/** Decodes the 8-bit RGB / RGBA PNGs Playwright screenshots produce, without a dependency. */
export function decodePng(file: Buffer): DecodedPng {
  let width = 0;
  let height = 0;
  let channels = 0;
  const compressed: Buffer[] = [];
  for (let position = 8; position < file.length;) {
    const length = file.readUInt32BE(position);
    const type = file.toString('ascii', position + 4, position + 8);
    const body = file.subarray(position + 8, position + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const bitDepth = body[8];
      const colorType = body[9];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`Unsupported PNG: bit depth ${bitDepth}, color type ${colorType}`);
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      compressed.push(body);
    }
    position += 12 + length;
  }
  const filtered = zlib.inflateSync(Buffer.concat(compressed));
  const stride = width * channels;
  const samples = new Uint8Array(stride * height);
  for (let row = 0; row < height; row++) {
    const filter = filtered[row * (stride + 1)];
    for (let column = 0; column < stride; column++) {
      const left = column >= channels ? samples[row * stride + column - channels] : 0;
      const above = row > 0 ? samples[(row - 1) * stride + column] : 0;
      const aboveLeft = column >= channels && row > 0 ? samples[(row - 1) * stride + column - channels] : 0;
      const raw = filtered[row * (stride + 1) + 1 + column];
      const predictor = [0, left, above, (left + above) >> 1, paethPredictor(left, above, aboveLeft)][filter];
      samples[row * stride + column] = (raw + predictor) & 255;
    }
  }
  const rgb = new Uint8Array(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel++) {
    for (let channel = 0; channel < 3; channel++) {
      rgb[pixel * 3 + channel] = samples[pixel * channels + channel];
    }
  }
  return { width, height, rgb };
}

export function pixelAt(image: DecodedPng, x: number, y: number): [number, number, number] {
  const offset = (y * image.width + x) * 3;
  return [image.rgb[offset], image.rgb[offset + 1], image.rgb[offset + 2]];
}

/** Whether a screenshot pixel paints `color`, within the blend an edge may stray by. */
function pixelIsColor(pixel: PixelChannels, color: PixelChannels): boolean {
  return pixel.every((channel, index) => Math.abs(channel - color[index]) <= COLOR_TOLERANCE);
}

/** Whether the screenshot pixel at `site` paints `color`. */
function sitePaints(image: DecodedPng, site: PixelSite, color: PixelChannels): boolean {
  return pixelIsColor(pixelAt(image, site.x, site.y), color);
}

/** Every pixel of `region` that `matches` accepts, in screenshot order. */
function sitesWhere(image: DecodedPng, region: PixelRegion, matches: (pixel: PixelChannels) => boolean): PixelSite[] {
  const sites: PixelSite[] = [];
  for (let y = region.top; y <= region.bottom; y += 1) {
    for (let x = region.left; x < region.right; x += 1) {
      if (matches(pixelAt(image, x, y))) {
        sites.push({ x, y });
      }
    }
  }
  return sites;
}

/** Every pixel of `region` that paints `color`, in screenshot order. */
export function sitesPainting(image: DecodedPng, color: PixelChannels, region: PixelRegion): PixelSite[] {
  return sitesWhere(image, region, (pixel) => pixelIsColor(pixel, color));
}

/**
 * The share of the blend from `background` toward `color` a pixel sits at, read from the channel the colour departs
 * from the background most in, which carries the share most reliably.
 */
function blendShare(pixel: PixelChannels, color: PixelChannels, background: PixelChannels): number {
  let dominant = 0;
  for (let channel = 1; channel < 3; channel += 1) {
    if (Math.abs(color[channel] - background[channel]) > Math.abs(color[dominant] - background[dominant])) {
      dominant = channel;
    }
  }
  const span = color[dominant] - background[dominant];
  return span === 0 ? 1 : (pixel[dominant] - background[dominant]) / span;
}

/** Whether `pixel` lies on the blend from `background` toward `color`, at least `minShare` of the way. */
function pixelIsTintedToward(
  pixel: PixelChannels,
  color: PixelChannels,
  background: PixelChannels,
  minShare: number,
): boolean {
  const share = blendShare(pixel, color, background);
  if (share < minShare || share > 1) {
    return false;
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const blended = background[channel] + share * (color[channel] - background[channel]);
    if (Math.abs(pixel[channel] - blended) > TINT_TOLERANCE) {
      return false;
    }
  }
  return true;
}

/**
 * Every pixel of `region` that lies on the straight blend from `background` toward `color`, in screenshot order: a
 * pixel whose channels are each within a tolerance of `background + share × (color − background)` for one `share` in
 * [`minShare`, 1]. A glyph drawn in `color` over `background` keeps that blend's direction but only its cores reach
 * the colour at all, so this finds the anti-aliased text an exact colour match misses.
 */
export function sitesTintedToward(
  image: DecodedPng,
  color: PixelChannels,
  background: PixelChannels,
  region: PixelRegion,
  minShare = 0.6,
): PixelSite[] {
  return sitesWhere(image, region, (pixel) => pixelIsTintedToward(pixel, color, background, minShare));
}

/**
 * The left site of every horizontal run of at least `minLength` consecutive pixels of `region` that paint `color`,
 * in screenshot order. A solid block paints such a run; a line's anti-aliased edge matches only a pixel or two.
 */
export function horizontalRunsPainting(
  image: DecodedPng,
  color: PixelChannels,
  region: PixelRegion,
  minLength: number,
): PixelSite[] {
  const sites: PixelSite[] = [];
  for (let y = region.top; y <= region.bottom; y += 1) {
    let runStart = region.left;
    for (let x = region.left; x <= region.right; x += 1) {
      if (x === region.right || !sitePaints(image, { x, y }, color)) {
        if (x - runStart >= minLength) {
          sites.push({ x: runStart, y });
        }
        runStart = x + 1;
      }
    }
  }
  return sites;
}

/** Parses `#rrggbb` into its channels. */
export function parseHexColor(hex: string): [number, number, number] {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)) as [number, number, number];
}
