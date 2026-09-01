import { createRequire } from 'module';
import * as zlib from 'zlib';

/**
 * Screenshot payloads are the single most expensive thing this server returns:
 * a 1080x2400 PNG is ~1.5 MB, which is ~2 MB once base64-encoded. Shrinking it
 * before it crosses the wire costs a few milliseconds and saves the caller a
 * fortune in tokens.
 *
 * Two engines, picked automatically:
 *  - `sharp`, when the optional native dependency is installed — JPEG/WebP,
 *    the smallest output by a wide margin;
 *  - a built-in PNG resizer using nothing but Node's zlib, so compression
 *    still happens on a bare `npm install`.
 */

export type ImageFormat = 'auto' | 'jpeg' | 'webp' | 'png' | 'none';

export interface CompressOptions {
  /** Longest edge of the output width, in pixels. 0 disables resizing. */
  maxWidth?: number;
  /** Lossy quality, 1..100. Ignored by the PNG engine. */
  quality?: number;
  /** Output format. `auto` picks JPEG when sharp is available, PNG otherwise. */
  format?: ImageFormat;
}

export interface CompressedImage {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
  bytes: number;
  originalWidth: number;
  originalHeight: number;
  originalBytes: number;
  /** Which path produced the buffer. `none` means the original came back as-is. */
  engine: 'sharp' | 'png' | 'none';
  /** Why compression was skipped or downgraded, when it was. */
  note?: string;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const DEFAULT_MAX_WIDTH = 720;
const DEFAULT_QUALITY = 60;

function envNumber(key: string, fallback: number): number {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Compression defaults, before any per-call override. */
export function compressionDefaults(): Required<CompressOptions> {
  const raw = (process.env.ADB_SCREENSHOT_FORMAT || 'auto').toLowerCase();
  const format = (['auto', 'jpeg', 'webp', 'png', 'none'] as const).includes(raw as ImageFormat)
    ? (raw as ImageFormat)
    : 'auto';

  return {
    maxWidth: envNumber('ADB_SCREENSHOT_MAX_WIDTH', DEFAULT_MAX_WIDTH),
    quality: clamp(envNumber('ADB_SCREENSHOT_QUALITY', DEFAULT_QUALITY), 1, 100),
    format,
  };
}

// ─── sharp, when it happens to be installed ───────────────────────────────────

let sharpModule: any;

function loadSharp(): any | null {
  if (sharpModule !== undefined) return sharpModule;

  try {
    sharpModule = createRequire(__filename)('sharp');
  } catch {
    sharpModule = null;
  }

  return sharpModule;
}

/** Whether the optional native encoder is available. */
export function hasSharp(): boolean {
  return loadSharp() !== null;
}

// ─── PNG plumbing ─────────────────────────────────────────────────────────────

export function isPng(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
}

/** Read the dimensions straight out of IHDR, without decoding pixels. */
export function pngSize(buffer: Buffer): { width: number; height: number } | null {
  if (!isPng(buffer) || buffer.length < 24) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export interface RgbaImage {
  width: number;
  height: number;
  /** Interleaved RGBA, 8 bits per channel. */
  data: Buffer;
  hasAlpha: boolean;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);

  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

const CHANNELS_BY_COLOR_TYPE: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Decode an 8-bit, non-interlaced PNG into interleaved RGBA. */
export function decodePng(buffer: Buffer): RgbaImage {
  if (!isPng(buffer)) {
    throw new Error('not a PNG image');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let paletteAlpha: Buffer | null = null;
  const chunks: Buffer[] = [];

  let offset = 8;

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;

    if (end > buffer.length) break;

    if (type === 'IHDR') {
      width = buffer.readUInt32BE(start);
      height = buffer.readUInt32BE(start + 4);
      bitDepth = buffer[start + 8];
      colorType = buffer[start + 9];
      interlace = buffer[start + 12];
    } else if (type === 'PLTE') {
      palette = buffer.subarray(start, end);
    } else if (type === 'tRNS') {
      paletteAlpha = buffer.subarray(start, end);
    } else if (type === 'IDAT') {
      chunks.push(buffer.subarray(start, end));
    } else if (type === 'IEND') {
      break;
    }

    offset = end + 4;
  }

  if (!width || !height) throw new Error('PNG has no IHDR');
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('interlaced PNGs are not supported');
  if (chunks.length === 0) throw new Error('PNG has no image data');

  const channels = CHANNELS_BY_COLOR_TYPE[colorType];
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`);
  if (colorType === 3 && !palette) throw new Error('indexed PNG without a palette');

  const stride = width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(chunks));

  if (inflated.length < (stride + 1) * height) {
    throw new Error('PNG image data is truncated');
  }

  // Undo the per-scanline filters in place, row by row.
  const raw = Buffer.allocUnsafe(stride * height);
  let read = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[read];
    read += 1;

    const rowStart = y * stride;
    const previousStart = rowStart - stride;

    for (let x = 0; x < stride; x += 1) {
      const value = inflated[read + x];
      const left = x >= channels ? raw[rowStart + x - channels] : 0;
      const up = y > 0 ? raw[previousStart + x] : 0;
      const upLeft = x >= channels && y > 0 ? raw[previousStart + x - channels] : 0;

      let restored: number;

      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + ((left + up) >> 1);
          break;
        case 4:
          restored = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`unsupported PNG filter type ${filter}`);
      }

      raw[rowStart + x] = restored & 0xff;
    }

    read += stride;
  }

  const pixels = width * height;
  const data = Buffer.allocUnsafe(pixels * 4);
  let hasAlpha = false;

  for (let index = 0; index < pixels; index += 1) {
    const target = index * 4;
    let r: number;
    let g: number;
    let b: number;
    let a = 255;

    switch (colorType) {
      case 0:
        r = g = b = raw[index];
        break;
      case 2: {
        const source = index * 3;
        r = raw[source];
        g = raw[source + 1];
        b = raw[source + 2];
        break;
      }
      case 3: {
        const entry = raw[index] * 3;
        r = palette![entry];
        g = palette![entry + 1];
        b = palette![entry + 2];
        a = paletteAlpha?.[raw[index]] ?? 255;
        break;
      }
      case 4: {
        const source = index * 2;
        r = g = b = raw[source];
        a = raw[source + 1];
        break;
      }
      default: {
        const source = index * 4;
        r = raw[source];
        g = raw[source + 1];
        b = raw[source + 2];
        a = raw[source + 3];
      }
    }

    if (a !== 255) hasAlpha = true;

    data[target] = r;
    data[target + 1] = g;
    data[target + 2] = b;
    data[target + 3] = a;
  }

  return { width, height, data, hasAlpha };
}

/** Box-average downscale. Averaging beats nearest-neighbour on UI text. */
function resizeRgba(source: RgbaImage, width: number, height: number): RgbaImage {
  if (width === source.width && height === source.height) return source;

  const data = Buffer.allocUnsafe(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const sourceTop = Math.floor((y * source.height) / height);
    const sourceBottom = Math.max(sourceTop + 1, Math.floor(((y + 1) * source.height) / height));

    for (let x = 0; x < width; x += 1) {
      const sourceLeft = Math.floor((x * source.width) / width);
      const sourceRight = Math.max(sourceLeft + 1, Math.floor(((x + 1) * source.width) / width));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;

      for (let sy = sourceTop; sy < sourceBottom; sy += 1) {
        let cursor = (sy * source.width + sourceLeft) * 4;

        for (let sx = sourceLeft; sx < sourceRight; sx += 1) {
          r += source.data[cursor];
          g += source.data[cursor + 1];
          b += source.data[cursor + 2];
          a += source.data[cursor + 3];
          cursor += 4;
          count += 1;
        }
      }

      const target = (y * width + x) * 4;
      data[target] = Math.round(r / count);
      data[target + 1] = Math.round(g / count);
      data[target + 2] = Math.round(b / count);
      data[target + 3] = Math.round(a / count);
    }
  }

  return { width, height, data, hasAlpha: source.hasAlpha };
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);

  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }

  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = -1;

  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ -1) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.allocUnsafe(data.length + 12);

  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 'ascii');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);

  return chunk;
}

/** Score a filtered row the way libpng does: smallest sum of signed magnitudes. */
function filterCost(row: Buffer): number {
  let total = 0;

  for (let index = 0; index < row.length; index += 1) {
    const value = row[index];
    total += value < 128 ? value : 256 - value;
  }

  return total;
}

/** Encode RGBA pixels as a PNG, dropping the alpha channel when it is unused. */
export function encodePng(image: RgbaImage): Buffer {
  const channels = image.hasAlpha ? 4 : 3;
  const stride = image.width * channels;
  const colorType = image.hasAlpha ? 6 : 2;

  const filtered = Buffer.allocUnsafe((stride + 1) * image.height);
  const line = Buffer.allocUnsafe(stride);
  let previous = Buffer.alloc(stride);
  const candidates = [0, 1, 2, 3, 4].map(() => Buffer.allocUnsafe(stride));

  for (let y = 0; y < image.height; y += 1) {
    // Drop the alpha channel when the image is fully opaque — 25% fewer bytes.
    for (let x = 0; x < image.width; x += 1) {
      const source = (y * image.width + x) * 4;
      const target = x * channels;
      line[target] = image.data[source];
      line[target + 1] = image.data[source + 1];
      line[target + 2] = image.data[source + 2];
      if (channels === 4) line[target + 3] = image.data[source + 3];
    }

    for (let x = 0; x < stride; x += 1) {
      const value = line[x];
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;

      candidates[0][x] = value;
      candidates[1][x] = (value - left) & 0xff;
      candidates[2][x] = (value - up) & 0xff;
      candidates[3][x] = (value - ((left + up) >> 1)) & 0xff;
      candidates[4][x] = (value - paeth(left, up, upLeft)) & 0xff;
    }

    let best = 0;
    let bestCost = filterCost(candidates[0]);

    for (let type = 1; type < candidates.length; type += 1) {
      const cost = filterCost(candidates[type]);
      if (cost < bestCost) {
        bestCost = cost;
        best = type;
      }
    }

    const rowStart = y * (stride + 1);
    filtered[rowStart] = best;
    candidates[best].copy(filtered, rowStart + 1);

    previous = Buffer.from(line);
  }

  const header = Buffer.allocUnsafe(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = colorType;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(filtered, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── public entry point ───────────────────────────────────────────────────────

const MIME_TYPES: Record<string, { mimeType: string; extension: string }> = {
  jpeg: { mimeType: 'image/jpeg', extension: 'jpg' },
  webp: { mimeType: 'image/webp', extension: 'webp' },
  png: { mimeType: 'image/png', extension: 'png' },
};

/**
 * Shrink a PNG screenshot. Never throws: anything unexpected returns the
 * original buffer with a `note` explaining what happened, because a slightly
 * expensive screenshot beats a failed one.
 */
export async function compressScreenshot(
  png: Buffer,
  options: CompressOptions = {}
): Promise<CompressedImage> {
  const defaults = compressionDefaults();
  const format = options.format ?? defaults.format;
  const maxWidth = options.maxWidth ?? defaults.maxWidth;
  const quality = clamp(options.quality ?? defaults.quality, 1, 100);

  const size = pngSize(png);
  const originalWidth = size?.width ?? 0;
  const originalHeight = size?.height ?? 0;

  const original = (note?: string): CompressedImage => ({
    buffer: png,
    mimeType: 'image/png',
    extension: 'png',
    width: originalWidth,
    height: originalHeight,
    bytes: png.length,
    originalWidth,
    originalHeight,
    originalBytes: png.length,
    engine: 'none',
    ...(note ? { note } : {}),
  });

  if (format === 'none') return original();
  if (!size) return original('compression skipped: the capture is not a PNG');

  const targetWidth = maxWidth > 0 && originalWidth > maxWidth ? Math.round(maxWidth) : originalWidth;
  const targetHeight = Math.max(1, Math.round((originalHeight * targetWidth) / originalWidth));

  const sharp = loadSharp();
  const notes: string[] = [];

  if (sharp) {
    const encoding = format === 'auto' ? 'jpeg' : format;

    try {
      let pipeline = sharp(png, { failOn: 'none' });

      if (targetWidth < originalWidth) {
        pipeline = pipeline.resize({ width: targetWidth, withoutEnlargement: true });
      }

      if (encoding === 'webp') {
        pipeline = pipeline.webp({ quality });
      } else if (encoding === 'png') {
        pipeline = pipeline.png({ compressionLevel: 9, palette: true });
      } else {
        pipeline = pipeline.flatten({ background: '#000000' }).jpeg({ quality });
      }

      const buffer = await pipeline.toBuffer();

      if (buffer.length < png.length) {
        const descriptor = MIME_TYPES[encoding] ?? MIME_TYPES.jpeg;

        return {
          buffer,
          mimeType: descriptor.mimeType,
          extension: descriptor.extension,
          width: targetWidth,
          height: targetHeight,
          bytes: buffer.length,
          originalWidth,
          originalHeight,
          originalBytes: png.length,
          engine: 'sharp',
          ...(notes.length ? { note: notes.join('; ') } : {}),
        };
      }

      notes.push('sharp output was larger than the original');
    } catch (error) {
      notes.push(`sharp failed (${error instanceof Error ? error.message : error})`);
    }
  } else if (format === 'jpeg' || format === 'webp') {
    notes.push(`${format} needs the optional "sharp" dependency — resized the PNG instead`);
  }

  try {
    const decoded = decodePng(png);
    const resized = resizeRgba(decoded, targetWidth, targetHeight);
    const buffer = encodePng(resized);

    if (buffer.length >= png.length) {
      notes.push('the resized PNG was not smaller');
      return original(notes.join('; '));
    }

    return {
      buffer,
      mimeType: 'image/png',
      extension: 'png',
      width: resized.width,
      height: resized.height,
      bytes: buffer.length,
      originalWidth,
      originalHeight,
      originalBytes: png.length,
      engine: 'png',
      ...(notes.length ? { note: notes.join('; ') } : {}),
    };
  } catch (error) {
    notes.push(`PNG resize failed (${error instanceof Error ? error.message : error})`);
    return original(notes.join('; '));
  }
}

/** One-line human summary of what compression achieved. */
export function describeCompression(image: CompressedImage): string {
  if (image.engine === 'none') {
    return `${image.bytes} bytes, ${image.originalWidth}x${image.originalHeight}, uncompressed${
      image.note ? ` (${image.note})` : ''
    }`;
  }

  const saved = Math.round((1 - image.bytes / image.originalBytes) * 100);

  return `${image.bytes} bytes ${image.mimeType} ${image.width}x${image.height} — ${saved}% smaller than the ${image.originalBytes} byte PNG (${image.engine})${
    image.note ? ` (${image.note})` : ''
  }`;
}
