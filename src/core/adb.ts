import { execFileSync } from 'child_process';
import { sleep } from '../utils/sleep.js';

const DEFAULT_TIMEOUT = 60_000;
const MAX_BUFFER = 64 * 1024 * 1024;

export interface AdbOptions {
  /** Device serial to target. Falls back to ADB_SERIAL / ANDROID_SERIAL. */
  device?: string;
  /** Timeout in milliseconds. */
  timeout?: number;
  /** Do not prefix `-s <serial>` (used by host commands like `devices`). */
  hostOnly?: boolean;
}

export class AdbError extends Error {
  readonly stderr: string;
  readonly exitCode: number | undefined;
  readonly args: string[];

  constructor(message: string, args: string[], stderr = '', exitCode?: number) {
    super(message);
    this.name = 'AdbError';
    this.args = args;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

/** Path to the adb binary. Override with ADB_PATH. */
export function adbPath(): string {
  return process.env.ADB_PATH || 'adb';
}

/** Serial that commands target, if any. */
export function resolveSerial(explicit?: string): string | undefined {
  return explicit || process.env.ADB_SERIAL || process.env.ANDROID_SERIAL || undefined;
}

/** Delay applied after UI-mutating actions so the screen can settle. */
export function settleDelay(): number {
  const raw = process.env.ADB_SETTLE_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 300;
}

export async function settle(ms = settleDelay()): Promise<void> {
  if (ms > 0) await sleep(ms);
}

function buildArgs(args: string[], options: AdbOptions): string[] {
  const serial = options.hostOnly ? undefined : resolveSerial(options.device);
  return serial ? ['-s', serial, ...args] : args;
}

/** Run adb and return raw stdout. Throws AdbError on non-zero exit. */
export function adbRaw(args: string[], options: AdbOptions = {}): Buffer {
  const finalArgs = buildArgs(args, options);

  try {
    return execFileSync(adbPath(), finalArgs, {
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    });
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw new AdbError(
        `adb executable not found (tried "${adbPath()}"). Install Android platform-tools or set ADB_PATH.`,
        finalArgs
      );
    }

    const stderr = error?.stderr ? String(error.stderr).trim() : '';
    const stdout = error?.stdout ? String(error.stdout).trim() : '';
    const detail = stderr || stdout || error?.message || 'unknown error';

    throw new AdbError(
      `adb ${finalArgs.join(' ')} failed: ${detail}`,
      finalArgs,
      stderr,
      typeof error?.status === 'number' ? error.status : undefined
    );
  }
}

/** Run adb and return trimmed stdout as text. */
export function adb(args: string[], options: AdbOptions = {}): string {
  return adbRaw(args, options).toString('utf8').replace(/\r\n/g, '\n').trimEnd();
}

/**
 * Run a command inside the device shell. `command` is sent verbatim to the
 * device's own shell, so quote arguments with `shellQuote` when they may
 * contain spaces or metacharacters.
 */
export function adbShell(command: string, options: AdbOptions = {}): string {
  return adb(['shell', command], options);
}

/** Run a device shell command and return raw bytes (screencap, screenrecord…). */
export function adbExecOut(command: string, options: AdbOptions = {}): Buffer {
  return adbRaw(['exec-out', command], options);
}

/** Quote a value for the device shell (single quotes, POSIX style). */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Read a system property from the device. */
export function getProp(key: string, options: AdbOptions = {}): string {
  return adbShell(`getprop ${shellQuote(key)}`, options).trim();
}
