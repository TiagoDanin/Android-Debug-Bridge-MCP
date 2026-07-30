import { AdbOptions } from './adb.js';
import { ScreenSize, screenSize } from './device.js';

export type CoordinateMode = 'auto' | 'normalized' | 'pixels';

export interface Point {
  x: number;
  y: number;
}

export interface ResolvedPoint extends Point {
  /** The values as they were supplied, before conversion. */
  input: Point;
  mode: 'normalized' | 'pixels';
  screen: ScreenSize;
}

let cachedSize: { key: string; size: ScreenSize } | null = null;

/** Screen size with a per-serial cache — resolving coordinates is a hot path. */
export function cachedScreenSize(options: AdbOptions = {}): ScreenSize {
  const key = options.device || process.env.ADB_SERIAL || process.env.ANDROID_SERIAL || 'default';

  if (cachedSize && cachedSize.key === key) {
    return cachedSize.size;
  }

  const size = screenSize(options);
  cachedSize = { key, size };
  return size;
}

export function clearScreenSizeCache(): void {
  cachedSize = null;
}

function isNormalizedValue(value: number): boolean {
  return value >= 0 && value <= 1;
}

/**
 * Convert a coordinate pair into device pixels.
 *
 * `auto` (the default) treats both values as normalized 0..1 fractions when
 * they both fall inside that range, which is what agents produce most often,
 * and as raw pixels otherwise.
 */
export function resolvePoint(
  x: number,
  y: number,
  mode: CoordinateMode = 'auto',
  options: AdbOptions = {}
): ResolvedPoint {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`Invalid coordinates: (${x}, ${y})`);
  }

  const screen = cachedScreenSize(options);
  const normalized =
    mode === 'normalized' || (mode === 'auto' && isNormalizedValue(x) && isNormalizedValue(y));

  if (mode === 'normalized' && !(isNormalizedValue(x) && isNormalizedValue(y))) {
    throw new Error(`Normalized coordinates must be between 0 and 1, got (${x}, ${y})`);
  }

  const pixelX = normalized ? Math.round(x * screen.width) : Math.round(x);
  const pixelY = normalized ? Math.round(y * screen.height) : Math.round(y);

  return {
    x: Math.min(Math.max(pixelX, 0), screen.width - 1),
    y: Math.min(Math.max(pixelY, 0), screen.height - 1),
    input: { x, y },
    mode: normalized ? 'normalized' : 'pixels',
    screen,
  };
}

/** Express a pixel point as normalized fractions, handy for reporting back. */
export function toNormalized(point: Point, screen: ScreenSize): Point {
  return {
    x: Number((point.x / screen.width).toFixed(4)),
    y: Number((point.y / screen.height).toFixed(4)),
  };
}
