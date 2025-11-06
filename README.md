# Android Debug Bridge MCP

MCP plugin to control Android devices via ADB for automation, testing, and agent integration.

<a href="https://glama.ai/mcp/servers/@TiagoDanin/Android-Debug-Bridge-MCP">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@TiagoDanin/Android-Debug-Bridge-MCP/badge" alt="Android Debug Bridge MCP server" />
</a>

## Features

This MCP server provides tools to:

- **Test Management**: Create test folders for organizing automation tests
- **App Control**: List installed apps by name pattern and open apps by package name
- **Screen Capture**: Take screenshots and save them to organized test folders
- **UI Analysis**: Capture UI hierarchy dumps for element inspection
- **Input Simulation**: 
  - Send key events (BACK, HOME, ENTER, DELETE)
  - Tap at specific coordinates
  - Input text into active fields
  - Scroll in any direction (up, down, left, right)

## Installation

Install the package globally via npm:

```bash
npm install -g android-debug-bridge-mcp
```

## Setup for Different AI Clients

### Claude Code (CLI)

Add to your MCP configuration in `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "android-debug-bridge": {
      "command": "npx",
      "args": ["android-debug-bridge-mcp"]
    }
  }
}
```

or 

```bash
claude mcp add --scope project android-debug-bridge-mcp -- npx android-debug-bridge-mcp
```

### Cursor

Add to your MCP configuration in Cursor settings:

1. Open Cursor Settings
2. Navigate to Extensions → MCP
3. Add a new server with:
   - **Name**: `android-debug-bridge`
   - **Command**: `npx`
   - **Args**: `["android-debug-bridge-mcp"]`

### Claude Desktop

Add to your MCP configuration file:

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "android-debug-bridge": {
      "command": "npx",
      "args": ["android-debug-bridge-mcp"]
    }
  }
}
```

## Prerequisites

- Android Debug Bridge (ADB) must be installed and available in your PATH
- Android device with USB debugging enabled, or Android emulator running
- Device must be connected and authorized for debugging

## Usage

Once configured, you can interact with Android devices through your AI client by asking questions like:

- "Create a test folder called 'login_test'"
- "List all apps with 'chrome' in the name"
- "Open the app com.android.chrome"
- "Take a screenshot and save it as step '001_homepage'"
- "Capture the current UI hierarchy in my app"
- ...

## License

MIT