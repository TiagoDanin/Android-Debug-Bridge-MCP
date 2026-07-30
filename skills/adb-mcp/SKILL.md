---
name: adb-mcp
description: >
  Control an Android device or emulator through the Android-Debug-Bridge-MCP
  server tools: read the accessibility tree, tap elements by label, type,
  gesture, install and launch apps, reset app state, grant permissions, capture
  screenshots inline, record the screen, read logcat, fire deeplinks and change
  device settings. Reach for these tools when screenshots belong in the
  transcript; the `adb-cli` skill covers the same engine as shell commands for
  flows that are better chained.
license: MIT
---

# ADB MCP Tools

The `android-debug-bridge` MCP server exposes an Android device to the agent as
tools. Every tool takes an optional `device` argument (a serial) and defaults to
`ADB_SERIAL` or the only connected device.

The same engine is available as the `adb-agent` CLI — see the `adb-cli` skill.
Reach for the CLI when a flow is a straight sequence of steps you want to chain
in one shell call; reach for these tools when you want images in the transcript
and per-step reasoning.

## Before the first action

Call `list_devices`. If it comes back empty, tell the user to start an emulator
or connect a device with USB debugging enabled — do not keep trying other tools,
they will all fail the same way.

Then call `device_info` once. Screen size, Android version and emulator status
shape everything after it: which coordinates are valid, whether a permission
model applies, whether a hardware key exists.

## The core loop

Read, act, verify:

1. **`capture_ui_dump`** or **`ui_find`** to see what is on screen.
2. **`ui_tap`** with a label, not `input_tap` with a guess.
3. **`ui_wait_for`** before touching the next screen, then repeat.

`ui_tap` re-reads the tree, ranks matches on text, content-description and
resource-id, prefers clickable and enabled elements, and taps the best one.
Fixed coordinates break on a different device; labels usually do not.

Every input tool (`input_tap`, `input_text`, `input_scroll`, `input_keyevent`,
`ui_tap`, …) already appends a fresh UI snapshot to its result, so you normally
do not need a separate dump after acting. Set `ADB_AUTO_UI=false` in the server
environment to turn that off when the extra output is not worth the tokens.

## Tools by area

**Devices** — `list_devices`, `device_info`, `connect_device`,
`disconnect_device`, `wait_for_device`, `reboot_device`

**UI** — `capture_ui_dump`, `ui_find`, `ui_tap`, `ui_wait_for`

**Input** — `input_tap`, `input_double_tap`, `input_long_press`, `input_swipe`,
`input_scroll`, `input_text`, `input_keyevent`, `input_clear_text`

**Apps** — `list_apps`, `open_app`, `stop_app`, `restart_app`, `clear_app_data`,
`app_info`, `install_apk`, `reinstall_apk`, `uninstall_app`, `grant_permission`,
`revoke_permission`, `get_current_activity`, `get_focused_window`

**Screen** — `capture_screenshot`, `record_screen`, `rotate_screen`,
`screen_state`, `wake_screen`, `sleep_screen`, `unlock_device`

**System** — `toggle_wifi`, `toggle_mobile_data`, `toggle_airplane_mode`,
`get_connectivity_state`, `read_logcat`, `clear_logcat`, `open_deeplink`,
`send_broadcast`, `push_file`, `pull_file`, `get_setting`, `put_setting`,
`list_processes`, `get_memory_usage`, `get_battery_info`, `list_notifications`,
`get_device_props`, `adb_shell`

**Artifacts** — `create_test_folder`, `list_artifacts`

## Coordinates

`input_tap`, `input_swipe`, `input_long_press` and `input_double_tap` read
coordinates as normalized 0..1 screen fractions when both values fall in that
range, and as raw pixels otherwise. Set `mode` to `"normalized"` or `"pixels"`
to be explicit. Coordinates that come out of a UI dump are already pixels, so
pass them through as-is.

## Testing a flow

1. `create_test_folder` with a descriptive run name.
2. `clear_logcat` so the log only holds this run.
3. `restart_app` (or `clear_app_data` then `open_app` for a first-run state).
4. Walk the flow with `ui_wait_for` → `ui_tap` → `input_text`, calling
   `capture_screenshot` with `test_name` and a numbered `step_name` at each
   screen worth keeping.
5. `read_logcat` with `package_name` and `priority: "E"` to catch anything that
   failed quietly.
6. `list_artifacts` to report what was collected.

Screenshots land in `{ADB_ARTIFACT_DIR or cwd}/{test_name}/{step_name}_step.png`
and are also returned inline as an image.

## Shortcuts that avoid whole classes of failure

- **`open_deeplink`** jumps straight to a screen instead of tapping through
  navigation — the single biggest reliability win in a long flow.
- **`grant_permission`** pre-grants runtime permissions so no system dialog ever
  appears. `install_apk` with `grant_permissions: true` does it at install time.
- **`put_setting`** can disable animations before a run
  (`global.window_animation_scale = 0`), which removes most timing flakiness.
- **`send_broadcast`** triggers a receiver directly when the UI path to it is
  long or unstable.

## Pitfalls

- **`input_text` is ASCII-only.** Non-Latin characters are reported back in the
  result as unsupported; when that happens, do not pretend the field was filled.
- **`clear_app_data` is destructive.** It wipes accounts, databases and caches.
  Use `restart_app` when you only want a clean process.
- **A dump is a snapshot.** Prefer `ui_wait_for` over sleeping when a screen is
  still loading or animating.
- **WebViews expose almost nothing** to the accessibility tree. Fall back to
  `capture_screenshot` plus normalized `input_tap` coordinates.
- **Multiple devices are not guessed.** Tools fail with the list of serials;
  pass `device` explicitly.
- **`adb_shell` is the escape hatch.** Use a dedicated tool when one exists —
  the dedicated tools parse output into structured data, `adb_shell` does not.

## Setup

```bash
claude mcp add --scope project android-debug-bridge -- npx android-debug-bridge-mcp
```

Server environment: `ADB_PATH`, `ADB_SERIAL`, `ADB_SETTLE_MS`,
`ADB_ARTIFACT_DIR`, `ADB_AUTO_UI`.
