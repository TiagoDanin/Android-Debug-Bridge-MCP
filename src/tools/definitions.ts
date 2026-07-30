import { KEY_CODES } from '../core/input.js';

const device = {
  device: {
    type: 'string',
    description:
      'Target device serial. Defaults to ADB_SERIAL/ANDROID_SERIAL, or the only connected device.',
  },
} as const;

const coordinateMode = {
  mode: {
    type: 'string',
    enum: ['auto', 'normalized', 'pixels'],
    description:
      'How to read coordinates. "auto" (default) treats values between 0 and 1 as screen fractions and anything larger as pixels.',
  },
} as const;

const uiQuery = {
  query: {
    type: 'string',
    description: 'Text matched against the element text, content-desc and resource-id.',
  },
  text: { type: 'string', description: 'Match only against the element text.' },
  content_desc: { type: 'string', description: 'Match only against the content description.' },
  resource_id: { type: 'string', description: 'Match only against the resource id.' },
  class_name: { type: 'string', description: 'Filter by Android class name substring.' },
  type: {
    type: 'string',
    enum: ['text', 'button', 'input', 'switch', 'checkbox', 'radio', 'image', 'list', 'view'],
    description: 'Filter by the element category detected by the parser.',
  },
  clickable_only: { type: 'boolean', description: 'Keep only clickable elements.' },
  exact: { type: 'boolean', description: 'Require a full match instead of a substring match.' },
} as const;

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object' as const,
  properties,
  ...(required.length ? { required } : {}),
});

export const toolDefinitions = [
  // ─── Devices ────────────────────────────────────────────────────────────────
  {
    name: 'list_devices',
    description: 'List connected ADB devices with their state, model and transport id',
    inputSchema: objectSchema({}),
  },
  {
    name: 'device_info',
    description:
      'Get the device fingerprint: model, manufacturer, Android version, SDK, ABI, screen size, density, rotation and battery level',
    inputSchema: objectSchema({ ...device }),
  },
  {
    name: 'connect_device',
    description: 'Connect to a device over TCP/IP (host:port)',
    inputSchema: objectSchema(
      {
        address: {
          type: 'string',
          description: 'Device address as host:port (e.g., 192.168.1.100:5555)',
        },
      },
      ['address']
    ),
  },
  {
    name: 'disconnect_device',
    description: 'Disconnect a TCP/IP device, or all of them when no address is given',
    inputSchema: objectSchema({
      address: { type: 'string', description: 'Device address to disconnect (host:port)' },
    }),
  },
  {
    name: 'wait_for_device',
    description: 'Wait until the device is online and has finished booting',
    inputSchema: objectSchema({
      ...device,
      timeout_ms: { type: 'number', description: 'Maximum time to wait in ms (default 120000)' },
    }),
  },
  {
    name: 'reboot_device',
    description: 'Reboot the device, optionally into bootloader or recovery',
    inputSchema: objectSchema({
      ...device,
      mode: {
        type: 'string',
        enum: ['bootloader', 'recovery', 'sideload'],
        description: 'Reboot target. Omit for a normal reboot.',
      },
    }),
  },

  // ─── UI inspection ──────────────────────────────────────────────────────────
  {
    name: 'capture_ui_dump',
    description:
      'Dump the UI hierarchy of the current screen and return the parsed elements (texts, buttons, inputs, switches, scrollables) with tap coordinates',
    inputSchema: objectSchema({
      ...device,
      include_raw_xml: {
        type: 'boolean',
        description: 'Also return the raw UIAutomator XML (default true)',
      },
    }),
  },
  {
    name: 'ui_find',
    description:
      'Find elements on the current screen by text, content description, resource id, class or type, ranked by relevance',
    inputSchema: objectSchema({
      ...device,
      ...uiQuery,
      limit: { type: 'number', description: 'Maximum number of matches to return (default 20)' },
    }),
  },
  {
    name: 'ui_tap',
    description:
      'Find an element by text/description/resource id and tap its center. Preferred over raw coordinates because it survives layout changes.',
    inputSchema: objectSchema(
      {
        ...device,
        ...uiQuery,
        index: {
          type: 'number',
          description: 'Which match to tap when several are found (0 = best match, the default)',
        },
      },
      ['query']
    ),
  },
  {
    name: 'ui_wait_for',
    description: 'Poll the screen until an element matching the query appears, or time out',
    inputSchema: objectSchema(
      {
        ...device,
        ...uiQuery,
        timeout_ms: { type: 'number', description: 'How long to wait in ms (default 10000)' },
        interval_ms: { type: 'number', description: 'Polling interval in ms (default 500)' },
      },
      ['query']
    ),
  },

  // ─── Input ──────────────────────────────────────────────────────────────────
  {
    name: 'input_tap',
    description: 'Tap at coordinates. Accepts normalized 0..1 fractions or raw pixels.',
    inputSchema: objectSchema(
      {
        ...device,
        ...coordinateMode,
        x: { type: 'number', description: 'X coordinate (0..1 fraction or pixels)' },
        y: { type: 'number', description: 'Y coordinate (0..1 fraction or pixels)' },
      },
      ['x', 'y']
    ),
  },
  {
    name: 'input_double_tap',
    description: 'Double tap at coordinates',
    inputSchema: objectSchema(
      {
        ...device,
        ...coordinateMode,
        x: { type: 'number', description: 'X coordinate (0..1 fraction or pixels)' },
        y: { type: 'number', description: 'Y coordinate (0..1 fraction or pixels)' },
      },
      ['x', 'y']
    ),
  },
  {
    name: 'input_long_press',
    description: 'Press and hold at coordinates',
    inputSchema: objectSchema(
      {
        ...device,
        ...coordinateMode,
        x: { type: 'number', description: 'X coordinate (0..1 fraction or pixels)' },
        y: { type: 'number', description: 'Y coordinate (0..1 fraction or pixels)' },
        duration_ms: { type: 'number', description: 'Hold duration in ms (default 800)' },
      },
      ['x', 'y']
    ),
  },
  {
    name: 'input_swipe',
    description: 'Swipe from one point to another, for gestures and drag interactions',
    inputSchema: objectSchema(
      {
        ...device,
        ...coordinateMode,
        x1: { type: 'number', description: 'Start X (0..1 fraction or pixels)' },
        y1: { type: 'number', description: 'Start Y (0..1 fraction or pixels)' },
        x2: { type: 'number', description: 'End X (0..1 fraction or pixels)' },
        y2: { type: 'number', description: 'End Y (0..1 fraction or pixels)' },
        duration_ms: { type: 'number', description: 'Swipe duration in ms (default 300)' },
      },
      ['x1', 'y1', 'x2', 'y2']
    ),
  },
  {
    name: 'input_scroll',
    description:
      'Scroll the screen. "down" reveals content further down the page, "up" goes back towards the top.',
    inputSchema: objectSchema(
      {
        ...device,
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'Direction to scroll',
        },
        amount: {
          type: 'number',
          description: 'Fraction of the screen to travel, 0.05..0.9 (default 0.6)',
        },
        duration_ms: { type: 'number', description: 'Gesture duration in ms (default 300)' },
      },
      ['direction']
    ),
  },
  {
    name: 'input_text',
    description:
      'Type text into the focused field. ADB only transmits ASCII reliably; unsupported characters are reported back.',
    inputSchema: objectSchema(
      {
        ...device,
        text: { type: 'string', description: 'Text to type' },
        submit: {
          type: 'boolean',
          description: 'Press ENTER after typing (default false)',
        },
      },
      ['text']
    ),
  },
  {
    name: 'input_keyevent',
    description: `Send a hardware/software key event. Known keys: ${Object.keys(KEY_CODES).join(', ')}. A raw keycode number also works.`,
    inputSchema: objectSchema(
      {
        ...device,
        key: { type: 'string', description: 'Key name (e.g., BACK, HOME, RECENTS) or keycode number' },
      },
      ['key']
    ),
  },
  {
    name: 'input_clear_text',
    description: 'Clear the focused text field by moving to the end and sending backspaces',
    inputSchema: objectSchema({
      ...device,
      count: { type: 'number', description: 'How many backspaces to send (default 60)' },
    }),
  },

  // ─── Apps ───────────────────────────────────────────────────────────────────
  {
    name: 'list_apps',
    description: 'List installed packages, optionally filtered by a name pattern',
    inputSchema: objectSchema({
      ...device,
      app_name: { type: 'string', description: 'Case-insensitive substring to match in package names' },
      scope: {
        type: 'string',
        enum: ['all', 'third-party', 'system'],
        description: 'Which packages to list (default all)',
      },
    }),
  },
  {
    name: 'open_app',
    description:
      'Launch an app by package name. Resolves the launcher activity automatically unless one is given.',
    inputSchema: objectSchema(
      {
        ...device,
        package_name: { type: 'string', description: 'Package name (e.g., com.android.chrome)' },
        activity: {
          type: 'string',
          description: 'Optional activity or full component (pkg/.Activity) to start',
        },
      },
      ['package_name']
    ),
  },
  {
    name: 'stop_app',
    description: 'Force-stop an app',
    inputSchema: objectSchema({ ...device, package_name: { type: 'string', description: 'Package name' } }, [
      'package_name',
    ]),
  },
  {
    name: 'restart_app',
    description: 'Force-stop an app and launch it again — the usual way to reset to a clean start',
    inputSchema: objectSchema({ ...device, package_name: { type: 'string', description: 'Package name' } }, [
      'package_name',
    ]),
  },
  {
    name: 'clear_app_data',
    description:
      'Clear all app data (accounts, databases, caches). Destructive: the app returns to a first-install state.',
    inputSchema: objectSchema({ ...device, package_name: { type: 'string', description: 'Package name' } }, [
      'package_name',
    ]),
  },
  {
    name: 'app_info',
    description:
      'Get package details: version name/code, SDK levels, installer, APK path and granted/denied permissions',
    inputSchema: objectSchema({ ...device, package_name: { type: 'string', description: 'Package name' } }, [
      'package_name',
    ]),
  },
  {
    name: 'install_apk',
    description: 'Install an APK on the device',
    inputSchema: objectSchema(
      {
        ...device,
        apk_path: { type: 'string', description: 'Path to the APK on this machine' },
        reinstall: { type: 'boolean', description: 'Keep data and replace an existing install (-r)' },
        grant_permissions: { type: 'boolean', description: 'Grant all runtime permissions (-g)' },
        downgrade: { type: 'boolean', description: 'Allow version downgrade (-d)' },
      },
      ['apk_path']
    ),
  },
  {
    name: 'reinstall_apk',
    description: 'Reinstall (replace) an existing APK, keeping app data',
    inputSchema: objectSchema(
      { ...device, apk_path: { type: 'string', description: 'Path to the APK on this machine' } },
      ['apk_path']
    ),
  },
  {
    name: 'uninstall_app',
    description: 'Uninstall an app from the device',
    inputSchema: objectSchema(
      {
        ...device,
        package_name: { type: 'string', description: 'Package name' },
        keep_data: { type: 'boolean', description: 'Keep data and cache directories (-k)' },
      },
      ['package_name']
    ),
  },
  {
    name: 'grant_permission',
    description: 'Grant a runtime permission to an app (e.g., CAMERA, ACCESS_FINE_LOCATION)',
    inputSchema: objectSchema(
      {
        ...device,
        package_name: { type: 'string', description: 'Package name' },
        permission: {
          type: 'string',
          description: 'Permission name, with or without the android.permission prefix',
        },
      },
      ['package_name', 'permission']
    ),
  },
  {
    name: 'revoke_permission',
    description: 'Revoke a runtime permission from an app',
    inputSchema: objectSchema(
      {
        ...device,
        package_name: { type: 'string', description: 'Package name' },
        permission: {
          type: 'string',
          description: 'Permission name, with or without the android.permission prefix',
        },
      },
      ['package_name', 'permission']
    ),
  },
  {
    name: 'get_current_activity',
    description: 'Get the activity currently in the foreground',
    inputSchema: objectSchema({ ...device }),
  },
  {
    name: 'get_focused_window',
    description: 'Get the currently focused window',
    inputSchema: objectSchema({ ...device }),
  },

  // ─── Screen ─────────────────────────────────────────────────────────────────
  {
    name: 'capture_screenshot',
    description:
      'Capture a screenshot, save it under the test folder (or out_path) and return it as an image',
    inputSchema: objectSchema({
      ...device,
      test_name: { type: 'string', description: 'Test folder name used for the artifact path' },
      step_name: { type: 'string', description: 'Step name for the file (e.g., "001_login")' },
      out_path: { type: 'string', description: 'Explicit output path, overrides test/step naming' },
      include_image: {
        type: 'boolean',
        description: 'Return the PNG as image content (default true)',
      },
    }),
  },
  {
    name: 'record_screen',
    description:
      'Record the screen for a number of seconds and pull the MP4 to this machine. Blocks for the whole duration (max 180s).',
    inputSchema: objectSchema(
      {
        ...device,
        duration_seconds: { type: 'number', description: 'Recording length in seconds (1..180)' },
        out_path: { type: 'string', description: 'Where to save the MP4 on this machine' },
      },
      ['duration_seconds', 'out_path']
    ),
  },
  {
    name: 'rotate_screen',
    description: 'Set the screen orientation, or restore automatic rotation',
    inputSchema: objectSchema(
      {
        ...device,
        orientation: {
          type: 'string',
          enum: ['auto', '0', '90', '180', '270'],
          description: 'Target orientation in degrees, or auto',
        },
      },
      ['orientation']
    ),
  },
  {
    name: 'screen_state',
    description: 'Report screen size, rotation, and whether the display is awake and locked',
    inputSchema: objectSchema({ ...device }),
  },
  {
    name: 'wake_screen',
    description: 'Wake the display and dismiss the keyguard swipe',
    inputSchema: objectSchema({ ...device }),
  },
  {
    name: 'sleep_screen',
    description: 'Turn the display off',
    inputSchema: objectSchema({ ...device }),
  },
  {
    name: 'unlock_device',
    description: 'Wake the device, swipe up and type a numeric PIN to unlock',
    inputSchema: objectSchema({ ...device, pin: { type: 'string', description: 'Numeric PIN' } }, ['pin']),
  },

  // ─── System ─────────────────────────────────────────────────────────────────
  {
    name: 'toggle_wifi',
    description: 'Enable or disable Wi-Fi',
    inputSchema: objectSchema({ ...device, enabled: { type: 'boolean', description: 'true to enable' } }, [
      'enabled',
    ]),
  },
  {
    name: 'toggle_mobile_data',
    description: 'Enable or disable mobile data',
    inputSchema: objectSchema({ ...device, enabled: { type: 'boolean', description: 'true to enable' } }, [
      'enabled',
    ]),
  },
  {
    name: 'toggle_airplane_mode',
    description: 'Enable or disable airplane mode',
    inputSchema: objectSchema({ ...device, enabled: { type: 'boolean', description: 'true to enable' } }, [
      'enabled',
    ]),
  },
  {
    name: 'get_connectivity_state',
    description: 'Read the current Wi-Fi, mobile data and airplane mode state',
    inputSchema: objectSchema({ ...device }),
  },
  {
    name: 'read_logcat',
    description:
      'Read the logcat buffer, filtered by package, priority or substring — the fastest way to spot crashes and exceptions',
    inputSchema: objectSchema({
      ...device,
      lines: { type: 'number', description: 'How many trailing lines to return (default 200)' },
      filter: { type: 'string', description: 'Case-insensitive substring filter' },
      priority: {
        type: 'string',
        enum: ['V', 'D', 'I', 'W', 'E', 'F'],
        description: 'Minimum log priority',
      },
      package_name: { type: 'string', description: 'Only lines from this package process' },
      clear: { type: 'boolean', description: 'Clear the buffer before reading' },
    }),
  },
  {
    name: 'clear_logcat',
    description: 'Clear the logcat buffer, so the next read only shows new output',
    inputSchema: objectSchema({ ...device }),
  },
  {
    name: 'open_deeplink',
    description: 'Open a URL or deeplink through the activity manager',
    inputSchema: objectSchema(
      {
        ...device,
        url: { type: 'string', description: 'URL or deeplink to open' },
        package_name: { type: 'string', description: 'Restrict the intent to this package' },
      },
      ['url']
    ),
  },
  {
    name: 'send_broadcast',
    description: 'Broadcast an intent with optional string extras',
    inputSchema: objectSchema(
      {
        ...device,
        action: { type: 'string', description: 'Intent action' },
        extras: {
          type: 'object',
          description: 'String extras as key/value pairs',
          additionalProperties: { type: 'string' },
        },
      },
      ['action']
    ),
  },
  {
    name: 'push_file',
    description: 'Push a local file to the device',
    inputSchema: objectSchema(
      {
        ...device,
        local_path: { type: 'string', description: 'Source path on this machine' },
        remote_path: { type: 'string', description: 'Destination path on the device' },
      },
      ['local_path', 'remote_path']
    ),
  },
  {
    name: 'pull_file',
    description: 'Pull a file from the device to this machine',
    inputSchema: objectSchema(
      {
        ...device,
        remote_path: { type: 'string', description: 'Source path on the device' },
        local_path: { type: 'string', description: 'Destination path on this machine' },
      },
      ['remote_path', 'local_path']
    ),
  },
  {
    name: 'get_setting',
    description: 'Read an Android setting value',
    inputSchema: objectSchema(
      {
        ...device,
        namespace: { type: 'string', enum: ['system', 'secure', 'global'], description: 'Setting namespace' },
        key: { type: 'string', description: 'Setting key' },
      },
      ['namespace', 'key']
    ),
  },
  {
    name: 'put_setting',
    description: 'Write an Android setting value',
    inputSchema: objectSchema(
      {
        ...device,
        namespace: { type: 'string', enum: ['system', 'secure', 'global'], description: 'Setting namespace' },
        key: { type: 'string', description: 'Setting key' },
        value: { type: 'string', description: 'Value to write' },
      },
      ['namespace', 'key', 'value']
    ),
  },
  {
    name: 'list_processes',
    description: 'List running processes, optionally filtered by a substring',
    inputSchema: objectSchema({
      ...device,
      filter: { type: 'string', description: 'Case-insensitive substring filter' },
    }),
  },
  {
    name: 'get_memory_usage',
    description: 'Get the memory usage report for an app',
    inputSchema: objectSchema({ ...device, package_name: { type: 'string', description: 'Package name' } }, [
      'package_name',
    ]),
  },
  {
    name: 'get_battery_info',
    description: 'Get the battery status report',
    inputSchema: objectSchema({ ...device }),
  },
  {
    name: 'list_notifications',
    description: 'List the notifications currently posted on the device',
    inputSchema: objectSchema({ ...device }),
  },
  {
    name: 'get_device_props',
    description: 'Read system properties, optionally filtered by key substring',
    inputSchema: objectSchema({
      ...device,
      filter: { type: 'string', description: 'Case-insensitive key filter (e.g., "version")' },
    }),
  },
  {
    name: 'adb_shell',
    description:
      'Escape hatch: run an arbitrary command in the device shell. Use a dedicated tool when one exists.',
    inputSchema: objectSchema(
      { ...device, command: { type: 'string', description: 'Command to run on the device' } },
      ['command']
    ),
  },

  // ─── Test artifacts ─────────────────────────────────────────────────────────
  {
    name: 'create_test_folder',
    description: 'Create a folder to collect the artifacts of a test run',
    inputSchema: objectSchema(
      { test_name: { type: 'string', description: 'Name of the test folder to create' } },
      ['test_name']
    ),
  },
  {
    name: 'list_artifacts',
    description: 'List the files collected in a test folder',
    inputSchema: objectSchema({ test_name: { type: 'string', description: 'Test folder name' } }, [
      'test_name',
    ]),
  },
];
