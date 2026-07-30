import * as fs from 'fs';
import * as path from 'path';
import { AdbOptions, adb, adbShell, getProp, settle, shellQuote } from './adb.js';

export type ToggleTarget = 'wifi' | 'data' | 'airplane';

export interface LogcatOptions {
  /** Number of trailing lines to return. */
  lines?: number;
  /** Case-insensitive substring filter applied to each line. */
  filter?: string;
  /** Minimum priority: V, D, I, W, E, F. */
  priority?: string;
  /** Only lines belonging to this package's PID. */
  packageName?: string;
  /** Clear the buffer before reading. */
  clear?: boolean;
}

export async function setToggle(
  target: ToggleTarget,
  enabled: boolean,
  options: AdbOptions = {}
): Promise<string> {
  switch (target) {
    case 'wifi':
      adbShell(`svc wifi ${enabled ? 'enable' : 'disable'}`, options);
      break;
    case 'data':
      adbShell(`svc data ${enabled ? 'enable' : 'disable'}`, options);
      break;
    case 'airplane':
      adbShell(`cmd connectivity airplane-mode ${enabled ? 'enable' : 'disable'}`, options);
      break;
    default:
      throw new Error(`Unknown toggle "${target}". Use wifi, data or airplane.`);
  }

  await settle();
  return `${target} ${enabled ? 'enabled' : 'disabled'}`;
}

/** Read connectivity status without changing it. */
export function connectivityState(options: AdbOptions = {}): {
  wifi: boolean | null;
  data: boolean | null;
  airplane: boolean | null;
} {
  const read = (command: string): string => {
    try {
      return adbShell(command, options).trim();
    } catch {
      return '';
    }
  };

  const toBool = (value: string): boolean | null => {
    if (value === '1' || value === 'enabled' || value === 'true') return true;
    if (value === '0' || value === 'disabled' || value === 'false') return false;
    return null;
  };

  return {
    wifi: toBool(read('settings get global wifi_on')),
    data: toBool(read('settings get global mobile_data')),
    airplane: toBool(read('settings get global airplane_mode_on')),
  };
}

/** Read the logcat buffer. Returns the tail of the log as text. */
export function readLogcat(logOptions: LogcatOptions = {}, options: AdbOptions = {}): string {
  if (logOptions.clear) {
    adb(['logcat', '-c'], options);
  }

  const args = ['logcat', '-d'];

  if (logOptions.packageName) {
    const pid = adbShell(`pidof ${shellQuote(logOptions.packageName)}`, options).trim().split(/\s+/)[0];
    if (pid) {
      args.push('--pid', pid);
    }
  }

  if (logOptions.priority) {
    args.push(`*:${logOptions.priority.toUpperCase()}`);
  }

  const output = adb(args, { ...options, timeout: 60_000 });
  let lines = output.split('\n');

  if (logOptions.filter) {
    const needle = logOptions.filter.toLowerCase();
    lines = lines.filter((line) => line.toLowerCase().includes(needle));
  }

  const limit = logOptions.lines ?? 200;
  return lines.slice(-limit).join('\n');
}

export function clearLogcat(options: AdbOptions = {}): string {
  adb(['logcat', '-c'], options);
  return 'Logcat buffer cleared';
}

/** Open a deeplink / URL through the activity manager. */
export async function openDeeplink(
  url: string,
  packageName?: string,
  options: AdbOptions = {}
): Promise<string> {
  const target = packageName ? ` ${shellQuote(packageName)}` : '';
  const output = adbShell(
    `am start -a android.intent.action.VIEW -d ${shellQuote(url)}${target}`,
    options
  );
  await settle(1_000);
  return output.trim() || `Opened ${url}`;
}

/** Broadcast an intent, e.g. to trigger a receiver in the app under test. */
export async function sendBroadcast(
  action: string,
  extras: Record<string, string> = {},
  options: AdbOptions = {}
): Promise<string> {
  const extraArgs = Object.entries(extras)
    .map(([key, value]) => `--es ${shellQuote(key)} ${shellQuote(value)}`)
    .join(' ');

  const output = adbShell(`am broadcast -a ${shellQuote(action)} ${extraArgs}`.trim(), options);
  await settle();
  return output.trim();
}

export function pushFile(localPath: string, remotePath: string, options: AdbOptions = {}): string {
  if (!fs.existsSync(localPath)) {
    throw new Error(`Local file not found: ${localPath}`);
  }

  return adb(['push', localPath, remotePath], { ...options, timeout: 300_000 });
}

export function pullFile(remotePath: string, localPath: string, options: AdbOptions = {}): string {
  fs.mkdirSync(path.dirname(path.resolve(localPath)), { recursive: true });
  return adb(['pull', remotePath, localPath], { ...options, timeout: 300_000 });
}

export function getSetting(
  namespace: 'system' | 'secure' | 'global',
  key: string,
  options: AdbOptions = {}
): string {
  return adbShell(`settings get ${namespace} ${shellQuote(key)}`, options).trim();
}

export function putSetting(
  namespace: 'system' | 'secure' | 'global',
  key: string,
  value: string,
  options: AdbOptions = {}
): string {
  adbShell(`settings put ${namespace} ${shellQuote(key)} ${shellQuote(value)}`, options);
  return `${namespace}.${key} = ${value}`;
}

export function listProcesses(filter?: string, options: AdbOptions = {}): string {
  const output = adbShell('ps -A', options);

  if (!filter) return output;

  const needle = filter.toLowerCase();
  const lines = output.split('\n');
  const header = lines[0];
  const matched = lines.slice(1).filter((line) => line.toLowerCase().includes(needle));

  return [header, ...matched].join('\n');
}

export function memoryUsage(packageName: string, options: AdbOptions = {}): string {
  return adbShell(`dumpsys meminfo ${shellQuote(packageName)}`, options);
}

export function batteryInfo(options: AdbOptions = {}): string {
  return adbShell('dumpsys battery', options);
}

export function notifications(options: AdbOptions = {}): string {
  return adbShell('dumpsys notification --noredact | grep -E "pkg=|android.title|android.text"', options);
}

export function dumpsys(service: string, options: AdbOptions = {}): string {
  return adbShell(`dumpsys ${shellQuote(service)}`, options);
}

export function deviceProps(filter?: string, options: AdbOptions = {}): Record<string, string> {
  const output = adbShell('getprop', options);
  const props: Record<string, string> = {};
  const needle = filter?.toLowerCase();

  for (const line of output.split('\n')) {
    const match = line.match(/^\[([^\]]+)\]:\s*\[(.*)\]$/);
    if (match && (!needle || match[1].toLowerCase().includes(needle))) {
      props[match[1]] = match[2];
    }
  }

  return props;
}

export function readProp(key: string, options: AdbOptions = {}): string {
  return getProp(key, options);
}

/** Escape hatch: run an arbitrary command in the device shell. */
export function rawShell(command: string, options: AdbOptions = {}): string {
  return adbShell(command, options);
}
