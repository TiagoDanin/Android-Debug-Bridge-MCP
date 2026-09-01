import { execFileSync } from 'child_process';
import { sleep } from '../utils/sleep.js';

const DEFAULT_TIMEOUT = 60_000;
const MAX_BUFFER = 64 * 1024 * 1024;

export interface AdbOptions {
  /**
   * Which device to target: a serial, a serial prefix, a transport id or a
   * model name. Falls back to ADB_SERIAL / ANDROID_SERIAL, then to the only
   * connected device.
   */
  device?: string;
  /** Timeout in milliseconds. */
  timeout?: number;
  /** Do not prefix `-s <serial>` (used by host commands like `devices`). */
  hostOnly?: boolean;
  /**
   * Accept devices that are not in the `device` state, and run without `-s`
   * when nothing is listed yet. Used by the commands that wait for a device to
   * come up, which must not fail just because it is still booting.
   */
  anyState?: boolean;
}

export interface DeviceEntry {
  serial: string;
  state: string;
  model?: string;
  product?: string;
  device?: string;
  transportId?: string;
  isEmulator: boolean;
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

/** Device requested by the caller or the environment, before any matching. */
export function resolveSerial(explicit?: string): string | undefined {
  return explicit || process.env.ADB_SERIAL || process.env.ANDROID_SERIAL || undefined;
}

// ─── device selection ─────────────────────────────────────────────────────────

let deviceCache: { at: number; entries: DeviceEntry[] } | null = null;

function deviceCacheTtl(): number {
  const parsed = Number(process.env.ADB_DEVICE_CACHE_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 3_000;
}

/** Forget the cached device list — call after connect/disconnect/reboot. */
export function clearDeviceCache(): void {
  deviceCache = null;
}

function parseDeviceList(output: string): DeviceEntry[] {
  return output
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('*'))
    .map((line) => {
      const [serial, state, ...rest] = line.split(/\s+/);
      const meta: Record<string, string> = {};

      for (const token of rest) {
        const separator = token.indexOf(':');
        if (separator > 0) {
          meta[token.slice(0, separator)] = token.slice(separator + 1);
        }
      }

      return {
        serial,
        state,
        model: meta.model,
        product: meta.product,
        device: meta.device,
        transportId: meta.transport_id,
        isEmulator: serial.startsWith('emulator-') || meta.product?.includes('sdk') === true,
      };
    });
}

/** Parse `adb devices -l` into structured entries. */
export function listDevices(options: AdbOptions = {}): DeviceEntry[] {
  return parseDeviceList(adb(['devices', '-l'], { ...options, hostOnly: true }));
}

/**
 * Device list, cached for a few seconds. Every command has to know which
 * device it targets, so without this a single tool call would shell out to
 * `adb devices` half a dozen times.
 */
export function cachedDevices(refresh = false): DeviceEntry[] {
  const ttl = deviceCacheTtl();

  if (!refresh && deviceCache && ttl > 0 && Date.now() - deviceCache.at < ttl) {
    return deviceCache.entries;
  }

  const entries = listDevices();
  deviceCache = { at: Date.now(), entries };

  return entries;
}

export function describeDevice(entry: DeviceEntry): string {
  const details = [entry.model, entry.state !== 'device' ? entry.state : null]
    .filter(Boolean)
    .join(', ');

  return details ? `${entry.serial} (${details})` : entry.serial;
}

/**
 * Match a user-supplied reference against the connected devices. Anything that
 * identifies the device works — full serial, serial prefix, transport id or
 * model name — so callers do not have to copy `emulator-5554` around.
 */
export function matchDevices(entries: DeviceEntry[], wanted: string): DeviceEntry[] {
  const exact = entries.find((entry) => entry.serial === wanted);
  if (exact) return [exact];

  const needle = wanted.toLowerCase();
  const rules: Array<(entry: DeviceEntry) => boolean> = [
    (entry) => entry.serial.toLowerCase() === needle,
    (entry) => entry.transportId === wanted,
    (entry) => entry.serial.toLowerCase().startsWith(needle),
    (entry) => (entry.model ?? '').toLowerCase() === needle,
    (entry) => (entry.model ?? '').toLowerCase().includes(needle),
    (entry) => (entry.product ?? '').toLowerCase().includes(needle),
    (entry) => (entry.device ?? '').toLowerCase().includes(needle),
  ];

  for (const rule of rules) {
    const matches = entries.filter(rule);
    if (matches.length > 0) return matches;
  }

  return [];
}

/**
 * Decide which device a command runs against, with errors that say what to do
 * next instead of adb's bare "more than one device/emulator".
 */
export function selectDevice(explicit?: string, options: AdbOptions = {}): DeviceEntry | undefined {
  const wanted = resolveSerial(explicit);
  const entries = cachedDevices();

  if (wanted) {
    const matches = matchDevices(entries, wanted);

    if (matches.length === 1) return matches[0];

    if (matches.length > 1) {
      throw new AdbError(
        `"${wanted}" matches ${matches.length} devices (${matches
          .map((entry) => entry.serial)
          .join(', ')}). Use the full serial.`,
        ['devices']
      );
    }

    // A fresh device may not be listed yet while we are waiting for it.
    if (options.anyState) return undefined;

    const available = entries.length
      ? entries.map(describeDevice).join(', ')
      : 'none (run "adb devices" to check the daemon)';

    throw new AdbError(`Device "${wanted}" not found. Connected: ${available}`, ['devices']);
  }

  const usable = options.anyState ? entries : entries.filter((entry) => entry.state === 'device');

  if (usable.length === 1) return usable[0];

  if (usable.length === 0) {
    if (options.anyState) return undefined;

    const stalled = entries.filter((entry) => entry.state !== 'device');
    const hint = stalled.length
      ? ` Devices in a non-ready state: ${stalled.map(describeDevice).join(', ')}. Accept the USB debugging prompt or reconnect them.`
      : ' Start an emulator or plug in a device with USB debugging enabled.';

    throw new AdbError(`No ready Android device found.${hint}`, ['devices']);
  }

  throw new AdbError(
    `${usable.length} devices are connected (${usable
      .map(describeDevice)
      .join(', ')}). Pick one with the "device" parameter (serial, prefix or model), the --device flag, or the ADB_SERIAL environment variable.`,
    ['devices']
  );
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
  if (options.hostOnly) return args;

  const serial = selectDevice(options.device, options)?.serial;
  return serial ? ['-s', serial, ...args] : args;
}

/**
 * adb's own multi-device error is a dead end for the caller. Replace it with
 * the list of devices and the flag that resolves the ambiguity.
 */
function explainAmbiguity(detail: string, options: AdbOptions): string {
  if (options.hostOnly || !/more than one device|multiple devices/i.test(detail)) {
    return detail;
  }

  try {
    const entries = cachedDevices(true).filter((entry) => entry.state === 'device');

    return `${detail} — connected: ${entries
      .map(describeDevice)
      .join(', ')}. Pick one with the "device" parameter, --device, or ADB_SERIAL.`;
  } catch {
    return detail;
  }
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
    const detail = explainAmbiguity(stderr || stdout || error?.message || 'unknown error', options);

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
