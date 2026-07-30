import { AdbError, AdbOptions, adb, adbShell, settle, shellQuote } from './adb.js';

export interface PackageEntry {
  packageName: string;
  apkPath?: string;
}

export interface AppDetails {
  packageName: string;
  versionName: string | null;
  versionCode: string | null;
  minSdk: string | null;
  targetSdk: string | null;
  installer: string | null;
  apkPath: string | null;
  grantedPermissions: string[];
  deniedPermissions: string[];
}

export interface LaunchResult {
  packageName: string;
  component: string | null;
  method: 'component' | 'resolved' | 'monkey';
  output: string;
}

/** List installed packages, optionally filtered by a case-insensitive pattern. */
export function listPackages(
  pattern?: string,
  scope: 'all' | 'third-party' | 'system' = 'all',
  options: AdbOptions = {}
): PackageEntry[] {
  const flags = scope === 'third-party' ? ' -3' : scope === 'system' ? ' -s' : '';
  const output = adbShell(`pm list packages -f${flags}`, options);
  const needle = pattern?.trim().toLowerCase();

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('package:'))
    .map((line) => {
      const body = line.slice('package:'.length);
      const separator = body.lastIndexOf('=');

      if (separator === -1) {
        return { packageName: body };
      }

      return { apkPath: body.slice(0, separator), packageName: body.slice(separator + 1) };
    })
    .filter((entry) => !needle || entry.packageName.toLowerCase().includes(needle))
    .sort((a, b) => a.packageName.localeCompare(b.packageName));
}

export function isInstalled(packageName: string, options: AdbOptions = {}): boolean {
  return listPackages(packageName, 'all', options).some(
    (entry) => entry.packageName === packageName
  );
}

/** Resolve the launcher component for a package, when the device reports one. */
export function resolveLaunchComponent(
  packageName: string,
  options: AdbOptions = {}
): string | null {
  try {
    const output = adbShell(
      `cmd package resolve-activity --brief ${shellQuote(packageName)}`,
      options
    );
    const component = output
      .split('\n')
      .map((line) => line.trim())
      .reverse()
      .find((line) => line.includes('/') && line.startsWith(packageName));

    return component || null;
  } catch {
    return null;
  }
}

/** Launch an app. Prefers an explicit or resolved component, falls back to monkey. */
export async function launchApp(
  packageName: string,
  activity?: string,
  options: AdbOptions = {}
): Promise<LaunchResult> {
  if (activity) {
    const component = activity.includes('/') ? activity : `${packageName}/${activity}`;
    const output = adbShell(`am start -n ${shellQuote(component)}`, options);
    await settle(1_000);
    return { packageName, component, method: 'component', output };
  }

  const resolved = resolveLaunchComponent(packageName, options);

  if (resolved) {
    const output = adbShell(`am start -n ${shellQuote(resolved)}`, options);
    await settle(1_000);
    return { packageName, component: resolved, method: 'resolved', output };
  }

  const output = adbShell(`monkey -p ${shellQuote(packageName)} -c android.intent.category.LAUNCHER 1`, options);
  await settle(1_500);
  return { packageName, component: null, method: 'monkey', output };
}

export async function stopApp(packageName: string, options: AdbOptions = {}): Promise<string> {
  adbShell(`am force-stop ${shellQuote(packageName)}`, options);
  await settle();
  return `Stopped ${packageName}`;
}

/** Clear app data — this wipes accounts, caches and databases for the package. */
export async function clearAppData(packageName: string, options: AdbOptions = {}): Promise<string> {
  const output = adbShell(`pm clear ${shellQuote(packageName)}`, options);
  await settle();
  return output.trim() || `Cleared data for ${packageName}`;
}

export async function restartApp(packageName: string, options: AdbOptions = {}): Promise<LaunchResult> {
  await stopApp(packageName, options);
  return launchApp(packageName, undefined, options);
}

export function installApk(
  apkPath: string,
  flags: { reinstall?: boolean; grantPermissions?: boolean; downgrade?: boolean; test?: boolean } = {},
  options: AdbOptions = {}
): string {
  const args = ['install'];
  if (flags.reinstall) args.push('-r');
  if (flags.grantPermissions) args.push('-g');
  if (flags.downgrade) args.push('-d');
  if (flags.test) args.push('-t');
  args.push(apkPath);

  return adb(args, { ...options, timeout: 300_000 });
}

export function uninstallApp(
  packageName: string,
  keepData = false,
  options: AdbOptions = {}
): string {
  const args = ['uninstall'];
  if (keepData) args.push('-k');
  args.push(packageName);

  return adb(args, options);
}

/** The activity currently in the foreground, as reported by activity manager. */
export function currentActivity(options: AdbOptions = {}): string {
  const output = adbShell(
    'dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity"',
    options
  );

  const match = output.match(/([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)/);
  return match ? match[1] : output.trim() || 'No resumed activity found';
}

export function focusedWindow(options: AdbOptions = {}): string {
  const output = adbShell('dumpsys window | grep -E "mCurrentFocus|mFocusedApp"', options);
  return output.trim() || 'No focused window found';
}

export function appPermissions(
  packageName: string,
  options: AdbOptions = {}
): { granted: string[]; denied: string[] } {
  const output = adbShell(`dumpsys package ${shellQuote(packageName)}`, options);
  const granted: string[] = [];
  const denied: string[] = [];

  for (const line of output.split('\n')) {
    const match = line.trim().match(/^(android\.permission\.[A-Z_0-9.]+|[a-z0-9_.]+\.permission\.[A-Z_0-9.]+):\s*granted=(true|false)/);
    if (match) {
      (match[2] === 'true' ? granted : denied).push(match[1]);
    }
  }

  return { granted: Array.from(new Set(granted)), denied: Array.from(new Set(denied)) };
}

export function appInfo(packageName: string, options: AdbOptions = {}): AppDetails {
  const output = adbShell(`dumpsys package ${shellQuote(packageName)}`, options);

  if (!output.includes(packageName)) {
    throw new AdbError(`Package "${packageName}" is not installed on the device`, [
      'shell',
      'dumpsys package',
    ]);
  }

  const pick = (pattern: RegExp): string | null => {
    const match = output.match(pattern);
    return match ? match[1].trim() : null;
  };

  const permissions = appPermissions(packageName, options);

  return {
    packageName,
    versionName: pick(/versionName=([^\s]+)/),
    versionCode: pick(/versionCode=(\d+)/),
    minSdk: pick(/minSdk=(\d+)/),
    targetSdk: pick(/targetSdk=(\d+)/),
    installer: pick(/installerPackageName=([^\s]+)/),
    apkPath: pick(/codePath=([^\s]+)/),
    grantedPermissions: permissions.granted,
    deniedPermissions: permissions.denied,
  };
}

export function grantPermission(
  packageName: string,
  permission: string,
  options: AdbOptions = {}
): string {
  const full = permission.includes('.') ? permission : `android.permission.${permission.toUpperCase()}`;
  adbShell(`pm grant ${shellQuote(packageName)} ${shellQuote(full)}`, options);
  return `Granted ${full} to ${packageName}`;
}

export function revokePermission(
  packageName: string,
  permission: string,
  options: AdbOptions = {}
): string {
  const full = permission.includes('.') ? permission : `android.permission.${permission.toUpperCase()}`;
  adbShell(`pm revoke ${shellQuote(packageName)} ${shellQuote(full)}`, options);
  return `Revoked ${full} from ${packageName}`;
}
