export const toolDefinitions = [
  {
    name: 'create_test_folder',
    description: 'Create a test folder with the specified name',
    inputSchema: {
      type: 'object',
      properties: {
        test_name: {
          type: 'string',
          description: 'Name of the test folder to create',
        },
      },
      required: ['test_name'],
    },
  },
  {
    name: 'list_apps',
    description: 'List installed apps matching a name pattern',
    inputSchema: {
      type: 'object',
      properties: {
        app_name: {
          type: 'string',
          description: 'Name pattern to search for in app packages',
        },
      },
      required: ['app_name'],
    },
  },
  {
    name: 'open_app',
    description: 'Open an app using its package name and activity',
    inputSchema: {
      type: 'object',
      properties: {
        package_name: {
          type: 'string',
          description: 'Full package name of the app (e.g., com.example.app)',
        },
      },
      required: ['package_name'],
    },
  },
  {
    name: 'capture_screenshot',
    description: 'Capture a screenshot and save it to the test folder',
    inputSchema: {
      type: 'object',
      properties: {
        test_name: {
          type: 'string',
          description: 'Name of the test folder where to save the screenshot',
        },
        step_name: {
          type: 'string',
          description: 'Name of the step for the screenshot file (e.g., "001_login")',
        },
      },
      required: ['test_name', 'step_name'],
    },
  },
  {
    name: 'capture_ui_dump',
    description: 'Capture UI hierarchy dump from the device',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'input_keyevent',
    description: 'Send key events (BACK, HOME, ENTER, DELETE)',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          enum: ['BACK', 'HOME', 'ENTER', 'DELETE'],
          description: 'Key event to send',
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'input_tap',
    description: 'Tap at specific coordinates',
    inputSchema: {
      type: 'object',
      properties: {
        x: {
          type: 'number',
          description: 'X coordinate for tap',
        },
        y: {
          type: 'number',
          description: 'Y coordinate for tap',
        },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'input_text',
    description: 'Input text into the current field',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to input',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'input_scroll',
    description: 'Perform scroll action',
    inputSchema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'Direction to scroll',
        },
      },
      required: ['direction'],
    },
  },
  {
    name: 'list_devices',
    description: 'List connected ADB devices',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'connect_device',
    description: 'Connect to a specific ADB device via IP address and port',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Device address in the format host:port (e.g., 192.168.1.100:5555)',
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'get_current_activity',
    description: 'Get the current resumed activity on the device',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_focused_window',
    description: 'Get the current focused window on the device',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_processes',
    description: 'List running processes on the device',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_memory_usage',
    description: 'Get memory usage of a specific application',
    inputSchema: {
      type: 'object',
      properties: {
        package_name: {
          type: 'string',
          description: 'Package name of the app (e.g., com.android.chrome)',
        },
      },
      required: ['package_name'],
    },
  },
  {
    name: 'toggle_wifi',
    description: 'Enable or disable Wi-Fi on the device',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'true to enable Wi-Fi, false to disable',
        },
      },
      required: ['enabled'],
    },
  },
  {
    name: 'toggle_mobile_data',
    description: 'Enable or disable mobile data on the device',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'true to enable mobile data, false to disable',
        },
      },
      required: ['enabled'],
    },
  },
  {
    name: 'install_apk',
    description: 'Install an APK on the device',
    inputSchema: {
      type: 'object',
      properties: {
        apk_path: {
          type: 'string',
          description: 'Path to the APK file to install',
        },
      },
      required: ['apk_path'],
    },
  },
  {
    name: 'reinstall_apk',
    description: 'Reinstall (replace) an existing APK on the device',
    inputSchema: {
      type: 'object',
      properties: {
        apk_path: {
          type: 'string',
          description: 'Path to the APK file to reinstall',
        },
      },
      required: ['apk_path'],
    },
  },
  {
    name: 'uninstall_app',
    description: 'Uninstall an application from the device',
    inputSchema: {
      type: 'object',
      properties: {
        package_name: {
          type: 'string',
          description: 'Package name of the app to uninstall (e.g., com.example.app)',
        },
      },
      required: ['package_name'],
    },
  },
];