import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AdbOptions, adbShell, selectDevice, settle, shellQuote } from './adb.js';
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

export type TouchKind = 'tap' | 'double-tap' | 'long-press' | 'swipe' | 'scroll';

export interface TouchEvent {
  kind: TouchKind;
  /** Where the gesture started, in device pixels. */
  x: number;
  y: number;
  /** Where it ended, for swipes and scrolls. */
  to?: { x: number; y: number };
  durationMs?: number;
  /** Serial the gesture was sent to, or `default` when it could not be read. */
  device: string;
  at: number;
}

const HISTORY_LIMIT = 50;
const memory: TouchEvent[] = [];

/**
 * Gestures are also written to a small JSON file, because the CLI is a fresh
 * process per command: without it `input tap` and `screen shot --mark-tap`
 * would never see each other. Point it elsewhere with ADB_TOUCH_HISTORY_FILE,
 * or turn it off with ADB_TOUCH_HISTORY=off.
 */
function historyFile(): string | null {
  const mode = (process.env.ADB_TOUCH_HISTORY || '').toLowerCase();
  if (mode === 'off' || mode === 'false' || mode === '0') return null;

  return process.env.ADB_TOUCH_HISTORY_FILE || path.join(os.tmpdir(), 'adb-agent-touches.json');
}

function isTouchEvent(value: any): value is TouchEvent {
  return (
    value &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.at === 'number' &&
    typeof value.kind === 'string' &&
    typeof value.device === 'string'
  );
}

function readStoredHistory(): TouchEvent[] {
  const file = historyFile();
  if (!file) return [];

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter(isTouchEvent) : [];
  } catch {
    // No file yet, or someone else is mid-write: an empty history is fine.
    return [];
  }
}

/**
 * This process and every earlier one, oldest first and de-duplicated. The
 * in-memory copy comes first so a retagged gesture wins over the version that
 * was already written to disk.
 */
function mergedHistory(): TouchEvent[] {
  const seen = new Set<string>();

  return [...memory, ...readStoredHistory()]
    .filter((entry) => {
      const key = `${entry.at}:${entry.device}:${entry.x}:${entry.y}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.at - right.at)
    .slice(-HISTORY_LIMIT);
}

function persistHistory(): void {
  const file = historyFile();
  if (!file) return;

  try {
    fs.writeFileSync(file, JSON.stringify(mergedHistory()));
  } catch {
    // A read-only temp dir costs the cross-process history, not the gesture.
  }
}

/**
 * Which device a gesture belongs to. `selectDevice` is backed by the device
 * cache, so this costs nothing on the tap path — and the gesture has already
 * been sent by the time it runs, so a failure here is never fatal.
 */
function touchDeviceKey(options: AdbOptions): string {
  try {
    return selectDevice(options.device)?.serial ?? 'default';
  } catch {
    return options.device ?? 'default';
  }
}

/**
 * Remember a gesture so a later screenshot can point at it. The device draws
 * its own indicator only while the finger is down, which a screenshot taken
 * afterwards always misses.
 */
function recordTouch(event: Omit<TouchEvent, 'at' | 'device'>, options: AdbOptions): TouchEvent {
  const entry: TouchEvent = { ...event, device: touchDeviceKey(options), at: Date.now() };

  memory.push(entry);
  if (memory.length > HISTORY_LIMIT) memory.shift();
  persistHistory();

  return entry;
}

/** Relabel the gesture just recorded — `scroll` is a swipe under the hood. */
function retagLastTouch(kind: TouchKind): void {
  const entry = memory[memory.length - 1];
  if (!entry) return;

  entry.kind = kind;
  persistHistory();
}

/** The most recent gestures on a device, oldest first. */
export function recentTouches(limit = 1, options: AdbOptions = {}): TouchEvent[] {
  const key = touchDeviceKey(options);
  const history = mergedHistory();
  const scoped = key === 'default' ? history : history.filter((entry) => entry.device === key);

  return scoped.slice(-Math.max(Math.round(limit), 0));
}

/** The last gesture sent to a device, if any. */
export function lastTouch(options: AdbOptions = {}): TouchEvent | null {
  return recentTouches(1, options)[0] ?? null;
}

export function clearTouchHistory(): void {
  memory.length = 0;

  const file = historyFile();
  if (!file) return;

  try {
    fs.rmSync(file, { force: true });
  } catch {
    // Nothing to clean up.
  }
}

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
  recordTouch({ kind: 'tap', x: point.x, y: point.y }, options);
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
  recordTouch({ kind: 'double-tap', x: point.x, y: point.y }, options);
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
  recordTouch({ kind: 'long-press', x: point.x, y: point.y, durationMs }, options);
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
  recordTouch(
    { kind: 'swipe', x: from.x, y: from.y, to: { x: to.x, y: to.y }, durationMs },
    options
  );
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

  const result = await swipe(vector[0], vector[1], vector[2], vector[3], durationMs, 'pixels', options);
  retagLastTouch('scroll');

  return result;
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
