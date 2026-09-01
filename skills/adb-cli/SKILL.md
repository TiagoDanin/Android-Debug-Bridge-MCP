---
name: adb-cli
description: >
  Drive an Android device or emulator from the shell with the `adb-agent` CLI:
  read the accessibility tree, tap elements by label, type, gesture, install and
  launch apps, grant permissions, take screenshots, record the screen, read
  logcat, fire deeplinks. Every command speaks `--json` and exits non-zero on
  failure, so flows chain in one shell call. The `adb-mcp` skill covers the same
  engine exposed as MCP tools.
license: MIT
---

# ADB Agent CLI

`adb-agent` lets you drive a connected Android device or emulator from a normal
shell. It is the terminal half of
[Android-Debug-Bridge-MCP](https://github.com/TiagoDanin/Android-Debug-Bridge-MCP)
— the MCP server drives the same engine through tool calls instead.

Use the CLI when the flow is a sequence of steps you want to chain in one call,
when artifacts should land on disk, or when the same flow has to run in a script
or CI job. Use the MCP tools when you want screenshots inline in the
conversation.

If `adb-agent` is not on the PATH, `npx -p android-debug-bridge-mcp adb-agent`
works anywhere, and `node dist/cli/index.js` works inside a built checkout.

## Start with doctor

```bash
adb-agent doctor
```

Five checks: adb on the PATH, a usable working directory, the screenshot
encoder in use, exactly one device to target, and `uiautomator` able to dump the
current screen. Every other command depends on those, so fix what it reports
before going further — a red `doctor` means the failures you see later will be
misleading. It also names the device that unqualified commands will hit, which
is the fastest way to notice you are driving the wrong emulator.

## The two rules that matter

**1. Read the screen before you act.** Never tap coordinates you guessed. Dump
the tree, find the element, then act on it:

```bash
adb-agent ui find "Sign in" --json
adb-agent ui tap "Sign in"
```

`ui tap` re-reads the screen, ranks matches against text, content-description
and resource-id, and taps the best one. It survives layout and resolution
changes in a way fixed coordinates do not.

**2. Coordinates are fractions by default.** `input tap 0.5 0.7` taps the middle
of the lower half on any screen size. Values above 1 are pixels. Force either
reading with `--norm` or `--px`.

## Command surface

Every command accepts `--json`, `-d/--device <ref>` and `-q/--quiet`. Run
`adb-agent <group> --help` for the exact usage of a group. `--device` takes a
full serial, a serial prefix, a transport id or a model name, so
`-d pixel` and `-d emulator-5554` reach the same device.

| Group | What it covers |
|-------|----------------|
| `device` | `list`, `info`, `connect`, `disconnect`, `wait`, `reboot` |
| `ui` | `dump`, `find`, `tap`, `wait` |
| `input` | `tap`, `double-tap`, `long-press`, `swipe`, `scroll`, `text`, `key`, `keys`, `clear`, `touches` |
| `app` | `list`, `launch`, `stop`, `restart`, `clear`, `info`, `install`, `uninstall`, `grant`, `revoke`, `current` |
| `screen` | `shot`, `record`, `rotate`, `state`, `wake`, `sleep`, `unlock` |
| `system` | `wifi`, `data`, `airplane`, `connectivity`, `logcat`, `clear-logcat`, `deeplink`, `broadcast`, `push`, `pull`, `setting`, `props`, `processes`, `memory`, `battery`, `notifications`, `shell` |
| `emu` | `finger`, `send` — the emulator console, emulators only |
| `test` | `folder`, `artifacts` |
| `skills` | `list`, `get` |
| `doctor` | one-shot environment check |

## Chaining

Three ways to sequence work, in increasing order of structure.

**Shell chaining** — stop at the first failure, because every command exits
non-zero on error:

```bash
adb-agent app restart com.example.app \
  && adb-agent ui wait "Email" --timeout 15000 \
  && adb-agent ui tap "Email" \
  && adb-agent input text "user@example.com" \
  && adb-agent screen shot --test login --step 001_filled
```

**`batch`** — one process, one report, same stop-on-first-failure semantics.
It paces itself the way an agent works, print → action → print: 300ms after
every action, before the next step looks at the screen (`--delay <ms>`,
`--delay 0` to run flat out). Reads wait for nothing. `wait <ms>` is available
as a step for a longer, explicit pause, and replaces the automatic one:

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

With `--json`, batch returns one envelope containing every step:

```json
{"ok":true,"command":"batch","summary":"7/7 steps succeeded","data":{"steps":[…],"failed":0}}
```

The delay is what keeps a step from reading a half-drawn screen: an action
returns as soon as adb does, which on a tap that navigates is well before the
next screen exists. It covers the screen transition — not a screen that loads
over the network, which still shows its skeleton after 300ms. Raise it for a
slow app (`--delay 1000`), or better, wait for the content itself:

```bash
# brittle: hopes 1500ms is enough
adb-agent batch "ui tap Extrato" "wait 1500" "screen shot --mark-tap"
# robust: proceeds the moment the screen actually has data
adb-agent batch "ui tap Extrato" "ui wait 'Saldo atual'" "screen shot --mark-tap"
```

Add `--continue-on-error` to run the remaining steps anyway and collect all the
failures. Steps can also come from a file (`--file steps.txt`, `#` comments
allowed) or from stdin (`batch -`).

**Piping JSON** — every `--json` payload is a single line, so `jq` works
directly:

```bash
adb-agent ui find "" --clickable --json | jq -r '.data.matches[].label'
adb-agent device list --json | jq -r '.data[] | select(.state=="device") | .serial'
adb-agent device list --json | jq -r '.data[] | select(.default) | .serial'
```

## JSON contract

Success and failure share one envelope shape, so a wrapper never has to parse
prose:

```json
{"ok":true,"command":"ui.tap","summary":"tapped \"Sign in\" at (540, 1284)","data":{…}}
{"ok":false,"command":"ui.tap","error":{"message":"no element matches \"Sign in\"","name":"Error"}}
```

Exit code is `0` on success and `1` on failure. `--json` writes the envelope to
stdout; without it, the human summary goes to stdout and errors to stderr.

## Recipes

**Walk an unfamiliar screen.** Dump once, then work from the labels:

```bash
adb-agent screen state
adb-agent ui dump --json | jq -r '.data.elements[] | select(.clickable) | "\(.label) @ \(.center.x),\(.center.y)"'
```

**Verify a flow end to end and prove it with artifacts:**

```bash
adb-agent test folder checkout
adb-agent system clear-logcat
adb-agent batch --file flows/checkout.txt --json > checkout-result.json
adb-agent system logcat --package com.example.app --priority E --lines 100
adb-agent test artifacts checkout
```

**Reset to a clean state before a run:**

```bash
adb-agent app clear com.example.app     # destructive: wipes accounts and data
adb-agent app launch com.example.app
```

**Grant permissions instead of fighting system dialogs:**

```bash
adb-agent app grant com.example.app CAMERA
adb-agent app grant com.example.app ACCESS_FINE_LOCATION
```

**Jump straight to a screen with a deeplink** — far more reliable than tapping
through navigation:

```bash
adb-agent system deeplink "myapp://checkout/cart" --package com.example.app
```

**See where a tap actually landed.** The device only draws its own touch
indicator while the finger is down, so a screenshot taken afterwards never
shows it. `--mark-tap` circles the last gesture on the returned image instead,
and `--save-marked` writes the annotated PNG next to the original:

```bash
adb-agent input tap 0.5 0.35
adb-agent screen shot --out step.png --mark-tap --save-marked
adb-agent screen shot --mark-last 3            # the last three gestures, numbered
adb-agent screen shot --mark 0.5,0.7 --mark 120,900   # arbitrary points
```

Swipes and scrolls get an arrow along the gesture. The history survives between
commands (a small JSON file in the temp folder), so the tap and the screenshot
do not have to share a process.

For a **recording**, turn on the device's own indicator instead — it is drawn
live, so it shows up frame by frame:

```bash
adb-agent input touches on          # add --pointer for the crosshair overlay
adb-agent screen record 10 --out flow.mp4
adb-agent input touches off
```

**Answer a fingerprint prompt on an emulator:**

```bash
adb-agent emu finger touch 1        # finger id 1, already enrolled in Settings
adb-agent emu finger remove
adb-agent emu send geo fix -46.63 -23.55    # any other console command
```

**Check for crashes after an action:**

```bash
adb-agent system logcat --filter "FATAL EXCEPTION" --lines 50
adb-agent app current
```

## Pitfalls

- **`input text` is ASCII-only.** `adb shell input text` cannot transmit
  accented or non-Latin characters. The command reports the characters it could
  not send under `data.unsupported`; when that list is non-empty, either paste
  the value another way or ask the user to type it.
- **Multiple devices need a target.** With more than one device attached,
  commands fail with the list of candidates instead of guessing. Pass
  `-d <serial|prefix|model>` or export `ADB_SERIAL` once for the session;
  `device list` marks the current default with `*`.
- **`screen shot` returns a shrunken image.** The PNG on disk is full
  resolution, but the reported copy is downscaled (720px wide by default) and
  compressed. Use `--max-width`/`--format` when detail matters, or
  `--no-compress` for the untouched bytes.
- **A dumped tree is a snapshot.** Animations and async loads invalidate it, so
  prefer `ui wait <query>` over `wait 3000` before acting on a fresh screen.
- **The tree has no z-order.** Bounds overlap freely and nothing says which
  element is on top. `ui tap` compensates, but a raw `input tap` on coordinates
  read out of a dump does not — check for a bottom bar or FAB over the point
  before trusting it.
- **WebViews expose little.** Inside a WebView the accessibility tree is often
  a single node. Fall back to normalized coordinates read off a screenshot.
- **`app clear` is destructive** — it wipes accounts, databases and caches. Use
  `app restart` when you only want a fresh process.
- **`screen record` blocks** for the whole duration and caps at 180 seconds.
- **`input touches` will not show up in a screenshot.** Android draws the
  indicator only while the finger is down, and `screen shot` runs after the
  gesture is over. It works in `screen record`; for a still image use
  `screen shot --mark-tap`.
- **`--mark-tap` marks the last gesture, not "the click on this screen".** It
  draws whatever is newest in the history, so on a capture taken after a click
  that navigated, the ring lands on the destination screen at a point nobody
  touched. Mark the screen that received the touch (`--mark <x,y>` on the
  capture before the tap) and leave the destination capture clean.
- **`emu` needs an emulator.** The console does not exist on physical devices,
  and `emu finger touch` only accepts a finger id already enrolled on the AVD.

## Environment

| Variable | Effect |
|----------|--------|
| `ADB_PATH` | Path to the adb binary (default: `adb` from PATH) |
| `ADB_SERIAL` | Default device for every command — serial, prefix or model |
| `ADB_DEVICE_CACHE_MS` | How long the device list is cached (default 3000) |
| `ADB_SETTLE_MS` | Delay after UI actions in ms (default 300) |
| `ADB_BATCH_DELAY_MS` | Pause after each batch action in ms (default 300, `--delay` wins) |
| `ADB_ARTIFACT_DIR` | Where screenshots/recordings are written (default cwd) |
| `ADB_FALLBACK_CWD` | Directory to move to when the working directory is gone |
| `ADB_SCREENSHOT_MAX_WIDTH` | Width of the returned screenshot (default 720, `0` = original) |
| `ADB_SCREENSHOT_QUALITY` | Lossy quality 1..100 (default 60) |
| `ADB_SCREENSHOT_FORMAT` | `auto`, `jpeg`, `webp`, `png` or `none` (default `auto`) |
| `ADB_MARKER_COLOR` | Colour of the screenshot markers as hex (default `#ff2d55`) |
| `ADB_TOUCH_HISTORY` | `off` keeps the gesture history in memory only |
| `ADB_TOUCH_HISTORY_FILE` | Where the gesture history is stored (default: temp folder) |
| `ADB_SKILLS_DIR` | Override the folder holding these SKILL.md files |

## Reading this file from the CLI

`adb-agent skills list` and `adb-agent skills get adb-cli` print these guides, so
an agent that has the CLI but not the skill installed can still read them
without hunting for the file.
