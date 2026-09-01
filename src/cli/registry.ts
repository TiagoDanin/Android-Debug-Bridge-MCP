import * as path from 'path';
import { AdbOptions, adbPath, adb, cachedDevices, describeDevice } from '../core/adb.js';
import {
  appInfo,
  clearAppData,
  currentActivity,
  focusedWindow,
  grantPermission,
  installApk,
  launchApp,
  listPackages,
  restartApp,
  revokePermission,
  stopApp,
  uninstallApp,
} from '../core/app.js';
import { createTestFolder, listArtifacts } from '../core/artifacts.js';
import {
  connectDevice,
  defaultDevice,
  deviceInfo,
  disconnectDevice,
  listDevices,
  rebootDevice,
  waitForBoot,
} from '../core/device.js';
import { CoordinateMode, clearScreenSizeCache } from '../core/geometry.js';
import { ImageFormat, compressionDefaults, describeCompression, hasSharp } from '../core/image.js';
import {
  KEY_CODES,
  ScrollDirection,
  clearText,
  doubleTap,
  inputText,
  longPress,
  pressKey,
  scroll,
  swipe,
  tap,
} from '../core/input.js';
import {
  artifactRoot,
  captureScreenshot,
  recordScreen,
  rotateScreen,
  screenState,
  screenshotPath,
  sleepScreen,
  unlockWithPin,
  wakeScreen,
} from '../core/screen.js';
import {
  batteryInfo,
  clearLogcat,
  connectivityState,
  deviceProps,
  getSetting,
  listProcesses,
  memoryUsage,
  notifications,
  openDeeplink,
  pullFile,
  pushFile,
  putSetting,
  rawShell,
  readLogcat,
  sendBroadcast,
  setToggle,
} from '../core/system.js';
import {
  describeElement,
  dumpUI,
  findOnScreen,
  formatMatches,
  formatUI,
  resolveTapPoint,
  waitForElement,
  MatchedElement,
  FindQuery,
} from '../core/ui.js';
import { workingDirectoryStatus } from '../utils/cwd.js';
import { FlagValue, flagBoolean, flagNumber, flagString, parseToggleValue } from './args.js';
import { CommandResult } from './output.js';
import { listSkills, readSkill } from './skills.js';

export interface CommandContext {
  positionals: string[];
  flags: Record<string, FlagValue>;
  repeated: Record<string, string[]>;
  adb: AdbOptions;
  mode: CoordinateMode;
  json: boolean;
}

export interface CommandSpec {
  usage: string;
  summary: string;
  run: (ctx: CommandContext) => Promise<CommandResult>;
}

export interface CommandGroup {
  summary: string;
  commands: Record<string, CommandSpec>;
}

function required(ctx: CommandContext, index: number, name: string): string {
  const value = ctx.positionals[index];

  if (value === undefined || value === '') {
    throw new Error(`missing required argument <${name}>`);
  }

  return value;
}

function requiredNumber(ctx: CommandContext, index: number, name: string): number {
  const value = Number(required(ctx, index, name));

  if (!Number.isFinite(value)) {
    throw new Error(`<${name}> must be a number, got "${ctx.positionals[index]}"`);
  }

  return value;
}

function joinRest(ctx: CommandContext, index: number, name: string): string {
  const rest = ctx.positionals.slice(index).join(' ');

  if (!rest) {
    throw new Error(`missing required argument <${name}>`);
  }

  return rest;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function buildQuery(ctx: CommandContext, queryIndex = 0): FindQuery {
  const positional = ctx.positionals.slice(queryIndex).join(' ') || undefined;

  return {
    query: flagString(ctx.flags, 'query') ?? positional,
    text: flagString(ctx.flags, 'text'),
    contentDesc: flagString(ctx.flags, 'desc') ?? flagString(ctx.flags, 'content-desc'),
    resourceId: flagString(ctx.flags, 'id') ?? flagString(ctx.flags, 'resource-id'),
    className: flagString(ctx.flags, 'class'),
    type: flagString(ctx.flags, 'type'),
    clickableOnly: flagBoolean(ctx.flags, 'clickable'),
    exact: flagBoolean(ctx.flags, 'exact'),
  };
}

function serializeMatch(element: MatchedElement) {
  return {
    label: describeElement(element),
    type: element.type,
    text: element.text,
    contentDesc: element.contentDesc,
    resourceId: element.resourceId,
    className: element.className,
    center: element.center,
    bounds: element.bounds,
    clickable: element.clickable,
    enabled: element.enabled,
    scrollable: element.scrollable,
    checked: element.checked,
    matchedOn: element.matchedOn,
    score: element.score,
  };
}

export const registry: Record<string, CommandGroup> = {
  device: {
    summary: 'Inspect, select and connect devices',
    commands: {
      list: {
        usage: 'device list [--refresh]',
        summary: 'List connected devices and show the default target',
        run: async (ctx) => {
          const devices = cachedDevices(flagBoolean(ctx.flags, 'refresh'));
          const target = defaultDevice();
          const summary =
            devices.length === 0
              ? 'No devices found'
              : devices
                  .map(
                    (entry) =>
                      `${entry.serial === target?.serial ? '*' : ' '} ${entry.serial}\t${entry.state}\t${entry.model ?? '-'}${entry.isEmulator ? '\t[emulator]' : ''}`
                  )
                  .join('\n');

          return {
            summary: devices.length > 1 && !target
              ? `${summary}\n\nNo default target: pass --device <serial|prefix|model> or set ADB_SERIAL.`
              : summary,
            // Stays an array so `.data[]` keeps working; the target is a field.
            data: devices.map((entry) => ({ ...entry, default: entry.serial === target?.serial })),
          };
        },
      },
      info: {
        usage: 'device info',
        summary: 'Show model, Android version, screen size and battery',
        run: async (ctx) => {
          const info = deviceInfo(ctx.adb);
          const summary = [
            `serial       ${info.serial}`,
            `model        ${info.manufacturer} ${info.model}`,
            `android      ${info.androidVersion} (SDK ${info.sdk}, ${info.abi})`,
            `screen       ${info.screen.width}x${info.screen.height}${info.density ? ` @ ${info.density}dpi` : ''}`,
            `rotation     ${info.orientation ?? 'unknown'}`,
            `battery      ${info.battery ?? 'unknown'}%`,
            `emulator     ${info.isEmulator ? 'yes' : 'no'}`,
          ].join('\n');

          return { summary, data: info };
        },
      },
      connect: {
        usage: 'device connect <host:port>',
        summary: 'Connect to a device over TCP/IP',
        run: async (ctx) => {
          const address = required(ctx, 0, 'host:port');
          clearScreenSizeCache();
          const output = connectDevice(address, ctx.adb);
          return { summary: output, data: { address, output } };
        },
      },
      disconnect: {
        usage: 'device disconnect [host:port]',
        summary: 'Disconnect one or all TCP/IP devices',
        run: async (ctx) => {
          clearScreenSizeCache();
          const address = ctx.positionals[0];
          const output = disconnectDevice(address, ctx.adb);
          return { summary: output || 'Disconnected', data: { address: address ?? null, output } };
        },
      },
      wait: {
        usage: 'device wait [--timeout <ms>]',
        summary: 'Wait until the device is online and booted',
        run: async (ctx) => {
          const timeout = flagNumber(ctx.flags, 'timeout') ?? 120_000;
          const summary = await waitForBoot(timeout, ctx.adb);
          return { summary, data: { booted: true, timeoutMs: timeout } };
        },
      },
      reboot: {
        usage: 'device reboot [bootloader|recovery|sideload]',
        summary: 'Reboot the device',
        run: async (ctx) => {
          clearScreenSizeCache();
          const mode = ctx.positionals[0];
          return { summary: rebootDevice(mode, ctx.adb), data: { mode: mode ?? 'normal' } };
        },
      },
    },
  },

  ui: {
    summary: 'Read the accessibility tree and act on elements',
    commands: {
      dump: {
        usage: 'ui dump [--raw] [--json]',
        summary: 'Dump the current screen as structured elements',
        run: async (ctx) => {
          const { xml, tree } = await dumpUI(ctx.adb);
          const raw = flagBoolean(ctx.flags, 'raw');

          return {
            summary: raw ? `${formatUI(tree)}\n=== RAW XML ===\n${xml}` : formatUI(tree),
            data: {
              counts: {
                total: tree.all.length,
                texts: tree.texts.length,
                buttons: tree.buttons.length,
                inputs: tree.inputs.length,
                switches: tree.switches.length,
                scrollables: tree.scrollables.length,
              },
              elements: tree.all.map((element) => ({
                label: describeElement(element),
                type: element.type,
                text: element.text,
                contentDesc: element.contentDesc,
                resourceId: element.resourceId,
                className: element.className,
                center: element.center,
                bounds: element.bounds,
                clickable: element.clickable,
                enabled: element.enabled,
                scrollable: element.scrollable,
                checked: element.checked,
              })),
              ...(raw ? { xml } : {}),
            },
          };
        },
      },
      find: {
        usage: 'ui find <query> [--type <t>] [--clickable] [--exact] [--limit <n>]',
        summary: 'Find elements by text, description or resource id',
        run: async (ctx) => {
          const limit = flagNumber(ctx.flags, 'limit') ?? 20;
          const { matches } = await findOnScreen(buildQuery(ctx), ctx.adb);

          return {
            summary: formatMatches(matches, limit),
            data: { count: matches.length, matches: matches.slice(0, limit).map(serializeMatch) },
          };
        },
      },
      tap: {
        usage: 'ui tap <query> [--index <n>] [--exact] [--force]',
        summary: 'Tap the element matching a query — resilient to layout changes',
        run: async (ctx) => {
          const index = flagNumber(ctx.flags, 'index') ?? 0;
          const query = buildQuery(ctx);

          if (!query.query && !query.text && !query.resourceId && !query.contentDesc) {
            throw new Error('missing required argument <query>');
          }

          const { matches, tree } = await findOnScreen(query, ctx.adb);

          if (matches.length === 0) {
            throw new Error(`no element matches "${query.query ?? JSON.stringify(query)}"`);
          }

          const target = matches[index];

          if (!target) {
            throw new Error(`--index ${index} is out of range (${matches.length} matches)`);
          }

          const plan = resolveTapPoint(target, tree.all);

          if (plan.occludedBy && !flagBoolean(ctx.flags, 'force')) {
            throw new Error(
              `"${describeElement(target)}" is covered by "${describeElement(plan.occludedBy)}" at (${plan.point.x}, ${plan.point.y}) — tapping there would hit the overlay instead. Scroll the element clear, act on the overlay, or pass --force to tap anyway.`
            );
          }

          const result = await tap(plan.point.x, plan.point.y, 'pixels', ctx.adb);
          const note =
            plan.strategy === 'offset'
              ? ' (offset from center, which was covered)'
              : plan.occludedBy
                ? ' (forced through an overlay)'
                : '';

          return {
            summary: `tapped "${describeElement(target)}" at (${result.point.x}, ${result.point.y})${note}`,
            data: {
              tapped: serializeMatch(target),
              point: { x: result.point.x, y: result.point.y },
              strategy: plan.strategy,
              occludedBy: plan.occludedBy ? describeElement(plan.occludedBy) : null,
              candidates: matches.length,
            },
          };
        },
      },
      wait: {
        usage: 'ui wait <query> [--timeout <ms>] [--interval <ms>]',
        summary: 'Wait until an element appears',
        run: async (ctx) => {
          const timeout = flagNumber(ctx.flags, 'timeout') ?? 10_000;
          const interval = flagNumber(ctx.flags, 'interval') ?? 500;
          const { matches, waitedMs } = await waitForElement(buildQuery(ctx), timeout, interval, ctx.adb);

          return {
            summary: `found after ${waitedMs}ms\n${formatMatches(matches, 5)}`,
            data: { waitedMs, matches: matches.slice(0, 5).map(serializeMatch) },
          };
        },
      },
    },
  },

  input: {
    summary: 'Taps, gestures, typing and hardware keys',
    commands: {
      tap: {
        usage: 'input tap <x> <y> [--px|--norm]',
        summary: 'Tap a point (0..1 fractions by default)',
        run: async (ctx) => {
          const x = requiredNumber(ctx, 0, 'x');
          const y = requiredNumber(ctx, 1, 'y');
          const result = await tap(x, y, ctx.mode, ctx.adb);

          return {
            summary: `tapped (${result.point.x}, ${result.point.y})`,
            data: { point: { x: result.point.x, y: result.point.y }, mode: result.point.mode, screen: result.point.screen },
          };
        },
      },
      'double-tap': {
        usage: 'input double-tap <x> <y>',
        summary: 'Double tap a point',
        run: async (ctx) => {
          const x = requiredNumber(ctx, 0, 'x');
          const y = requiredNumber(ctx, 1, 'y');
          const result = await doubleTap(x, y, ctx.mode, ctx.adb);

          return {
            summary: `double tapped (${result.point.x}, ${result.point.y})`,
            data: { point: { x: result.point.x, y: result.point.y } },
          };
        },
      },
      'long-press': {
        usage: 'input long-press <x> <y> [--duration <ms>]',
        summary: 'Press and hold a point',
        run: async (ctx) => {
          const x = requiredNumber(ctx, 0, 'x');
          const y = requiredNumber(ctx, 1, 'y');
          const duration = flagNumber(ctx.flags, 'duration') ?? 800;
          const result = await longPress(x, y, duration, ctx.mode, ctx.adb);

          return {
            summary: `long pressed (${result.from.x}, ${result.from.y}) for ${duration}ms`,
            data: { point: { x: result.from.x, y: result.from.y }, durationMs: duration },
          };
        },
      },
      swipe: {
        usage: 'input swipe <x1> <y1> <x2> <y2> [--duration <ms>]',
        summary: 'Swipe between two points',
        run: async (ctx) => {
          const x1 = requiredNumber(ctx, 0, 'x1');
          const y1 = requiredNumber(ctx, 1, 'y1');
          const x2 = requiredNumber(ctx, 2, 'x2');
          const y2 = requiredNumber(ctx, 3, 'y2');
          const duration = flagNumber(ctx.flags, 'duration') ?? 300;
          const result = await swipe(x1, y1, x2, y2, duration, ctx.mode, ctx.adb);

          return {
            summary: `swiped (${result.from.x}, ${result.from.y}) → (${result.to.x}, ${result.to.y}) in ${duration}ms`,
            data: {
              from: { x: result.from.x, y: result.from.y },
              to: { x: result.to.x, y: result.to.y },
              durationMs: duration,
            },
          };
        },
      },
      scroll: {
        usage: 'input scroll <up|down|left|right> [--amount <0.05..0.9>] [--duration <ms>]',
        summary: 'Scroll the screen',
        run: async (ctx) => {
          const direction = required(ctx, 0, 'direction') as ScrollDirection;
          const amount = flagNumber(ctx.flags, 'amount') ?? 0.6;
          const duration = flagNumber(ctx.flags, 'duration') ?? 300;
          const result = await scroll(direction, amount, duration, ctx.adb);

          return {
            summary: `scrolled ${direction} (${result.from.x}, ${result.from.y}) → (${result.to.x}, ${result.to.y})`,
            data: {
              direction,
              amount,
              from: { x: result.from.x, y: result.from.y },
              to: { x: result.to.x, y: result.to.y },
            },
          };
        },
      },
      text: {
        usage: 'input text <text...> [--submit]',
        summary: 'Type into the focused field (ASCII only)',
        run: async (ctx) => {
          const text = flagString(ctx.flags, 'value') ?? joinRest(ctx, 0, 'text');
          const submit = flagBoolean(ctx.flags, 'submit');
          const result = await inputText(text, submit, ctx.adb);

          const warning = result.unsupported.length
            ? ` (unsupported characters: ${result.unsupported.join(' ')})`
            : '';

          return {
            summary: `typed "${text}"${submit ? ' + ENTER' : ''}${warning}`,
            data: result,
          };
        },
      },
      key: {
        usage: 'input key <KEY|keycode>',
        summary: `Send a key event (${Object.keys(KEY_CODES).slice(0, 8).join(', ')}…)`,
        run: async (ctx) => {
          const key = required(ctx, 0, 'key');
          const result = await pressKey(key, ctx.adb);

          return { summary: `sent ${result.key} (${result.code})`, data: result };
        },
      },
      clear: {
        usage: 'input clear [--count <n>]',
        summary: 'Clear the focused text field',
        run: async (ctx) => {
          const count = flagNumber(ctx.flags, 'count') ?? 60;
          const result = await clearText(count, ctx.adb);

          return { summary: `cleared field (${result.deletes} backspaces)`, data: result };
        },
      },
      keys: {
        usage: 'input keys <KEY> [KEY...]',
        summary: 'Send several key events in order',
        run: async (ctx) => {
          if (ctx.positionals.length === 0) {
            throw new Error('missing required argument <KEY>');
          }

          const sent = [];
          for (const key of ctx.positionals) {
            sent.push(await pressKey(key, ctx.adb));
          }

          return { summary: `sent ${sent.map((entry) => entry.key).join(', ')}`, data: sent };
        },
      },
    },
  },

  app: {
    summary: 'Install, launch and inspect apps',
    commands: {
      list: {
        usage: 'app list [pattern] [--scope all|third-party|system]',
        summary: 'List installed packages',
        run: async (ctx) => {
          const pattern = ctx.positionals[0];
          const scopeFlag = flagString(ctx.flags, 'scope');
          const scope = (flagBoolean(ctx.flags, 'third-party')
            ? 'third-party'
            : flagBoolean(ctx.flags, 'system')
              ? 'system'
              : scopeFlag ?? 'all') as 'all' | 'third-party' | 'system';

          const packages = listPackages(pattern, scope, ctx.adb);

          return {
            summary:
              packages.length === 0
                ? `No packages matching "${pattern ?? ''}"`
                : packages.map((entry) => entry.packageName).join('\n'),
            data: { count: packages.length, packages },
          };
        },
      },
      launch: {
        usage: 'app launch <package> [activity]',
        summary: 'Launch an app, resolving its launcher activity',
        run: async (ctx) => {
          const packageName = required(ctx, 0, 'package');
          const activity = ctx.positionals[1];
          const result = await launchApp(packageName, activity, ctx.adb);

          return {
            summary: `launched ${packageName}${result.component ? ` → ${result.component}` : ''} (${result.method})`,
            data: result,
          };
        },
      },
      stop: {
        usage: 'app stop <package>',
        summary: 'Force-stop an app',
        run: async (ctx) => {
          const packageName = required(ctx, 0, 'package');
          return { summary: await stopApp(packageName, ctx.adb), data: { packageName, stopped: true } };
        },
      },
      restart: {
        usage: 'app restart <package>',
        summary: 'Force-stop and relaunch an app',
        run: async (ctx) => {
          const packageName = required(ctx, 0, 'package');
          const result = await restartApp(packageName, ctx.adb);
          return { summary: `restarted ${packageName}`, data: result };
        },
      },
      clear: {
        usage: 'app clear <package>',
        summary: 'Clear app data (destructive: back to first-install state)',
        run: async (ctx) => {
          const packageName = required(ctx, 0, 'package');
          return {
            summary: await clearAppData(packageName, ctx.adb),
            data: { packageName, cleared: true },
          };
        },
      },
      info: {
        usage: 'app info <package>',
        summary: 'Show version, SDK levels and permissions',
        run: async (ctx) => {
          const packageName = required(ctx, 0, 'package');
          const info = appInfo(packageName, ctx.adb);
          const summary = [
            `package      ${info.packageName}`,
            `version      ${info.versionName ?? 'unknown'} (code ${info.versionCode ?? 'unknown'})`,
            `sdk          min ${info.minSdk ?? '?'} / target ${info.targetSdk ?? '?'}`,
            `installer    ${info.installer ?? 'none'}`,
            `apk          ${info.apkPath ?? 'unknown'}`,
            `permissions  ${info.grantedPermissions.length} granted / ${info.deniedPermissions.length} denied`,
          ].join('\n');

          return { summary, data: info };
        },
      },
      install: {
        usage: 'app install <apk> [--reinstall] [--grant] [--downgrade]',
        summary: 'Install an APK',
        run: async (ctx) => {
          const apk = required(ctx, 0, 'apk');
          const output = installApk(
            apk,
            {
              reinstall: flagBoolean(ctx.flags, 'reinstall'),
              grantPermissions: flagBoolean(ctx.flags, 'grant'),
              downgrade: flagBoolean(ctx.flags, 'downgrade'),
              test: flagBoolean(ctx.flags, 'test-apk'),
            },
            ctx.adb
          );

          return { summary: output || `installed ${apk}`, data: { apk, output } };
        },
      },
      uninstall: {
        usage: 'app uninstall <package> [--keep-data]',
        summary: 'Uninstall an app',
        run: async (ctx) => {
          const packageName = required(ctx, 0, 'package');
          const output = uninstallApp(packageName, flagBoolean(ctx.flags, 'keep-data'), ctx.adb);
          return { summary: output || `uninstalled ${packageName}`, data: { packageName, output } };
        },
      },
      grant: {
        usage: 'app grant <package> <permission>',
        summary: 'Grant a runtime permission',
        run: async (ctx) => {
          const packageName = required(ctx, 0, 'package');
          const permission = required(ctx, 1, 'permission');
          return {
            summary: grantPermission(packageName, permission, ctx.adb),
            data: { packageName, permission, granted: true },
          };
        },
      },
      revoke: {
        usage: 'app revoke <package> <permission>',
        summary: 'Revoke a runtime permission',
        run: async (ctx) => {
          const packageName = required(ctx, 0, 'package');
          const permission = required(ctx, 1, 'permission');
          return {
            summary: revokePermission(packageName, permission, ctx.adb),
            data: { packageName, permission, granted: false },
          };
        },
      },
      current: {
        usage: 'app current',
        summary: 'Show the foreground activity and focused window',
        run: async (ctx) => {
          const activity = currentActivity(ctx.adb);
          const window = focusedWindow(ctx.adb);

          return {
            summary: `activity  ${activity}\nwindow    ${window.split('\n')[0] ?? ''}`,
            data: { activity, window },
          };
        },
      },
    },
  },

  screen: {
    summary: 'Screenshots, recording, rotation and lock state',
    commands: {
      shot: {
        usage:
          'screen shot [--out <file>] [--test <name>] [--step <name>] [--base64] [--max-width <px>] [--quality <1..100>] [--format auto|jpeg|webp|png|none] [--no-compress] [--save-compressed]',
        summary: 'Capture a screenshot (PNG on disk, compressed copy in the output)',
        run: async (ctx) => {
          const explicit = flagString(ctx.flags, 'out') ?? ctx.positionals[0];
          const testName = flagString(ctx.flags, 'test');
          const stepName = flagString(ctx.flags, 'step');
          const target =
            explicit ??
            screenshotPath(testName, stepName) ??
            path.join(artifactRoot(), `screenshot-${timestamp()}.png`);

          const result = await captureScreenshot(target, ctx.adb, {
            maxWidth: flagNumber(ctx.flags, 'max-width'),
            quality: flagNumber(ctx.flags, 'quality'),
            format: flagString(ctx.flags, 'format') as ImageFormat | undefined,
            compress: !flagBoolean(ctx.flags, 'no-compress'),
            saveCompressed: flagBoolean(ctx.flags, 'save-compressed'),
          });

          const wantsBase64 = flagBoolean(ctx.flags, 'base64');
          const lines = [
            `${result.path} (${result.originalBytes} bytes, ${result.screen.width}x${result.screen.height})`,
            ...(result.compressedPath ? [`${result.compressedPath}`] : []),
            `returned ${describeCompression(result.image)}`,
          ];

          return {
            summary: wantsBase64 ? `${lines.join('\n')}\n${result.base64}` : lines.join('\n'),
            data: {
              path: result.path,
              compressedPath: result.compressedPath,
              bytes: result.bytes,
              originalBytes: result.originalBytes,
              mimeType: result.mimeType,
              screen: result.screen,
              compression: {
                engine: result.image.engine,
                width: result.image.width,
                height: result.image.height,
                ...(result.image.note ? { note: result.image.note } : {}),
              },
              ...(wantsBase64 ? { base64: result.base64 } : {}),
            },
          };
        },
      },
      record: {
        usage: 'screen record <seconds> --out <file.mp4>',
        summary: 'Record the screen and pull the MP4',
        run: async (ctx) => {
          const seconds = requiredNumber(ctx, 0, 'seconds');
          const out =
            flagString(ctx.flags, 'out') ??
            path.join(artifactRoot(), `recording-${timestamp()}.mp4`);
          const result = await recordScreen(seconds, out, ctx.adb);

          return { summary: `${result.path} (${result.durationSeconds}s, ${result.bytes} bytes)`, data: result };
        },
      },
      rotate: {
        usage: 'screen rotate <auto|0|90|180|270>',
        summary: 'Set the screen orientation',
        run: async (ctx) => {
          const value = required(ctx, 0, 'orientation');
          const orientation = value === 'auto' ? 'auto' : (Number(value) as 0 | 90 | 180 | 270);
          const result = await rotateScreen(orientation, ctx.adb);

          return { summary: `orientation set to ${result.orientation}`, data: result };
        },
      },
      state: {
        usage: 'screen state',
        summary: 'Report size, rotation, awake and lock state',
        run: async (ctx) => {
          const state = screenState(ctx.adb);
          const summary = [
            `size      ${state.screen.width}x${state.screen.height}`,
            `rotation  ${state.rotation ?? 'unknown'}`,
            `display   ${state.awake ? 'awake' : 'asleep'}`,
            `keyguard  ${state.locked ? 'locked' : 'unlocked'}`,
          ].join('\n');

          return { summary, data: state };
        },
      },
      wake: {
        usage: 'screen wake',
        summary: 'Wake the display and dismiss the keyguard swipe',
        run: async (ctx) => {
          const result = await wakeScreen(ctx.adb);
          return { summary: result.awake ? 'screen awake' : 'wake sent, display still asleep', data: result };
        },
      },
      sleep: {
        usage: 'screen sleep',
        summary: 'Turn the display off',
        run: async (ctx) => {
          const result = await sleepScreen(ctx.adb);
          return { summary: result.awake ? 'sleep sent, display still awake' : 'screen off', data: result };
        },
      },
      unlock: {
        usage: 'screen unlock <pin>',
        summary: 'Wake, swipe and type a numeric PIN',
        run: async (ctx) => {
          const pin = required(ctx, 0, 'pin');
          const result = await unlockWithPin(pin, ctx.adb);
          return { summary: result.unlocked ? 'device unlocked' : 'still locked', data: result };
        },
      },
    },
  },

  system: {
    summary: 'Connectivity, logs, files, settings and raw shell',
    commands: {
      wifi: {
        usage: 'system wifi <on|off>',
        summary: 'Toggle Wi-Fi',
        run: async (ctx) => {
          const enabled = parseToggleValue(ctx.positionals[0], 'system wifi');
          return { summary: await setToggle('wifi', enabled, ctx.adb), data: { wifi: enabled } };
        },
      },
      data: {
        usage: 'system data <on|off>',
        summary: 'Toggle mobile data',
        run: async (ctx) => {
          const enabled = parseToggleValue(ctx.positionals[0], 'system data');
          return { summary: await setToggle('data', enabled, ctx.adb), data: { data: enabled } };
        },
      },
      airplane: {
        usage: 'system airplane <on|off>',
        summary: 'Toggle airplane mode',
        run: async (ctx) => {
          const enabled = parseToggleValue(ctx.positionals[0], 'system airplane');
          return { summary: await setToggle('airplane', enabled, ctx.adb), data: { airplane: enabled } };
        },
      },
      connectivity: {
        usage: 'system connectivity',
        summary: 'Read Wi-Fi, data and airplane state',
        run: async (ctx) => {
          const state = connectivityState(ctx.adb);
          const describe = (value: boolean | null) => (value === null ? 'unknown' : value ? 'on' : 'off');

          return {
            summary: `wifi ${describe(state.wifi)} | data ${describe(state.data)} | airplane ${describe(state.airplane)}`,
            data: state,
          };
        },
      },
      logcat: {
        usage: 'system logcat [--lines <n>] [--filter <text>] [--priority <V|D|I|W|E|F>] [--package <pkg>] [--clear]',
        summary: 'Read the logcat buffer',
        run: async (ctx) => {
          const output = readLogcat(
            {
              lines: flagNumber(ctx.flags, 'lines'),
              filter: flagString(ctx.flags, 'filter'),
              priority: flagString(ctx.flags, 'priority'),
              packageName: flagString(ctx.flags, 'package'),
              clear: flagBoolean(ctx.flags, 'clear'),
            },
            ctx.adb
          );

          const lines = output.split('\n').filter((line) => line.trim().length > 0);
          return {
            summary: output.trim() || '(logcat buffer empty for these filters)',
            data: { lineCount: lines.length, lines },
          };
        },
      },
      'clear-logcat': {
        usage: 'system clear-logcat',
        summary: 'Clear the logcat buffer',
        run: async (ctx) => ({ summary: clearLogcat(ctx.adb), data: { cleared: true } }),
      },
      deeplink: {
        usage: 'system deeplink <url> [--package <pkg>]',
        summary: 'Open a URL or deeplink',
        run: async (ctx) => {
          const url = required(ctx, 0, 'url');
          const output = await openDeeplink(url, flagString(ctx.flags, 'package'), ctx.adb);
          return { summary: output, data: { url, output } };
        },
      },
      broadcast: {
        usage: 'system broadcast <action> [--extra key=value]…',
        summary: 'Broadcast an intent',
        run: async (ctx) => {
          const action = required(ctx, 0, 'action');
          const extras: Record<string, string> = {};

          for (const entry of ctx.repeated.extra ?? []) {
            const separator = entry.indexOf('=');
            if (separator === -1) {
              throw new Error(`--extra expects key=value, got "${entry}"`);
            }
            extras[entry.slice(0, separator)] = entry.slice(separator + 1);
          }

          const output = await sendBroadcast(action, extras, ctx.adb);
          return { summary: output || `broadcast ${action}`, data: { action, extras, output } };
        },
      },
      push: {
        usage: 'system push <local> <remote>',
        summary: 'Push a file to the device',
        run: async (ctx) => {
          const local = required(ctx, 0, 'local');
          const remote = required(ctx, 1, 'remote');
          const output = pushFile(local, remote, ctx.adb);
          return { summary: output, data: { local, remote, output } };
        },
      },
      pull: {
        usage: 'system pull <remote> <local>',
        summary: 'Pull a file from the device',
        run: async (ctx) => {
          const remote = required(ctx, 0, 'remote');
          const local = required(ctx, 1, 'local');
          const output = pullFile(remote, local, ctx.adb);
          return { summary: output, data: { remote, local, output } };
        },
      },
      setting: {
        usage: 'system setting <get|put> <system|secure|global> <key> [value]',
        summary: 'Read or write an Android setting',
        run: async (ctx) => {
          const action = required(ctx, 0, 'get|put');
          const namespace = required(ctx, 1, 'namespace') as 'system' | 'secure' | 'global';
          const key = required(ctx, 2, 'key');

          if (action === 'get') {
            const value = getSetting(namespace, key, ctx.adb);
            return { summary: `${namespace}.${key} = ${value || '(unset)'}`, data: { namespace, key, value } };
          }

          if (action === 'put') {
            const value = required(ctx, 3, 'value');
            return {
              summary: putSetting(namespace, key, value, ctx.adb),
              data: { namespace, key, value },
            };
          }

          throw new Error(`unknown action "${action}" — use get or put`);
        },
      },
      props: {
        usage: 'system props [filter]',
        summary: 'Read system properties',
        run: async (ctx) => {
          const props = deviceProps(ctx.positionals[0], ctx.adb);
          const entries = Object.entries(props);

          return {
            summary: entries.map(([key, value]) => `${key}=${value}`).join('\n') || '(no properties matched)',
            data: props,
          };
        },
      },
      processes: {
        usage: 'system processes [filter]',
        summary: 'List running processes',
        run: async (ctx) => {
          const output = listProcesses(ctx.positionals[0], ctx.adb);
          return { summary: output, data: { output } };
        },
      },
      memory: {
        usage: 'system memory <package>',
        summary: 'Memory usage report for an app',
        run: async (ctx) => {
          const packageName = required(ctx, 0, 'package');
          const output = memoryUsage(packageName, ctx.adb);
          return { summary: output, data: { packageName, output } };
        },
      },
      battery: {
        usage: 'system battery',
        summary: 'Battery status report',
        run: async (ctx) => {
          const output = batteryInfo(ctx.adb);
          return { summary: output, data: { output } };
        },
      },
      notifications: {
        usage: 'system notifications',
        summary: 'List posted notifications',
        run: async (ctx) => {
          const output = notifications(ctx.adb);
          return { summary: output.trim() || '(no notifications)', data: { output } };
        },
      },
      shell: {
        usage: 'system shell <command...>',
        summary: 'Run a raw command in the device shell',
        run: async (ctx) => {
          const command = joinRest(ctx, 0, 'command');
          const output = rawShell(command, ctx.adb);
          return { summary: output || '(no output)', data: { command, output } };
        },
      },
    },
  },

  test: {
    summary: 'Organize artifacts for a test run',
    commands: {
      folder: {
        usage: 'test folder <name>',
        summary: 'Create a folder for test artifacts',
        run: async (ctx) => {
          const name = required(ctx, 0, 'name');
          const folder = createTestFolder(name);

          return {
            summary: folder.created ? `created ${folder.path}` : `exists ${folder.path}`,
            data: folder,
          };
        },
      },
      artifacts: {
        usage: 'test artifacts <name>',
        summary: 'List files collected for a test run',
        run: async (ctx) => {
          const name = required(ctx, 0, 'name');
          const files = listArtifacts(name);

          return {
            summary: files.length ? files.join('\n') : `(no artifacts for "${name}")`,
            data: { test: name, count: files.length, files },
          };
        },
      },
    },
  },

  skills: {
    summary: 'Serve the agent skills that ship with this package',
    commands: {
      list: {
        usage: 'skills list',
        summary: 'List available skills',
        run: async () => {
          const skills = listSkills();

          return {
            summary: skills.map((skill) => `${skill.name}\t${skill.description}`).join('\n'),
            data: skills,
          };
        },
      },
      get: {
        usage: 'skills get <name>',
        summary: 'Print the full guide for a skill',
        run: async (ctx) => {
          const name = required(ctx, 0, 'name');
          const skill = readSkill(name);

          return { summary: skill.content, data: { name: skill.name, path: skill.path, content: skill.content } };
        },
      },
    },
  },

  doctor: {
    summary: 'Check that the toolchain is usable',
    commands: {
      run: {
        usage: 'doctor',
        summary: 'Verify adb, device connectivity and UI dump support',
        run: async (ctx) => {
          const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

          let adbVersion = '';
          try {
            adbVersion = adb(['version'], { hostOnly: true }).split('\n')[0] ?? '';
            checks.push({ name: 'adb', ok: true, detail: `${adbPath()} — ${adbVersion}` });
          } catch (error) {
            checks.push({
              name: 'adb',
              ok: false,
              detail: error instanceof Error ? error.message : String(error),
            });
          }

          const cwd = workingDirectoryStatus();
          checks.push({
            name: 'workdir',
            ok: cwd.ok,
            detail: cwd.ok
              ? cwd.path
              : `original working directory is gone (uv_cwd) — using ${cwd.path}`,
          });

          const defaults = compressionDefaults();
          checks.push({
            name: 'screenshots',
            ok: true,
            detail: `${hasSharp() ? 'sharp' : 'built-in png resizer'} — max width ${defaults.maxWidth || 'original'}, format ${defaults.format}, quality ${defaults.quality}`,
          });

          const passed = (name: string) => checks.some((check) => check.name === name && check.ok);

          let devices: ReturnType<typeof listDevices> = [];
          if (passed('adb')) {
            try {
              devices = listDevices();
              const ready = devices.filter((entry) => entry.state === 'device');
              const target = defaultDevice();
              checks.push({
                name: 'devices',
                ok: ready.length > 0,
                detail:
                  ready.length === 0
                    ? 'no ready device — start an emulator or connect one'
                    : target
                      ? `${ready.length} ready, targeting ${describeDevice(target)}`
                      : `${ready.length} ready (${ready.map((entry) => entry.serial).join(', ')}) — ambiguous, pass --device or set ADB_SERIAL`,
              });
            } catch (error) {
              checks.push({
                name: 'devices',
                ok: false,
                detail: error instanceof Error ? error.message : String(error),
              });
            }
          }

          if (passed('devices')) {
            try {
              const { tree } = await dumpUI(ctx.adb);
              checks.push({ name: 'uiautomator', ok: true, detail: `${tree.all.length} elements on screen` });
            } catch (error) {
              checks.push({
                name: 'uiautomator',
                ok: false,
                detail: error instanceof Error ? error.message : String(error),
              });
            }
          }

          const summary = checks
            .map((check) => `${check.ok ? 'ok  ' : 'fail'} ${check.name.padEnd(12)} ${check.detail}`)
            .join('\n');

          return { summary, data: { checks, devices, adbVersion } };
        },
      },
    },
  },
};

export function findCommand(group: string, command: string): CommandSpec | undefined {
  return registry[group]?.commands[command];
}
