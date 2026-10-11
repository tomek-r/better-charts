import zlib from 'node:zlib';

/** Decoded 8-bit PNG: `rgb` holds 3 bytes per pixel (alpha, if present, is dropped). */
export interface DecodedPng {
  width: number;
  height: number;
  rgb: Uint8Array;
}

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

/** Parses `#rrggbb` into its channels. */
export function parseHexColor(hex: string): [number, number, number] {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)) as [number, number, number];
}
