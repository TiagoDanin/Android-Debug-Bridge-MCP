import * as fs from 'fs';
import * as path from 'path';
import { AdbOptions, adb, adbExecOut, adbShell, settle, shellQuote } from './adb.js';
import { KEY_CODES } from './input.js';
import { ScreenSize, screenRotation, screenSize } from './device.js';
import { clearScreenSizeCache } from './geometry.js';
import { CompressOptions, CompressedImage, compressScreenshot } from './image.js';
import { safeCwd } from '../utils/cwd.js';

export interface ScreenshotResult {
  /** Where the original PNG was written, when a path was given. */
  path: string | null;
  /** Where the compressed copy was written, when `saveCompressed` was set. */
  compressedPath: string | null;
  /** Payload for the caller — compressed unless compression was disabled. */
  base64: string;
  mimeType: string;
  /** Size of the payload above. */
  bytes: number;
  /** Size of the PNG that came off the device. */
  originalBytes: number;
  screen: ScreenSize;
  image: CompressedImage;
}

export interface ScreenshotOptions extends CompressOptions {
  /** Skip compression and return the raw PNG. */
  compress?: boolean;
  /** Also write the compressed copy next to the PNG. */
  saveCompressed?: boolean;
}

export interface ScreenState {
  screen: ScreenSize;
  rotation: number | null;
  awake: boolean;
  locked: boolean;
}

/** Base folder for artifacts. Override with ADB_ARTIFACT_DIR. */
export function artifactRoot(): string {
  return process.env.ADB_ARTIFACT_DIR || safeCwd();
}

/**
 * Where a screenshot for `testName`/`stepName` lands. Keeps the historical
 * `{cwd}/{test}/{step}_step.png` layout used by the MCP tools.
 */
export function screenshotPath(testName?: string, stepName?: string): string | null {
  if (!testName && !stepName) return null;

  const folder = testName ? path.join(artifactRoot(), testName) : artifactRoot();
  const name = stepName ? `${stepName}_step.png` : 'screenshot.png';
  return path.join(folder, name);
}

/**
 * Capture the screen. Writes the PNG to `outPath` when given, and returns a
 * compressed payload — a raw screenshot is megabytes of base64 that nobody
 * reading it actually needs at full resolution.
 */
export async function captureScreenshot(
  outPath?: string | null,
  options: AdbOptions = {},
  screenshotOptions: ScreenshotOptions = {}
): Promise<ScreenshotResult> {
  const buffer = adbExecOut('screencap -p', options);

  if (buffer.length === 0) {
    throw new Error('screencap returned no data — is the device screen on?');
  }

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buffer);
  }

  const image = await compressScreenshot(buffer, {
    maxWidth: screenshotOptions.maxWidth,
    quality: screenshotOptions.quality,
    format: screenshotOptions.compress === false ? 'none' : screenshotOptions.format,
  });

  let compressedPath: string | null = null;

  if (outPath && screenshotOptions.saveCompressed && image.engine !== 'none') {
    const candidate = path.join(
      path.dirname(outPath),
      `${path.basename(outPath, path.extname(outPath))}.${image.extension}`
    );

    if (candidate !== outPath) {
      fs.writeFileSync(candidate, image.buffer);
      compressedPath = candidate;
    }
  }

  return {
    path: outPath ?? null,
    compressedPath,
    base64: image.buffer.toString('base64'),
    mimeType: image.mimeType,
    bytes: image.bytes,
    originalBytes: buffer.length,
    screen: screenSize(options),
    image,
  };
}

/**
 * Record the screen for `durationSeconds` and pull the file to `outPath`.
 * Blocks for the whole duration; screenrecord caps out at 180 seconds.
 */
export async function recordScreen(
  durationSeconds: number,
  outPath: string,
  options: AdbOptions = {}
): Promise<{ path: string; durationSeconds: number; bytes: number }> {
  const duration = Math.min(Math.max(Math.round(durationSeconds), 1), 180);
  const remotePath = `/sdcard/adb_agent_record_${duration}s.mp4`;

  adbShell(`screenrecord --time-limit ${duration} ${shellQuote(remotePath)}`, {
    ...options,
    timeout: (duration + 30) * 1_000,
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  adb(['pull', remotePath, outPath], { ...options, timeout: 120_000 });
  adbShell(`rm -f ${shellQuote(remotePath)}`, options);

  return { path: outPath, durationSeconds: duration, bytes: fs.statSync(outPath).size };
}

/** Rotate the screen. `auto` restores accelerometer-driven rotation. */
export async function rotateScreen(
  orientation: 'auto' | 0 | 90 | 180 | 270,
  options: AdbOptions = {}
): Promise<{ orientation: string }> {
  if (orientation === 'auto') {
    adbShell('settings put system accelerometer_rotation 1', options);
    await settle();
    clearScreenSizeCache();
    return { orientation: 'auto' };
  }

  const rotationValue = { 0: 0, 90: 1, 180: 2, 270: 3 }[orientation];

  if (rotationValue === undefined) {
    throw new Error(`Invalid orientation "${orientation}". Use auto, 0, 90, 180 or 270.`);
  }

  adbShell('settings put system accelerometer_rotation 0', options);
  adbShell(`settings put system user_rotation ${rotationValue}`, options);
  await settle(600);
  clearScreenSizeCache();

  return { orientation: `${orientation}` };
}

function isScreenOn(options: AdbOptions = {}): boolean {
  try {
    const output = adbShell('dumpsys power | grep -E "mWakefulness|Display Power"', options);
    return /mWakefulness=Awake/.test(output) || /state=ON/.test(output);
  } catch {
    return false;
  }
}

function isLocked(options: AdbOptions = {}): boolean {
  try {
    const output = adbShell('dumpsys window | grep -E "mDreamingLockscreen|isStatusBarKeyguard"', options);
    return /mDreamingLockscreen=true/.test(output) || /isStatusBarKeyguard=true/.test(output);
  } catch {
    return false;
  }
}

export function screenState(options: AdbOptions = {}): ScreenState {
  return {
    screen: screenSize(options),
    rotation: screenRotation(options),
    awake: isScreenOn(options),
    locked: isLocked(options),
  };
}

/** Wake the screen and dismiss the keyguard swipe, without unlocking a PIN. */
export async function wakeScreen(options: AdbOptions = {}): Promise<{ awake: boolean }> {
  adbShell(`input keyevent ${KEY_CODES.WAKEUP}`, options);
  adbShell(`input keyevent ${KEY_CODES.MENU}`, options);
  await settle(500);
  return { awake: isScreenOn(options) };
}

export async function sleepScreen(options: AdbOptions = {}): Promise<{ awake: boolean }> {
  adbShell(`input keyevent ${KEY_CODES.SLEEP}`, options);
  await settle(500);
  return { awake: isScreenOn(options) };
}

/** Unlock a device using a numeric PIN (wake, swipe up, type, confirm). */
export async function unlockWithPin(
  pin: string,
  options: AdbOptions = {}
): Promise<{ unlocked: boolean }> {
  await wakeScreen(options);
  const size = screenSize(options);
  adbShell(
    `input swipe ${Math.round(size.width / 2)} ${Math.round(size.height * 0.8)} ${Math.round(
      size.width / 2
    )} ${Math.round(size.height * 0.2)} 200`,
    options
  );
  await settle(600);
  adbShell(`input text ${shellQuote(pin)}`, options);
  adbShell(`input keyevent ${KEY_CODES.ENTER}`, options);
  await settle(800);

  return { unlocked: !isLocked(options) };
}
