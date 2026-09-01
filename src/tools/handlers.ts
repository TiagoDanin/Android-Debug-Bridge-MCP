import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { AdbOptions, cachedDevices, describeDevice } from '../core/adb.js';
import { describeBatch, runBatch } from '../core/batch.js';
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
import { Marker } from '../core/annotate.js';
import { sleep } from '../utils/sleep.js';
import { mutatingTools } from './definitions.js';
import { createTestFolder, listArtifacts } from '../core/artifacts.js';
import { emuConsole, fingerRemove, fingerTouch } from '../core/emulator.js';
import {
  connectDevice,
  defaultDevice,
  deviceInfo,
  disconnectDevice,
  rebootDevice,
  waitForBoot,
} from '../core/device.js';
import { ImageFormat, describeCompression } from '../core/image.js';
import { CoordinateMode, clearScreenSizeCache } from '../core/geometry.js';
import {
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
  captureScreenshot,
  markScreenshot,
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
  setTouchFeedback,
  touchFeedbackState,
} from '../core/system.js';
import {
  FindQuery,
  MatchedElement,
  describeElement,
  dumpUI,
  findOnScreen,
  formatMatches,
  formatUI,
  resolveTapPoint,
  waitForElement,
} from '../core/ui.js';

type Content = Array<Record<string, unknown>>;

const textBlock = (value: string) => ({ type: 'text', text: value });

const textResult = (value: string) => ({ content: [textBlock(value)] });

const dataResult = (summary: string, data: unknown) => ({
  content: [textBlock(summary), textBlock(JSON.stringify(data, null, 2))],
});

const adbOptions = (args: any): AdbOptions => ({ device: args?.device });

/** Whether input tools append a UI snapshot. Disable with ADB_AUTO_UI=false. */
const autoUiEnabled = (): boolean => {
  const raw = (process.env.ADB_AUTO_UI || '').toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
};

/** UI snapshot appended to input actions so the caller sees the new screen. */
const uiSnapshot = async (options: AdbOptions, includeRawXML: boolean): Promise<Content> => {
  if (!autoUiEnabled()) return [];

  try {
    const { xml, tree } = await dumpUI(options);
    const blocks: Content = [textBlock(formatUI(tree))];

    if (includeRawXML) {
      blocks.push(textBlock(`\n=== RAW XML UI Automator ===\n${xml}`));
    }

    return blocks;
  } catch (error) {
    return [textBlock(`UI snapshot unavailable: ${error instanceof Error ? error.message : error}`)];
  }
};

const buildQuery = (args: any): FindQuery => ({
  query: args?.query,
  text: args?.text,
  contentDesc: args?.content_desc,
  resourceId: args?.resource_id,
  className: args?.class_name,
  type: args?.type,
  clickableOnly: args?.clickable_only,
  exact: args?.exact,
});

const serializeMatch = (element: MatchedElement) => ({
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
});

const coordinateModeOf = (args: any): CoordinateMode => (args?.mode as CoordinateMode) || 'auto';

export const toolHandlers = {
  // ─── Devices ────────────────────────────────────────────────────────────────
  list_devices: async (args: any) => {
    const devices = cachedDevices(args?.refresh === true);

    if (devices.length === 0) {
      return textResult('No devices found. Start an emulator or connect a device with USB debugging enabled.');
    }

    const target = defaultDevice();
    const summary = devices
      .map(
        (entry) =>
          `${entry.serial === target?.serial ? '→ ' : '  '}${entry.serial} — ${entry.state}${
            entry.model ? ` (${entry.model})` : ''
          }${entry.isEmulator ? ' [emulator]' : ''}`
      )
      .join('\n');

    const footer = target
      ? `\nDefault target: ${describeDevice(target)}`
      : '\nNo default target — pass "device" to every tool, or set ADB_SERIAL.';

    return dataResult(
      `DEVICES (${devices.length}):\n${summary}${footer}`,
      devices.map((entry) => ({ ...entry, default: entry.serial === target?.serial }))
    );
  },

  device_info: async (args: any) => {
    const info = deviceInfo(adbOptions(args));
    const summary = [
      `Device: ${info.manufacturer} ${info.model} (${info.serial})`,
      `Android ${info.androidVersion} (SDK ${info.sdk}, ${info.abi})`,
      `Screen: ${info.screen.width}x${info.screen.height}${info.density ? ` @ ${info.density}dpi` : ''}`,
      `Rotation: ${info.orientation ?? 'unknown'}° | Battery: ${info.battery ?? 'unknown'}%`,
      info.isEmulator ? 'Type: emulator' : 'Type: physical device',
    ].join('\n');

    return dataResult(summary, info);
  },

  connect_device: async (args: any) => {
    const { address } = args as { address: string };
    clearScreenSizeCache();
    return textResult(connectDevice(address));
  },

  disconnect_device: async (args: any) => {
    const { address } = args as { address?: string };
    clearScreenSizeCache();
    return textResult(disconnectDevice(address) || 'Disconnected');
  },

  wait_for_device: async (args: any) => {
    const { timeout_ms } = args as { timeout_ms?: number };
    return textResult(await waitForBoot(timeout_ms ?? 120_000, adbOptions(args)));
  },

  reboot_device: async (args: any) => {
    const { mode } = args as { mode?: string };
    clearScreenSizeCache();
    return textResult(rebootDevice(mode, adbOptions(args)));
  },

  // ─── UI inspection ──────────────────────────────────────────────────────────
  capture_ui_dump: async (args: any) => {
    const includeRawXML = args?.include_raw_xml !== false;
    const { xml, tree } = await dumpUI(adbOptions(args));
    const content: Content = [textBlock(formatUI(tree))];

    if (includeRawXML) {
      content.push(textBlock(`\n=== RAW XML UI Automator ===\n${xml}`));
    }

    return { content };
  },

  ui_find: async (args: any) => {
    const limit = args?.limit ?? 20;
    const { matches } = await findOnScreen(buildQuery(args), adbOptions(args));

    return dataResult(formatMatches(matches, limit), matches.slice(0, limit).map(serializeMatch));
  },

  ui_tap: async (args: any) => {
    const options = adbOptions(args);
    const index = args?.index ?? 0;
    const { matches, tree } = await findOnScreen(buildQuery(args), options);

    if (matches.length === 0) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `No element matches "${args?.query ?? JSON.stringify(buildQuery(args))}" on the current screen`
      );
    }

    const target = matches[index];

    if (!target) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `index ${index} is out of range — only ${matches.length} matches were found`
      );
    }

    const plan = resolveTapPoint(target, tree.all);

    if (plan.occludedBy && args?.force !== true) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `"${describeElement(target)}" is covered by "${describeElement(plan.occludedBy)}" at (${plan.point.x}, ${plan.point.y}) — tapping there would hit the overlay instead. Scroll the element clear, act on the overlay, or retry with force: true.`
      );
    }

    const result = await tap(plan.point.x, plan.point.y, 'pixels', options);
    const uiContent = await uiSnapshot(options, false);
    const note =
      plan.strategy === 'offset'
        ? ', offset from a covered center'
        : plan.occludedBy
          ? ', forced through an overlay'
          : '';

    return {
      content: [
        textBlock(
          `Tapped "${describeElement(target)}" at (${result.point.x}, ${result.point.y}) — matched on ${target.matchedOn}, ${matches.length} candidate(s)${note}`
        ),
        ...uiContent,
      ],
    };
  },

  ui_wait_for: async (args: any) => {
    const options = adbOptions(args);
    const { matches, waitedMs } = await waitForElement(
      buildQuery(args),
      args?.timeout_ms ?? 10_000,
      args?.interval_ms ?? 500,
      options
    );

    return dataResult(
      `Element appeared after ${waitedMs}ms\n${formatMatches(matches, 10)}`,
      matches.slice(0, 10).map(serializeMatch)
    );
  },

  // ─── Input ──────────────────────────────────────────────────────────────────
  input_tap: async (args: any) => {
    const options = adbOptions(args);
    const { x, y } = args as { x: number; y: number };
    const result = await tap(x, y, coordinateModeOf(args), options);

    return {
      content: [
        textBlock(
          `Tap executed at (${result.point.x}, ${result.point.y}) [${result.point.mode} input on ${result.point.screen.width}x${result.point.screen.height}]`
        ),
        ...(await uiSnapshot(options, false)),
      ],
    };
  },

  input_double_tap: async (args: any) => {
    const options = adbOptions(args);
    const { x, y } = args as { x: number; y: number };
    const result = await doubleTap(x, y, coordinateModeOf(args), options);

    return {
      content: [
        textBlock(`Double tap executed at (${result.point.x}, ${result.point.y})`),
        ...(await uiSnapshot(options, false)),
      ],
    };
  },

  input_long_press: async (args: any) => {
    const options = adbOptions(args);
    const { x, y, duration_ms } = args as { x: number; y: number; duration_ms?: number };
    const result = await longPress(x, y, duration_ms ?? 800, coordinateModeOf(args), options);

    return {
      content: [
        textBlock(
          `Long press executed at (${result.from.x}, ${result.from.y}) for ${result.durationMs}ms`
        ),
        ...(await uiSnapshot(options, false)),
      ],
    };
  },

  input_swipe: async (args: any) => {
    const options = adbOptions(args);
    const { x1, y1, x2, y2, duration_ms } = args as {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      duration_ms?: number;
    };
    const result = await swipe(x1, y1, x2, y2, duration_ms ?? 300, coordinateModeOf(args), options);

    return {
      content: [
        textBlock(
          `Swipe executed from (${result.from.x}, ${result.from.y}) to (${result.to.x}, ${result.to.y}) in ${result.durationMs}ms`
        ),
        ...(await uiSnapshot(options, false)),
      ],
    };
  },

  input_scroll: async (args: any) => {
    const options = adbOptions(args);
    const { direction, amount, duration_ms } = args as {
      direction: ScrollDirection;
      amount?: number;
      duration_ms?: number;
    };
    const result = await scroll(direction, amount ?? 0.6, duration_ms ?? 300, options);

    return {
      content: [
        textBlock(
          `Scroll ${direction} executed from (${result.from.x}, ${result.from.y}) to (${result.to.x}, ${result.to.y})`
        ),
        ...(await uiSnapshot(options, false)),
      ],
    };
  },

  input_text: async (args: any) => {
    const options = adbOptions(args);
    const { text, submit } = args as { text: string; submit?: boolean };
    const result = await inputText(text, submit ?? false, options);

    const warning = result.unsupported.length
      ? `\n⚠️  These characters may not have been typed correctly (ADB input is ASCII-only): ${result.unsupported.join(' ')}`
      : '';

    return {
      content: [
        textBlock(`Text input: ${text}${result.submitted ? ' (submitted with ENTER)' : ''}${warning}`),
        ...(await uiSnapshot(options, false)),
      ],
    };
  },

  input_keyevent: async (args: any) => {
    const options = adbOptions(args);
    const { key } = args as { key: string };

    try {
      const result = await pressKey(key, options);
      return {
        content: [
          textBlock(`Key event sent: ${result.key} (${result.code})`),
          ...(await uiSnapshot(options, false)),
        ],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InvalidParams, error instanceof Error ? error.message : String(error));
    }
  },

  input_clear_text: async (args: any) => {
    const options = adbOptions(args);
    const result = await clearText(args?.count ?? 60, options);

    return {
      content: [
        textBlock(`Focused field cleared with ${result.deletes} backspaces`),
        ...(await uiSnapshot(options, false)),
      ],
    };
  },

  // ─── Apps ───────────────────────────────────────────────────────────────────
  list_apps: async (args: any) => {
    const { app_name, scope } = args as { app_name?: string; scope?: 'all' | 'third-party' | 'system' };
    const packages = listPackages(app_name, scope ?? 'all', adbOptions(args));

    if (packages.length === 0) {
      return textResult(
        app_name ? `No apps found matching "${app_name}"` : 'No packages returned by the device'
      );
    }

    const summary = packages.map((entry) => entry.packageName).join('\n');
    return dataResult(`PACKAGES (${packages.length}):\n${summary}`, packages);
  },

  open_app: async (args: any) => {
    const { package_name, activity } = args as { package_name: string; activity?: string };
    const result = await launchApp(package_name, activity, adbOptions(args));

    return textResult(
      `App launched: ${package_name}${result.component ? ` → ${result.component}` : ''} (via ${result.method})`
    );
  },

  stop_app: async (args: any) => {
    const { package_name } = args as { package_name: string };
    return textResult(await stopApp(package_name, adbOptions(args)));
  },

  restart_app: async (args: any) => {
    const { package_name } = args as { package_name: string };
    const result = await restartApp(package_name, adbOptions(args));
    return textResult(`Restarted ${package_name}${result.component ? ` → ${result.component}` : ''}`);
  },

  clear_app_data: async (args: any) => {
    const { package_name } = args as { package_name: string };
    return textResult(await clearAppData(package_name, adbOptions(args)));
  },

  app_info: async (args: any) => {
    const { package_name } = args as { package_name: string };
    const info = appInfo(package_name, adbOptions(args));
    const summary = [
      `Package: ${info.packageName}`,
      `Version: ${info.versionName ?? 'unknown'} (code ${info.versionCode ?? 'unknown'})`,
      `SDK: min ${info.minSdk ?? '?'} / target ${info.targetSdk ?? '?'}`,
      `Installer: ${info.installer ?? 'none'}`,
      `Permissions: ${info.grantedPermissions.length} granted, ${info.deniedPermissions.length} denied`,
    ].join('\n');

    return dataResult(summary, info);
  },

  install_apk: async (args: any) => {
    const { apk_path, reinstall, grant_permissions, downgrade } = args as {
      apk_path: string;
      reinstall?: boolean;
      grant_permissions?: boolean;
      downgrade?: boolean;
    };

    const output = installApk(
      apk_path,
      { reinstall, grantPermissions: grant_permissions, downgrade },
      adbOptions(args)
    );

    return textResult(output || `Installed ${apk_path}`);
  },

  reinstall_apk: async (args: any) => {
    const { apk_path } = args as { apk_path: string };
    const output = installApk(apk_path, { reinstall: true }, adbOptions(args));
    return textResult(output || `Reinstalled ${apk_path}`);
  },

  uninstall_app: async (args: any) => {
    const { package_name, keep_data } = args as { package_name: string; keep_data?: boolean };
    const output = uninstallApp(package_name, keep_data ?? false, adbOptions(args));
    return textResult(output || `Uninstalled ${package_name}`);
  },

  grant_permission: async (args: any) => {
    const { package_name, permission } = args as { package_name: string; permission: string };
    return textResult(grantPermission(package_name, permission, adbOptions(args)));
  },

  revoke_permission: async (args: any) => {
    const { package_name, permission } = args as { package_name: string; permission: string };
    return textResult(revokePermission(package_name, permission, adbOptions(args)));
  },

  get_current_activity: async (args: any) => {
    return textResult(currentActivity(adbOptions(args)));
  },

  get_focused_window: async (args: any) => {
    return textResult(focusedWindow(adbOptions(args)));
  },

  // ─── Screen ─────────────────────────────────────────────────────────────────
  capture_screenshot: async (args: any) => {
    const {
      test_name,
      step_name,
      out_path,
      include_image,
      max_width,
      quality,
      format,
      save_compressed,
      mark_last_touch,
      mark_last_count,
      markers,
      marker_color,
    } = args as {
      test_name?: string;
      step_name?: string;
      out_path?: string;
      include_image?: boolean;
      max_width?: number;
      quality?: number;
      format?: ImageFormat;
      save_compressed?: boolean;
      mark_last_touch?: boolean;
      mark_last_count?: number;
      markers?: Marker[];
      marker_color?: string;
    };

    const target = out_path ?? screenshotPath(test_name, step_name);
    const result = await captureScreenshot(target, adbOptions(args), {
      maxWidth: max_width,
      quality,
      format,
      saveCompressed: save_compressed,
      markers,
      markLastTouch: mark_last_count ?? mark_last_touch,
      markerColor: marker_color,
    });

    const where = result.path
      ? `Screenshot captured: ${result.path}`
      : 'Screenshot captured in memory';
    const saved = result.compressedPath ? `\nCompressed copy: ${result.compressedPath}` : '';
    const points = result.markers
      .map(
        (marker) =>
          `(${marker.x}, ${marker.y})${marker.to ? ` → (${marker.to.x}, ${marker.to.y})` : ''}`
      )
      .join(', ');
    const marked = result.markers.length
      ? `\nMarked ${result.markers.length} point(s): ${points}`
      : mark_last_touch || mark_last_count
        ? '\nNothing marked: no gesture has been recorded on this device yet'
        : '';
    const markerIssue = result.markerNote ? `\n${result.markerNote}` : '';

    const content: Content = [
      textBlock(
        `${where} — screen ${result.screen.width}x${result.screen.height}\nReturned: ${describeCompression(result.image)}${saved}${marked}${markerIssue}`
      ),
    ];

    if (include_image !== false) {
      content.push({ type: 'image', data: result.base64, mimeType: result.mimeType });
    }

    return { content };
  },

  mark_screenshot: async (args: any) => {
    const { file_path, out_path, mark_last_count, markers, marker_color, include_image } = args as {
      file_path: string;
      out_path?: string;
      mark_last_count?: number;
      markers?: Marker[];
      marker_color?: string;
      include_image?: boolean;
    };

    try {
      const result = await markScreenshot(file_path, out_path ?? null, adbOptions(args), {
        markers,
        ...(mark_last_count === undefined ? {} : { markLastTouch: mark_last_count }),
        markerColor: marker_color,
      });

      const points = result.markers
        .map(
          (marker) =>
            `(${marker.x}, ${marker.y})${marker.to ? ` → (${marker.to.x}, ${marker.to.y})` : ''}`
        )
        .join(', ');

      const content: Content = [
        textBlock(`Marked ${result.path} at ${points} — ${describeCompression(result.image)}`),
      ];

      if (include_image !== false) {
        content.push({ type: 'image', data: result.base64, mimeType: result.mimeType });
      }

      return { content };
    } catch (error) {
      throw new McpError(ErrorCode.InvalidRequest, error instanceof Error ? error.message : String(error));
    }
  },

  record_screen: async (args: any) => {
    const { duration_seconds, out_path } = args as { duration_seconds: number; out_path: string };
    const result = await recordScreen(duration_seconds, out_path, adbOptions(args));

    return textResult(
      `Recorded ${result.durationSeconds}s to ${result.path} (${result.bytes} bytes)`
    );
  },

  rotate_screen: async (args: any) => {
    const { orientation } = args as { orientation: string };
    const parsed = orientation === 'auto' ? 'auto' : (Number(orientation) as 0 | 90 | 180 | 270);
    const result = await rotateScreen(parsed, adbOptions(args));

    return textResult(`Screen orientation set to ${result.orientation}`);
  },

  screen_state: async (args: any) => {
    const state = screenState(adbOptions(args));
    const summary = [
      `Screen: ${state.screen.width}x${state.screen.height}`,
      `Rotation: ${state.rotation ?? 'unknown'}°`,
      `Display: ${state.awake ? 'awake' : 'asleep'}`,
      `Keyguard: ${state.locked ? 'locked' : 'unlocked'}`,
    ].join('\n');

    return dataResult(summary, state);
  },

  wake_screen: async (args: any) => {
    const result = await wakeScreen(adbOptions(args));
    return textResult(result.awake ? 'Screen is awake' : 'Sent wake keys, but the display still reports asleep');
  },

  sleep_screen: async (args: any) => {
    const result = await sleepScreen(adbOptions(args));
    return textResult(result.awake ? 'Sent sleep key, but the display still reports awake' : 'Screen is off');
  },

  unlock_device: async (args: any) => {
    const { pin } = args as { pin: string };
    const result = await unlockWithPin(pin, adbOptions(args));
    return textResult(result.unlocked ? 'Device unlocked' : 'Unlock attempted, but the keyguard still reports locked');
  },

  // ─── System ─────────────────────────────────────────────────────────────────
  toggle_wifi: async (args: any) => {
    const { enabled } = args as { enabled: boolean };
    return textResult(await setToggle('wifi', enabled, adbOptions(args)));
  },

  toggle_mobile_data: async (args: any) => {
    const { enabled } = args as { enabled: boolean };
    return textResult(await setToggle('data', enabled, adbOptions(args)));
  },

  toggle_airplane_mode: async (args: any) => {
    const { enabled } = args as { enabled: boolean };
    return textResult(await setToggle('airplane', enabled, adbOptions(args)));
  },

  set_touch_feedback: async (args: any) => {
    const options = adbOptions(args);
    const { show_touches, pointer_location } = args as {
      show_touches?: boolean;
      pointer_location?: boolean;
    };

    const describe = (value: boolean | null) => (value === null ? 'unknown' : value ? 'on' : 'off');

    if (show_touches === undefined && pointer_location === undefined) {
      const state = touchFeedbackState(options);
      return dataResult(
        `Show taps: ${describe(state.showTouches)} | Pointer location: ${describe(state.pointerLocation)}`,
        state
      );
    }

    const state = await setTouchFeedback(
      { showTouches: show_touches, pointerLocation: pointer_location },
      options
    );

    return dataResult(
      `Show taps: ${describe(state.showTouches)} | Pointer location: ${describe(state.pointerLocation)}\nThe indicator only exists while the finger is down, so it shows up in record_screen but not in a screenshot taken afterwards — use capture_screenshot with mark_last_touch for a still image.`,
      state
    );
  },

  get_connectivity_state: async (args: any) => {
    const state = connectivityState(adbOptions(args));
    const describe = (value: boolean | null) => (value === null ? 'unknown' : value ? 'on' : 'off');

    return dataResult(
      `Wi-Fi: ${describe(state.wifi)} | Mobile data: ${describe(state.data)} | Airplane mode: ${describe(state.airplane)}`,
      state
    );
  },

  read_logcat: async (args: any) => {
    const { lines, filter, priority, package_name, clear } = args as {
      lines?: number;
      filter?: string;
      priority?: string;
      package_name?: string;
      clear?: boolean;
    };

    const output = readLogcat(
      { lines, filter, priority, packageName: package_name, clear },
      adbOptions(args)
    );

    return textResult(output.trim() || 'Logcat buffer is empty for the given filters');
  },

  clear_logcat: async (args: any) => {
    return textResult(clearLogcat(adbOptions(args)));
  },

  open_deeplink: async (args: any) => {
    const { url, package_name } = args as { url: string; package_name?: string };
    return textResult(await openDeeplink(url, package_name, adbOptions(args)));
  },

  send_broadcast: async (args: any) => {
    const { action, extras } = args as { action: string; extras?: Record<string, string> };
    const output = await sendBroadcast(action, extras ?? {}, adbOptions(args));
    return textResult(output || `Broadcast sent: ${action}`);
  },

  push_file: async (args: any) => {
    const { local_path, remote_path } = args as { local_path: string; remote_path: string };
    return textResult(pushFile(local_path, remote_path, adbOptions(args)));
  },

  pull_file: async (args: any) => {
    const { remote_path, local_path } = args as { remote_path: string; local_path: string };
    return textResult(pullFile(remote_path, local_path, adbOptions(args)));
  },

  get_setting: async (args: any) => {
    const { namespace, key } = args as { namespace: 'system' | 'secure' | 'global'; key: string };
    const value = getSetting(namespace, key, adbOptions(args));
    return textResult(`${namespace}.${key} = ${value || '(unset)'}`);
  },

  put_setting: async (args: any) => {
    const { namespace, key, value } = args as {
      namespace: 'system' | 'secure' | 'global';
      key: string;
      value: string;
    };
    return textResult(putSetting(namespace, key, value, adbOptions(args)));
  },

  list_processes: async (args: any) => {
    const { filter } = args as { filter?: string };
    return textResult(listProcesses(filter, adbOptions(args)));
  },

  get_memory_usage: async (args: any) => {
    const { package_name } = args as { package_name: string };
    const output = memoryUsage(package_name, adbOptions(args));
    return textResult(output || `No memory info found for ${package_name}`);
  },

  get_battery_info: async (args: any) => {
    return textResult(batteryInfo(adbOptions(args)));
  },

  list_notifications: async (args: any) => {
    const output = notifications(adbOptions(args));
    return textResult(output.trim() || 'No notifications posted');
  },

  get_device_props: async (args: any) => {
    const { filter } = args as { filter?: string };
    const props = deviceProps(filter, adbOptions(args));
    const keys = Object.keys(props);

    return dataResult(`PROPERTIES (${keys.length}${filter ? ` matching "${filter}"` : ''})`, props);
  },

  adb_shell: async (args: any) => {
    const { command } = args as { command: string };
    const output = rawShell(command, adbOptions(args));
    return textResult(output || '(no output)');
  },

  // ─── Emulator console ───────────────────────────────────────────────────────
  emu_finger_touch: async (args: any) => {
    const { finger_id } = args as { finger_id?: number };

    try {
      const result = await fingerTouch(finger_id ?? 1, adbOptions(args));
      return dataResult(
        `Fingerprint sensor touched with finger ${result.fingerId} on ${result.serial}${result.output ? ` — ${result.output}` : ''}`,
        result
      );
    } catch (error) {
      throw new McpError(ErrorCode.InvalidRequest, error instanceof Error ? error.message : String(error));
    }
  },

  emu_finger_remove: async (args: any) => {
    try {
      const result = await fingerRemove(adbOptions(args));
      return dataResult(`Finger lifted off the sensor on ${result.serial}`, result);
    } catch (error) {
      throw new McpError(ErrorCode.InvalidRequest, error instanceof Error ? error.message : String(error));
    }
  },

  emu_console: async (args: any) => {
    const { command } = args as { command: string };

    try {
      const result = emuConsole(command.trim().split(/\s+/), adbOptions(args));
      return dataResult(`emu ${result.command} on ${result.serial}`, result);
    } catch (error) {
      throw new McpError(ErrorCode.InvalidRequest, error instanceof Error ? error.message : String(error));
    }
  },

  // ─── Sequences ────────────────────────────────────────────────────────────
  run_batch: async (args: any) => {
    const { steps, delay_ms, continue_on_error, include_images } = args as {
      steps?: Array<{ tool?: string; arguments?: Record<string, unknown>; wait_ms?: number }>;
      delay_ms?: number;
      continue_on_error?: boolean;
      include_images?: 'none' | 'last' | 'all';
    };

    if (!Array.isArray(steps) || steps.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'run_batch needs a non-empty "steps" array');
    }

    const images: Array<{ index: number; block: Record<string, unknown> }> = [];

    const outcome = await runBatch(
      steps,
      {
        describe: (step, index) =>
          step?.wait_ms !== undefined ? `wait ${step.wait_ms}ms` : step?.tool ?? `step ${index + 1}`,
        isPause: (step) => step?.wait_ms !== undefined,
        execute: async (step, index) => {
          if (step?.wait_ms !== undefined) {
            const ms = Math.max(Number(step.wait_ms) || 0, 0);
            await sleep(ms);
            return { summary: `waited ${ms}ms`, mutates: false };
          }

          const name = step?.tool;

          if (!name) {
            throw new Error('each step needs a "tool" name or a "wait_ms" pause');
          }

          // Nesting would make the pacing and the failure report meaningless.
          if (name === 'run_batch') {
            throw new Error('run_batch cannot be nested');
          }

          const handler = toolHandlers[name as keyof typeof toolHandlers];

          if (!handler) {
            throw new Error(`unknown tool "${name}"`);
          }

          // The batch-level device is the default; a step may still name its own.
          const result: any = await handler({
            ...(args?.device ? { device: args.device } : {}),
            ...(step.arguments ?? {}),
          });

          const blocks: any[] = Array.isArray(result?.content) ? result.content : [];
          const text = blocks
            .filter((block) => block?.type === 'text')
            .map((block) => String(block.text))
            .join('\n');

          for (const block of blocks.filter((block) => block?.type === 'image')) {
            images.push({ index, block });
          }

          return { command: name, summary: text, mutates: mutatingTools.has(name) };
        },
      },
      { delayMs: delay_ms, continueOnError: continue_on_error }
    );

    const report = outcome.steps
      .map(
        (step) =>
          `[${step.index + 1}/${steps.length}] ${step.step}${
            step.ok ? `: ${(step.summary ?? '').split('\n')[0]}` : ` — FAILED: ${step.error?.message}`
          }`
      )
      .join('\n');

    const wanted = include_images ?? 'last';
    const selected =
      wanted === 'none' ? [] : wanted === 'all' ? images : images.slice(-1);

    return {
      content: [
        textBlock(`${describeBatch(outcome, steps.length)} (delay ${outcome.delayMs}ms)\n${report}`),
        textBlock(JSON.stringify(outcome, null, 2)),
        ...selected.map((entry) => entry.block),
      ],
    };
  },

  // ─── Test artifacts ─────────────────────────────────────────────────────────
  create_test_folder: async (args: any) => {
    const { test_name } = args as { test_name: string };
    const folder = createTestFolder(test_name);

    return textResult(
      folder.created ? `Test folder created: ${folder.path}` : `Test folder already exists: ${folder.path}`
    );
  },

  list_artifacts: async (args: any) => {
    const { test_name } = args as { test_name: string };
    const files = listArtifacts(test_name);

    if (files.length === 0) {
      return textResult(`No artifacts found for test "${test_name}"`);
    }

    return dataResult(`ARTIFACTS (${files.length}):\n${files.join('\n')}`, files);
  },
};
