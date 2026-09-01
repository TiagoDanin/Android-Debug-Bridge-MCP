import { AdbError, AdbOptions, adb, cachedDevices, describeDevice, settle } from './adb.js';
import { resolveDevice } from './device.js';

/**
 * The emulator console (`adb emu …`) — the side channel that reaches the
 * virtual hardware an `adb shell` cannot touch: the fingerprint reader,
 * the modem, the GPS. Physical devices have none of it, so every call here
 * checks the target first and fails with something better than adb's
 * "error: no emulator detected".
 */

export interface EmuResult {
  serial: string;
  command: string;
  output: string;
}

/** Resolve the target and refuse anything that is not an emulator. */
export function requireEmulator(options: AdbOptions = {}) {
  const entry = resolveDevice(options.device, options);

  if (!entry.isEmulator) {
    const emulators = cachedDevices().filter((candidate) => candidate.isEmulator);
    const hint = emulators.length
      ? ` Running emulators: ${emulators.map(describeDevice).join(', ')}.`
      : ' Start an emulator (the console is not available on physical devices).';

    throw new AdbError(`"${entry.serial}" is not an emulator.${hint}`, ['emu']);
  }

  return entry;
}

/**
 * Send a raw command to the emulator console, e.g. `['finger', 'touch', '1']`
 * for `adb -s emulator-5554 emu finger touch 1`.
 */
export function emuConsole(args: string[], options: AdbOptions = {}): EmuResult {
  const command = args.filter((arg) => arg.length > 0);

  if (command.length === 0) {
    throw new Error('emu expects a console command, e.g. "finger touch 1"');
  }

  const entry = requireEmulator(options);
  const output = adb(['emu', ...command], { ...options, device: entry.serial });

  return {
    serial: entry.serial,
    command: command.join(' '),
    // The console answers "OK" on success and prints "KO: …" on failure.
    output: output.replace(/\bOK\s*$/, '').trim(),
  };
}

/**
 * Touch the virtual fingerprint sensor with an enrolled finger id.
 *
 * The AVD must already have that finger enrolled (Settings → Security →
 * Fingerprint); the sensor rejects ids that were never registered.
 */
export async function fingerTouch(
  fingerId: number | string = 1,
  options: AdbOptions = {}
): Promise<EmuResult & { fingerId: string }> {
  const id = String(fingerId).trim();

  if (!/^\d+$/.test(id)) {
    throw new Error(`finger id must be a positive integer, got "${fingerId}"`);
  }

  const result = emuConsole(['finger', 'touch', id], options);
  await settle();

  return { ...result, fingerId: id };
}

/** Lift the virtual finger off the sensor. */
export async function fingerRemove(options: AdbOptions = {}): Promise<EmuResult> {
  const result = emuConsole(['finger', 'remove'], options);
  await settle();
  return result;
}
