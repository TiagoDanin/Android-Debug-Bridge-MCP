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
- **Compressed screenshots** — the full-resolution PNG goes to disk, the caller gets a downscaled copy: ~90% fewer bytes across the wire, which on an MCP client is the difference between a screenshot costing a few hundred tokens and costing a few hundred thousand
- **Marked screenshots** — a ring where the tap landed, drawn on the returned image: Android's own touch indicator exists only while the finger is down, so a screenshot taken afterwards never shows it
- **Emulator console** — `emu finger touch` answers a fingerprint prompt on an AVD, and `emu send` reaches the rest of the virtual hardware
- **System** — Wi-Fi/data/airplane toggles, logcat with package and priority filters, deeplinks, broadcasts, file push/pull, settings read/write, props, processes, memory, battery, notifications
- **Devices** — list, TCP/IP connect, wait-for-boot, reboot, and multi-device targeting by serial, serial prefix, transport id or model name
- **Test artifacts** — per-run folders with numbered screenshots
- **Agent skills** — ready-to-install `SKILL.md` guides for both surfaces, also served by the CLI itself

## Installation

```bash
npm install -g android-debug-bridge-mcp
```

**Prerequisites:** ADB on your PATH (Android platform-tools), and a device with USB debugging enabled or a running emulator.

`sharp` is an optional dependency. When it installs, screenshots come back as JPEG or WebP; when it does not (musl, restricted CI, `--no-optional`), a built-in PNG resizer takes over and everything keeps working — only the output is a bit larger.

Verify everything at once:

```bash
adb-agent doctor
```

```
ok   adb          adb — Android Debug Bridge version 1.0.41
ok   workdir      /home/tiago/project
ok   screenshots  sharp — max width 720, format auto, quality 60
ok   devices      2 ready, targeting emulator-5554 (Pixel_7)
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

### Several devices at once

With one device connected nothing changes. With more than one, every command
needs to know which one it means — otherwise adb answers `more than one
device/emulator` and stops there. Point at it with `--device`, which accepts
anything that identifies the device:

```bash
adb-agent device list
#   emulator-5554  device  Pixel_7    [emulator]
#   R58M12ABCDE    device  SM_A525M

adb-agent --device pixel screen shot          # by model
adb-agent --device R58M app launch com.example.app   # by serial prefix
adb-agent --device emulator-5554 ui tap "Wi-Fi"      # by full serial
```

`ADB_SERIAL` (or `ANDROID_SERIAL`) sets the default for a whole session, and
`device list` marks the device the other commands will use with a `*`. The list
is cached for a few seconds, so the extra lookup costs nothing in a batch —
`--refresh` forces a new one.

### Screenshots

`screen shot` writes the untouched PNG to disk and reports a compressed copy:

```bash
adb-agent screen shot --test login --step 001_home
# /work/login/001_home_step.png (1487233 bytes, 1080x2400)
# returned 41902 bytes image/jpeg 720x1600 — 97% smaller than the 1487233 byte PNG (sharp)
```

`--max-width`, `--quality` and `--format auto|jpeg|webp|png|none` override the
defaults per call, `--no-compress` returns the original bytes, and
`--save-compressed` also writes the small copy next to the PNG.

### Marking where a tap landed

Android draws its touch indicator only while the finger is down, so a
screenshot taken after the action never contains it. `--mark-tap` draws the
marker instead:

```bash
adb-agent input tap 0.5 0.35
adb-agent screen shot --out step.png --mark-tap --save-marked
# step.png (342217 bytes, 1080x2400)
# step.marked.png
# marked (540, 840)
```

`--mark-last <n>` circles the last N gestures, numbered in order, and
`--mark <x,y>` (repeatable) circles arbitrary points; swipes and scrolls get an
arrow along the gesture. The gesture history is shared between commands, so the
tap and the screenshot do not have to run in the same process.

`--mark-tap` draws the newest gesture in the history, with no notion of whether
the screen moved on since: on a capture taken after a click that navigated, the
ring lands on the destination screen at a point nobody touched. Mark the screen
that received the touch and leave the destination capture clean.

The PNG on disk stays untouched — only the returned image carries the marker,
plus a `<name>.marked.png` sibling when `--save-marked` is passed.

For a recording, turn on the device's live indicator instead:

```bash
adb-agent input touches on      # --pointer also enables the crosshair overlay
adb-agent screen record 10 --out flow.mp4
adb-agent input touches off
```

### Emulator console

```bash
adb-agent emu finger touch 1                 # answer a fingerprint prompt
adb-agent emu finger remove
adb-agent emu send geo fix -46.63 -23.55     # any other console command
```

The finger id must already be enrolled on the AVD (Settings → Security), and
the whole group refuses to run against a physical device, which has no console.

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

62 tools grouped by area — devices, UI, input, apps, screen, system, emulator console, artifacts. Every device-facing tool takes an optional `device` (serial, prefix, transport id or model); `list_devices` shows what is connected and which one is the default target. Input tools append a fresh UI snapshot to their result so the agent sees the new screen without a second call (disable with `ADB_AUTO_UI=false`).

`capture_screenshot` returns the compressed image and accepts `max_width`, `quality`, `format` and `save_compressed` when a call needs more (or less) detail than the defaults. It also draws markers: `mark_last_touch` circles the gesture just sent, `mark_last_count` the last N, and `markers` any point you name.

`emu_finger_touch`, `emu_finger_remove` and `emu_console` drive the emulator console; `set_touch_feedback` toggles the device's own touch indicator for recordings.

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
| `ADB_SERIAL` | Default device — serial, prefix or model (also honours `ANDROID_SERIAL`) |
| `ADB_DEVICE_CACHE_MS` | How long the device list is cached, in ms (default 3000, `0` disables) |
| `ADB_SETTLE_MS` | Delay after UI-mutating actions in ms (default 300) |
| `ADB_BATCH_DELAY_MS` | Pause after each batch action in ms (default 300, `--delay` overrides) |
| `ADB_ARTIFACT_DIR` | Where screenshots and recordings are written (default cwd) |
| `ADB_FALLBACK_CWD` | Directory to move to when the working directory is unusable |
| `ADB_SCREENSHOT_MAX_WIDTH` | Width of the returned screenshot (default 720, `0` keeps the original) |
| `ADB_SCREENSHOT_QUALITY` | Lossy quality 1..100 for jpeg/webp (default 60) |
| `ADB_SCREENSHOT_FORMAT` | `auto`, `jpeg`, `webp`, `png` or `none` (default `auto`) |
| `ADB_MARKER_COLOR` | Colour of the screenshot markers as hex (default `#ff2d55`) |
| `ADB_TOUCH_HISTORY` | Set to `off` to keep the gesture history in memory only |
| `ADB_TOUCH_HISTORY_FILE` | Where the gesture history is stored (default: temp folder) |
| `ADB_AUTO_UI` | Set to `false` to stop MCP input tools appending a UI snapshot |
| `ADB_SKILLS_DIR` | Override the folder holding the `SKILL.md` files |

## Troubleshooting

**`more than one device/emulator`** — two or more devices are connected and the
command did not say which one. Run `adb-agent device list` (or the
`list_devices` tool) and pass `--device` / the `device` parameter, or export
`ADB_SERIAL`. The error message already lists the candidates.

**`ENOENT: no such file or directory, uv_cwd`** — the directory the process was
started in no longer resolves. It happens under WSL when a Windows path drops
out of `/mnt`, and whenever a client spawns the server from a folder that is
later deleted. Both entry points detect it at startup and move to
`ADB_ARTIFACT_DIR`, `ADB_FALLBACK_CWD`, `$HOME` or the temp directory, warning
on stderr and carrying on. Set `ADB_ARTIFACT_DIR` to an absolute path to decide
where artifacts land instead of leaving it to the fallback.

**Screenshots come back as PNG instead of JPEG** — `sharp` is not installed
(check `adb-agent doctor`). Install it with `npm install sharp`, or keep the
built-in resizer and lower `ADB_SCREENSHOT_MAX_WIDTH` if the payload is still
too big.

**`adb executable not found`** — set `ADB_PATH` to the binary, which is the
usual fix under WSL when platform-tools live on the Windows side
(`ADB_PATH=/mnt/c/Android/platform-tools/adb.exe`).

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
