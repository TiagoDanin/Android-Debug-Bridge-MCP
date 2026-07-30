# Android Debug Bridge MCP

Control Android devices and emulators from an AI agent — over **MCP** or straight from the **terminal**.

Both surfaces share one engine, so anything you can do as an MCP tool call you can also do as a shell command, and vice versa.

| Surface | Entry point | Best for |
|---------|-------------|----------|
| MCP server | `android-debug-bridge-mcp` | Screenshots rendered inline in the conversation, step-by-step reasoning |
| CLI | `adb-agent` | Chained flows in one shell call, scripts, CI |

## Features

- **UI automation that survives layout changes** — parse the accessibility tree, find elements by label/description/resource-id, and tap them by name instead of by coordinate
- **Occlusion-aware taps** — the accessibility tree has no z-order, so an element under a bottom bar still claims those pixels; `ui tap` finds an uncovered point inside the target and refuses (instead of silently hitting the overlay) when there is none
- **Normalized coordinates** — `0.5 0.7` means the same point on any screen size; raw pixels still work
- **Input** — tap, double tap, long press, swipe, scroll, type, clear fields, and 40+ hardware/software keys
- **Apps** — list, launch (with launcher-activity resolution), stop, restart, clear data, install/uninstall, inspect versions, grant/revoke runtime permissions
- **Screen** — screenshots to disk and base64, screen recording, rotation, wake/sleep, PIN unlock
- **System** — Wi-Fi/data/airplane toggles, logcat with package and priority filters, deeplinks, broadcasts, file push/pull, settings read/write, props, processes, memory, battery, notifications
- **Devices** — list, TCP/IP connect, wait-for-boot, reboot, multi-device targeting
- **Test artifacts** — per-run folders with numbered screenshots
- **Agent skills** — ready-to-install `SKILL.md` guides for both surfaces, also served by the CLI itself

## Installation

```bash
npm install -g android-debug-bridge-mcp
```

**Prerequisites:** ADB on your PATH (Android platform-tools), and a device with USB debugging enabled or a running emulator.

Verify everything at once:

```bash
adb-agent doctor
```

```
ok   adb          adb — Android Debug Bridge version 1.0.41
ok   devices      1 ready: emulator-5554
ok   uiautomator  24 elements on screen
```

## CLI usage

```bash
adb-agent <group> <command> [arguments] [flags]
```

```bash
adb-agent device list --json
adb-agent app launch com.android.settings
adb-agent ui find "Wi-Fi"
adb-agent ui tap "Wi-Fi"
adb-agent input text "hello world" --submit
adb-agent screen shot --test login --step 001_home
adb-agent system logcat --package com.example.app --priority E --lines 50
```

Groups: `device`, `ui`, `input`, `app`, `screen`, `system`, `test`, `skills`, `doctor`, plus `batch`.
Run `adb-agent <group> --help` for a group's commands.

### Chaining

Every command exits non-zero on failure, so shell chaining just works:

```bash
adb-agent app restart com.example.app \
  && adb-agent ui wait "Email" --timeout 15000 \
  && adb-agent ui tap "Email" \
  && adb-agent input text "user@example.com"
```

`batch` does the same in one process, with one report and a `wait <ms>` step for pauses:

```bash
adb-agent batch \
  "app restart com.example.app" \
  "ui wait Email --timeout 15000" \
  "ui tap Email" \
  "input text user@example.com" \
  "wait 500" \
  "ui tap Continue" \
  "screen shot --test login --step 002_submitted" \
  --json
```

Steps stop at the first failure unless you pass `--continue-on-error`, and can come from a file (`--file steps.txt`) or stdin (`batch -`).

### JSON contract

```json
{"ok":true,"command":"ui.tap","summary":"tapped \"Sign in\" at (540, 1284)","data":{…}}
{"ok":false,"command":"ui.tap","error":{"message":"no element matches \"Sign in\"","name":"Error"}}
```

One line, always the same shape — pipe it straight into `jq`:

```bash
adb-agent ui dump --json | jq -r '.data.elements[] | select(.clickable) | .label'
```

## MCP usage

### Claude Code

```bash
claude mcp add --scope project android-debug-bridge -- npx android-debug-bridge-mcp
```

Or in `~/.claude/mcp.json`:

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

### Claude Desktop

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

### Cursor

Settings → Extensions → MCP → add a server with command `npx` and args `["android-debug-bridge-mcp"]`.

### Tools

58 tools grouped by area — devices, UI, input, apps, screen, system, artifacts. Every tool takes an optional `device` serial. Input tools append a fresh UI snapshot to their result so the agent sees the new screen without a second call (disable with `ADB_AUTO_UI=false`).

See [`skills/adb-mcp/SKILL.md`](./skills/adb-mcp/SKILL.md) for the full list and the recommended flow.

## Agent skills

Two `SKILL.md` guides ship with the package:

```bash
cp -r node_modules/android-debug-bridge-mcp/skills/adb-cli .claude/skills/
cp -r node_modules/android-debug-bridge-mcp/skills/adb-mcp .claude/skills/
```

The CLI also prints them, so an agent that has the CLI but not the skill installed can read them without hunting for the path:

```bash
adb-agent skills list
adb-agent skills get adb-cli
```

See [`skills/README.md`](./skills/README.md) for details.

## Environment

| Variable | Effect |
|----------|--------|
| `ADB_PATH` | Path to the adb binary (default: `adb` from PATH) |
| `ADB_SERIAL` | Default device serial (also honours `ANDROID_SERIAL`) |
| `ADB_SETTLE_MS` | Delay after UI-mutating actions in ms (default 300) |
| `ADB_ARTIFACT_DIR` | Where screenshots and recordings are written (default cwd) |
| `ADB_AUTO_UI` | Set to `false` to stop MCP input tools appending a UI snapshot |
| `ADB_SKILLS_DIR` | Override the folder holding the `SKILL.md` files |

## Development

```bash
yarn install
yarn build       # compile to dist/
yarn dev         # watch mode
yarn start       # run the MCP server
yarn cli -- doctor
```

## License

MIT
