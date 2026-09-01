import { RgbaImage, decodePng, encodePng } from './image.js';

/**
 * Drawing markers over a screenshot.
 *
 * `show_touches` makes the device draw its own touch indicator, but it only
 * exists while the finger is down — a screenshot taken after the tap has
 * already missed it. Painting the marker here is the only way to answer "where
 * did that tap actually land?" from a still image.
 */

export interface MarkerPoint {
  x: number;
  y: number;
}

export interface Marker extends MarkerPoint {
  /** Caption drawn next to the ring. Digits, `#`, `.` and `-` only. */
  label?: string;
  /** Hex colour (#rgb or #rrggbb). Defaults to ADB_MARKER_COLOR or #ff2d55. */
  color?: string;
  /** Ring radius in pixels. Defaults to ~3.5% of the image width. */
  radius?: number;
  /** End point of a gesture — draws an arrow from the marker to it. */
  to?: MarkerPoint;
}

export interface AnnotateOptions {
  /** Fallback colour for markers that do not carry one. */
  color?: string;
  /** Fallback radius for markers that do not carry one. */
  radius?: number;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const DEFAULT_COLOR: Rgb = { r: 255, g: 45, b: 85 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

// 3x5 bitmap font — enough for the index labels markers carry.
const GLYPHS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '#': ['101', '111', '101', '111', '101'],
  '-': ['000', '000', '111', '000', '000'],
  '.': ['000', '000', '000', '000', '010'],
};

export function parseColor(value: string | undefined, fallback: Rgb = DEFAULT_COLOR): Rgb {
  if (!value) return fallback;

  const hex = value.trim().replace(/^#/, '');
  const expanded =
    hex.length === 3
      ? hex
          .split('')
          .map((char) => char + char)
          .join('')
      : hex;

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return fallback;

  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}

/** Default marker colour, overridable with ADB_MARKER_COLOR. */
export function markerColor(): Rgb {
  return parseColor(process.env.ADB_MARKER_COLOR, DEFAULT_COLOR);
}

function blend(image: RgbaImage, x: number, y: number, color: Rgb, alpha: number): void {
  if (alpha <= 0 || x < 0 || y < 0 || x >= image.width || y >= image.height) return;

  const target = (y * image.width + x) * 4;
  const weight = Math.min(alpha, 1);
  const keep = 1 - weight;

  image.data[target] = Math.round(image.data[target] * keep + color.r * weight);
  image.data[target + 1] = Math.round(image.data[target + 1] * keep + color.g * weight);
  image.data[target + 2] = Math.round(image.data[target + 2] * keep + color.b * weight);
}

/** Coverage of a pixel by a shape whose signed distance to the edge is `d`. */
function coverage(distance: number): number {
  return Math.min(Math.max(0.5 - distance, 0), 1);
}

function fillCircle(
  image: RgbaImage,
  cx: number,
  cy: number,
  radius: number,
  color: Rgb,
  alpha: number
): void {
  const left = Math.floor(cx - radius - 1);
  const right = Math.ceil(cx + radius + 1);
  const top = Math.floor(cy - radius - 1);
  const bottom = Math.ceil(cy + radius + 1);

  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const distance = Math.hypot(x - cx, y - cy) - radius;
      blend(image, x, y, color, coverage(distance) * alpha);
    }
  }
}

function strokeCircle(
  image: RgbaImage,
  cx: number,
  cy: number,
  radius: number,
  thickness: number,
  color: Rgb,
  alpha = 1
): void {
  const half = thickness / 2;
  const outer = radius + half + 1;
  const left = Math.floor(cx - outer);
  const right = Math.ceil(cx + outer);
  const top = Math.floor(cy - outer);
  const bottom = Math.ceil(cy + outer);

  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const distance = Math.abs(Math.hypot(x - cx, y - cy) - radius) - half;
      blend(image, x, y, color, coverage(distance) * alpha);
    }
  }
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);

  const t = Math.min(Math.max(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0), 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function strokeSegment(
  image: RgbaImage,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  thickness: number,
  color: Rgb,
  alpha = 1
): void {
  const half = thickness / 2;
  const left = Math.floor(Math.min(ax, bx) - half - 1);
  const right = Math.ceil(Math.max(ax, bx) + half + 1);
  const top = Math.floor(Math.min(ay, by) - half - 1);
  const bottom = Math.ceil(Math.max(ay, by) + half + 1);

  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const distance = distanceToSegment(x, y, ax, ay, bx, by) - half;
      blend(image, x, y, color, coverage(distance) * alpha);
    }
  }
}

/** Text in the 3x5 font, over a white plate so it reads on any background. */
function drawLabel(
  image: RgbaImage,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: Rgb
): void {
  const characters = text.toUpperCase().split('');
  const advance = 4 * scale;
  const width = characters.length * advance - scale;
  const height = 5 * scale;

  for (let py = y - scale; py < y + height + scale; py += 1) {
    for (let px = x - scale; px < x + width + scale; px += 1) {
      blend(image, px, py, WHITE, 0.85);
    }
  }

  characters.forEach((character, index) => {
    const glyph = GLYPHS[character];
    if (!glyph) return;

    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] !== '1') continue;

        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            blend(image, x + index * advance + column * scale + dx, y + row * scale + dy, color, 1);
          }
        }
      }
    }
  });
}

/**
 * Paint the markers onto `image` in place and return it.
 *
 * Each marker is a translucent disc, a ring outlined in white so it survives a
 * busy background, and four arms pointing at the centre; markers with a `to`
 * point also get an arrow along the gesture.
 */
export function drawMarkers(
  image: RgbaImage,
  markers: Marker[],
  options: AnnotateOptions = {}
): RgbaImage {
  const fallbackColor = parseColor(options.color, markerColor());
  const baseRadius =
    options.radius && options.radius > 0
      ? options.radius
      : Math.max(24, Math.round(image.width * 0.035));

  for (const marker of markers) {
    const color = parseColor(marker.color, fallbackColor);
    const radius = marker.radius && marker.radius > 0 ? marker.radius : baseRadius;
    const stroke = Math.max(3, Math.round(radius * 0.22));
    const { x, y } = marker;

    if (marker.to) {
      const angle = Math.atan2(marker.to.y - y, marker.to.x - x);
      const head = Math.max(radius * 0.8, stroke * 3);

      strokeSegment(image, x, y, marker.to.x, marker.to.y, stroke + 2, WHITE, 0.85);
      strokeSegment(image, x, y, marker.to.x, marker.to.y, stroke, color);

      for (const spread of [Math.PI * 0.82, -Math.PI * 0.82]) {
        strokeSegment(
          image,
          marker.to.x,
          marker.to.y,
          marker.to.x + Math.cos(angle + spread) * head,
          marker.to.y + Math.sin(angle + spread) * head,
          stroke,
          color
        );
      }
    }

    fillCircle(image, x, y, radius, color, 0.22);
    strokeCircle(image, x, y, radius, stroke + 2, WHITE, 0.9);
    strokeCircle(image, x, y, radius, stroke, color);

    // Arms sit outside the ring so the tapped pixel itself stays readable.
    const inner = radius + stroke;
    const outer = radius + stroke + Math.round(radius * 0.7);

    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      strokeSegment(
        image,
        x + dx * inner,
        y + dy * inner,
        x + dx * outer,
        y + dy * outer,
        stroke + 2,
        WHITE,
        0.9
      );
      strokeSegment(image, x + dx * inner, y + dy * inner, x + dx * outer, y + dy * outer, stroke, color);
    }

    if (marker.label) {
      const scale = Math.max(2, Math.round(radius / 6));
      drawLabel(image, marker.label, Math.round(x + outer * 0.7), Math.round(y - outer), scale, color);
    }
  }

  return image;
}

/** Decode a PNG, draw the markers and encode it again. */
export function annotatePng(png: Buffer, markers: Marker[], options: AnnotateOptions = {}): Buffer {
  const image = drawMarkers(decodePng(png), markers, options);
  // Level 6: this buffer is either re-encoded by the compressor or written as
  // a debug artifact, so the last few percent are not worth the extra seconds.
  return encodePng(image, 6);
}
