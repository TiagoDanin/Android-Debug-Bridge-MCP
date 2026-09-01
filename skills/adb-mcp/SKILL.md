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
tools. Every device-facing tool takes an optional `device` argument — a full
serial, a serial prefix, a transport id or a model name — and defaults to
`ADB_SERIAL` or the only connected device.

The same engine is available as the `adb-agent` CLI — see the `adb-cli` skill.
Reach for the CLI when a flow is a straight sequence of steps you want to chain
in one shell call; reach for these tools when you want images in the transcript
and per-step reasoning.

## Before the first action

Call `list_devices`. If it comes back empty, tell the user to start an emulator
or connect a device with USB debugging enabled — do not keep trying other tools,
they will all fail the same way. If it lists more than one device, the result
says whether there is a default target; when there is none, pick one and pass
`device` on every later call rather than letting each tool fail in turn.

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

`ui_tap` also refuses to tap through an overlay. The tree reports full logical
bounds with no notion of what is painted on top, so a banner under a bottom bar
still claims those pixels — tapping its center fires the bar and reports
success for the wrong element. The tool looks for an uncovered point inside the
element first, and errors with the name of the blocker when there is none. Pass
`force: true` to override once you know what is on top.

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
`get_connectivity_state`, `set_touch_feedback`, `read_logcat`, `clear_logcat`,
`open_deeplink`, `send_broadcast`, `push_file`, `pull_file`, `get_setting`,
`put_setting`, `list_processes`, `get_memory_usage`, `get_battery_info`,
`list_notifications`, `get_device_props`, `adb_shell`

**Emulator console** — `emu_finger_touch`, `emu_finger_remove`, `emu_console`
(emulators only — the virtual hardware an `adb shell` cannot reach)

**Artifacts** — `create_test_folder`, `list_artifacts`

## Showing where a tap landed

Android draws its touch indicator only while the finger is down, so a
screenshot taken after the action never contains it. `capture_screenshot`
draws the marker itself instead:

- `mark_last_touch: true` circles the gesture you just sent; `mark_last_count`
  circles the last N, numbered in order.
- `markers: [{x, y}]` circles arbitrary points — same 0..1-or-pixels reading as
  every other coordinate — and a marker with `to` draws an arrow, for gestures.
- `save_marked: true` also writes the annotated PNG beside the original as
  `<name>.marked.png`. Without it the file on disk stays untouched and only the
  returned image carries the marker.

This is how to confirm a tap hit what you meant, or to show a human where a
flow went wrong. `set_touch_feedback` toggles the device's own live indicator
instead — useful for `record_screen`, useless for a still image.

## Biometric prompts

On an emulator, `emu_finger_touch` answers a fingerprint prompt (`finger_id`
defaults to 1, and it must already be enrolled in Settings → Security).
`emu_console` sends any other console command — `geo fix`, `sms send`,
`power capacity`. Both fail with a clear message on a physical device.

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
at full resolution, while the image returned inline is downscaled and
compressed — the file on disk stays the artifact of record. Raise `max_width`
(or set `format: "none"`) only when you genuinely need to read fine detail such
as small text; the default is enough to see layout, state and labels.

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
- **The tree has no z-order.** `ui_tap` compensates, but coordinates you read
  out of a dump and feed to `input_tap` are unguarded — check whether a bottom
  bar or FAB sits over the point first.
- **WebViews expose almost nothing** to the accessibility tree. Fall back to
  `capture_screenshot` plus normalized `input_tap` coordinates.
- **Multiple devices are not guessed.** Tools fail with the list of candidates;
  pass `device` explicitly — the serial, a prefix of it, or the model name.
- **`set_touch_feedback` is invisible in screenshots.** It is drawn only while
  the finger is down; use `capture_screenshot` with `mark_last_touch` instead.
- **`adb_shell` is the escape hatch.** Use a dedicated tool when one exists —
  the dedicated tools parse output into structured data, `adb_shell` does not.

## Setup

```bash
claude mcp add --scope project android-debug-bridge -- npx android-debug-bridge-mcp
```

Server environment: `ADB_PATH`, `ADB_SERIAL`, `ADB_SETTLE_MS`,
`ADB_ARTIFACT_DIR`, `ADB_AUTO_UI`, plus `ADB_SCREENSHOT_MAX_WIDTH`,
`ADB_SCREENSHOT_QUALITY` and `ADB_SCREENSHOT_FORMAT` to change the compression
defaults for a whole session.
