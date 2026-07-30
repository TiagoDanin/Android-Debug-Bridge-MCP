import { AdbOptions, adbShell, settle, shellQuote } from './adb.js';
import { CoordinateMode, ResolvedPoint, cachedScreenSize, resolvePoint } from './geometry.js';

export const KEY_CODES: Record<string, number> = {
  BACK: 4,
  HOME: 3,
  RECENTS: 187,
  APP_SWITCH: 187,
  MENU: 82,
  ENTER: 66,
  DELETE: 67,
  FORWARD_DELETE: 112,
  TAB: 61,
  SPACE: 62,
  ESCAPE: 111,
  SEARCH: 84,
  POWER: 26,
  WAKEUP: 224,
  SLEEP: 223,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  VOLUME_MUTE: 164,
  CAMERA: 27,
  CALL: 5,
  ENDCALL: 6,
  NOTIFICATION: 83,
  DPAD_UP: 19,
  DPAD_DOWN: 20,
  DPAD_LEFT: 21,
  DPAD_RIGHT: 22,
  DPAD_CENTER: 23,
  PAGE_UP: 92,
  PAGE_DOWN: 93,
  MOVE_HOME: 122,
  MOVE_END: 123,
  CUT: 277,
  COPY: 278,
  PASTE: 279,
};

export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

export interface TapResult {
  point: ResolvedPoint;
}

export interface SwipeResult {
  from: ResolvedPoint;
  to: ResolvedPoint;
  durationMs: number;
}

export async function tap(
  x: number,
  y: number,
  mode: CoordinateMode = 'auto',
  options: AdbOptions = {}
): Promise<TapResult> {
  const point = resolvePoint(x, y, mode, options);
  adbShell(`input tap ${point.x} ${point.y}`, options);
  await settle();
  return { point };
}

export async function doubleTap(
  x: number,
  y: number,
  mode: CoordinateMode = 'auto',
  options: AdbOptions = {}
): Promise<TapResult> {
  const point = resolvePoint(x, y, mode, options);
  adbShell(`input tap ${point.x} ${point.y}`, options);
  adbShell(`input tap ${point.x} ${point.y}`, options);
  await settle();
  return { point };
}

export async function longPress(
  x: number,
  y: number,
  durationMs = 800,
  mode: CoordinateMode = 'auto',
  options: AdbOptions = {}
): Promise<SwipeResult> {
  const point = resolvePoint(x, y, mode, options);
  adbShell(`input swipe ${point.x} ${point.y} ${point.x} ${point.y} ${durationMs}`, options);
  await settle();
  return { from: point, to: point, durationMs };
}

export async function swipe(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  durationMs = 300,
  mode: CoordinateMode = 'auto',
  options: AdbOptions = {}
): Promise<SwipeResult> {
  const from = resolvePoint(x1, y1, mode, options);
  const to = resolvePoint(x2, y2, mode, options);
  adbShell(`input swipe ${from.x} ${from.y} ${to.x} ${to.y} ${durationMs}`, options);
  await settle();
  return { from, to, durationMs };
}

/**
 * Scroll the screen. `direction` is the direction the content moves, so `down`
 * reveals content further down the page.
 */
export async function scroll(
  direction: ScrollDirection,
  amount = 0.6,
  durationMs = 300,
  options: AdbOptions = {}
): Promise<SwipeResult> {
  const screen = cachedScreenSize(options);
  const centerX = Math.round(screen.width / 2);
  const centerY = Math.round(screen.height / 2);
  const verticalSpan = Math.round((screen.height * Math.min(Math.max(amount, 0.05), 0.9)) / 2);
  const horizontalSpan = Math.round((screen.width * Math.min(Math.max(amount, 0.05), 0.9)) / 2);

  const vectors: Record<ScrollDirection, [number, number, number, number]> = {
    down: [centerX, centerY + verticalSpan, centerX, centerY - verticalSpan],
    up: [centerX, centerY - verticalSpan, centerX, centerY + verticalSpan],
    right: [centerX + horizontalSpan, centerY, centerX - horizontalSpan, centerY],
    left: [centerX - horizontalSpan, centerY, centerX + horizontalSpan, centerY],
  };

  const vector = vectors[direction];
  if (!vector) {
    throw new Error(`Invalid scroll direction: ${direction}. Use up, down, left or right.`);
  }

  return swipe(vector[0], vector[1], vector[2], vector[3], durationMs, 'pixels', options);
}

/**
 * Type text into the focused field.
 *
 * `adb shell input text` only handles ASCII reliably; characters outside that
 * range are reported back so callers can fall back to a keyboard IME.
 */
export async function inputText(
  text: string,
  submit = false,
  options: AdbOptions = {}
): Promise<{ text: string; submitted: boolean; unsupported: string[] }> {
  const unsupported = Array.from(new Set(text.split('').filter((char) => char.charCodeAt(0) > 127)));

  adbShell(`input text ${shellQuote(text)}`, options);

  if (submit) {
    adbShell(`input keyevent ${KEY_CODES.ENTER}`, options);
  }

  await settle();
  return { text, submitted: submit, unsupported };
}

export async function pressKey(
  key: string,
  options: AdbOptions = {}
): Promise<{ key: string; code: number }> {
  const normalized = key.trim().toUpperCase().replace(/^KEYCODE_/, '');
  const code = KEY_CODES[normalized] ?? (/^\d+$/.test(normalized) ? Number(normalized) : undefined);

  if (code === undefined) {
    throw new Error(
      `Unknown key "${key}". Known keys: ${Object.keys(KEY_CODES).join(', ')} (or a raw keycode number).`
    );
  }

  adbShell(`input keyevent ${code}`, options);
  await settle();
  return { key: normalized, code };
}

/**
 * Clear the focused field: jump to the end, then send `count` backspaces.
 * `input keyevent` accepts several keycodes at once, so this is a single call.
 */
export async function clearText(
  count = 60,
  options: AdbOptions = {}
): Promise<{ cleared: true; deletes: number }> {
  const deletes = Math.min(Math.max(count, 1), 500);
  const backspaces = new Array(deletes).fill(KEY_CODES.DELETE).join(' ');

  adbShell(`input keyevent ${KEY_CODES.MOVE_END}`, options);
  adbShell(`input keyevent ${backspaces}`, options);
  await settle();
  return { cleared: true, deletes };
}
