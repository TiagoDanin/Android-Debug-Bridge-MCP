import { AdbError, AdbOptions, adb, adbShell, getProp } from './adb.js';

export interface DeviceEntry {
  serial: string;
  state: string;
  model?: string;
  product?: string;
  device?: string;
  transportId?: string;
  isEmulator: boolean;
}

export interface ScreenSize {
  width: number;
  height: number;
}

export interface DeviceDetails {
  serial: string;
  state: string;
  model: string;
  manufacturer: string;
  brand: string;
  androidVersion: string;
  sdk: string;
  abi: string;
  isEmulator: boolean;
  screen: ScreenSize;
  density: number | null;
  orientation: number | null;
  battery: number | null;
}

/** Parse `adb devices -l` into structured entries. */
export function listDevices(options: AdbOptions = {}): DeviceEntry[] {
  const output = adb(['devices', '-l'], { ...options, hostOnly: true });

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

/**
 * Resolve which device a command should target. Explicit serial wins, then
 * ADB_SERIAL/ANDROID_SERIAL, then the single connected device.
 */
export function resolveDevice(explicit?: string, options: AdbOptions = {}): DeviceEntry {
  const devices = listDevices(options);
  const wanted = explicit || process.env.ADB_SERIAL || process.env.ANDROID_SERIAL;

  if (wanted) {
    const match =
      devices.find((entry) => entry.serial === wanted) ||
      devices.find((entry) => entry.serial.startsWith(wanted));

    if (!match) {
      const available = devices.map((entry) => entry.serial).join(', ') || 'none';
      throw new AdbError(`Device "${wanted}" not found. Connected: ${available}`, ['devices']);
    }

    return match;
  }

  const ready = devices.filter((entry) => entry.state === 'device');

  if (ready.length === 0) {
    const unauthorized = devices.filter((entry) => entry.state !== 'device');
    const hint = unauthorized.length
      ? ` Devices in a non-ready state: ${unauthorized
          .map((entry) => `${entry.serial} (${entry.state})`)
          .join(', ')}.`
      : ' Start an emulator or plug in a device with USB debugging enabled.';
    throw new AdbError(`No ready Android device found.${hint}`, ['devices']);
  }

  if (ready.length > 1) {
    throw new AdbError(
      `Multiple devices connected (${ready
        .map((entry) => entry.serial)
        .join(', ')}). Pass a device explicitly or set ADB_SERIAL.`,
      ['devices']
    );
  }

  return ready[0];
}

/** Screen resolution in pixels, using the override size when one is set. */
export function screenSize(options: AdbOptions = {}): ScreenSize {
  const output = adbShell('wm size', options);
  const override = output.match(/Override size:\s*(\d+)x(\d+)/);
  const physical = output.match(/Physical size:\s*(\d+)x(\d+)/);
  const match = override || physical;

  if (!match) {
    throw new AdbError(`Could not read screen size from "wm size": ${output}`, ['shell', 'wm size']);
  }

  return { width: Number(match[1]), height: Number(match[2]) };
}

function screenDensity(options: AdbOptions = {}): number | null {
  try {
    const output = adbShell('wm density', options);
    const match = output.match(/Override density:\s*(\d+)/) || output.match(/Physical density:\s*(\d+)/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/** Current rotation as degrees (0/90/180/270), or null when unavailable. */
export function screenRotation(options: AdbOptions = {}): number | null {
  try {
    const output = adbShell('settings get system user_rotation', options).trim();
    const value = Number(output);
    return Number.isFinite(value) ? value * 90 : null;
  } catch {
    return null;
  }
}

function batteryLevel(options: AdbOptions = {}): number | null {
  try {
    const output = adbShell('dumpsys battery', options);
    const match = output.match(/level:\s*(\d+)/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/** Full device fingerprint: build info, screen, battery. */
export function deviceInfo(options: AdbOptions = {}): DeviceDetails {
  const entry = resolveDevice(options.device, options);
  const scoped: AdbOptions = { ...options, device: entry.serial };

  return {
    serial: entry.serial,
    state: entry.state,
    model: getProp('ro.product.model', scoped),
    manufacturer: getProp('ro.product.manufacturer', scoped),
    brand: getProp('ro.product.brand', scoped),
    androidVersion: getProp('ro.build.version.release', scoped),
    sdk: getProp('ro.build.version.sdk', scoped),
    abi: getProp('ro.product.cpu.abi', scoped),
    isEmulator: entry.isEmulator || getProp('ro.build.characteristics', scoped).includes('emulator'),
    screen: screenSize(scoped),
    density: screenDensity(scoped),
    orientation: screenRotation(scoped),
    battery: batteryLevel(scoped),
  };
}

export function connectDevice(address: string, options: AdbOptions = {}): string {
  return adb(['connect', address], { ...options, hostOnly: true });
}

export function disconnectDevice(address: string | undefined, options: AdbOptions = {}): string {
  return adb(address ? ['disconnect', address] : ['disconnect'], { ...options, hostOnly: true });
}

export function waitForDevice(options: AdbOptions = {}): string {
  adb(['wait-for-device'], options);
  return 'Device is online';
}

/** Wait until the package manager and boot animation report a usable system. */
export async function waitForBoot(timeoutMs = 120_000, options: AdbOptions = {}): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  adb(['wait-for-device'], options);

  while (Date.now() < deadline) {
    try {
      const completed = adbShell('getprop sys.boot_completed', options).trim();
      const animation = adbShell('getprop init.svc.bootanim', options).trim();
      if (completed === '1' && animation !== 'running') {
        return 'Boot completed';
      }
    } catch {
      // device still coming up — keep polling
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new AdbError(`Device did not finish booting within ${timeoutMs}ms`, ['wait-for-device']);
}

export function rebootDevice(mode: string | undefined, options: AdbOptions = {}): string {
  adb(mode ? ['reboot', mode] : ['reboot'], options);
  return mode ? `Reboot requested (${mode})` : 'Reboot requested';
}
