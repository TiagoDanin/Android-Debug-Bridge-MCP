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

Three checks: adb on the PATH, a device in the `device` state, and `uiautomator`
able to dump the current screen. Every other command depends on all three, so
fix what it reports before going further — a red `doctor` means the failures you
see later will be misleading.

## The two rules that matter

**1. Read the screen before you act.** Never tap coordinates you guessed. Dump
the tree, find the element, then act on it:

```bash
adb-agent ui find "Sign in" --json
adb-agent ui tap "Sign in"
```

`ui tap` re-reads the screen, ranks matches against text, content-description
and resource-id, and taps the center of the best one. It survives layout and
resolution changes in a way fixed coordinates do not.

**2. Coordinates are fractions by default.** `input tap 0.5 0.7` taps the middle
of the lower half on any screen size. Values above 1 are pixels. Force either
reading with `--norm` or `--px`.

## Command surface

Every command accepts `--json`, `-d/--device <serial>` and `-q/--quiet`. Run
`adb-agent <group> --help` for the exact usage of a group.

| Group | What it covers |
|-------|----------------|
| `device` | `list`, `info`, `connect`, `disconnect`, `wait`, `reboot` |
| `ui` | `dump`, `find`, `tap`, `wait` |
| `input` | `tap`, `double-tap`, `long-press`, `swipe`, `scroll`, `text`, `key`, `keys`, `clear` |
| `app` | `list`, `launch`, `stop`, `restart`, `clear`, `info`, `install`, `uninstall`, `grant`, `revoke`, `current` |
| `screen` | `shot`, `record`, `rotate`, `state`, `wake`, `sleep`, `unlock` |
| `system` | `wifi`, `data`, `airplane`, `connectivity`, `logcat`, `clear-logcat`, `deeplink`, `broadcast`, `push`, `pull`, `setting`, `props`, `processes`, `memory`, `battery`, `notifications`, `shell` |
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
`wait <ms>` is available as a step for pauses:

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

Add `--continue-on-error` to run the remaining steps anyway and collect all the
failures. Steps can also come from a file (`--file steps.txt`, `#` comments
allowed) or from stdin (`batch -`).

**Piping JSON** — every `--json` payload is a single line, so `jq` works
directly:

```bash
adb-agent ui find "" --clickable --json | jq -r '.data.matches[].label'
adb-agent device list --json | jq -r '.data[] | select(.state=="device") | .serial'
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
  commands fail with the list of serials instead of guessing. Pass
  `-d <serial>` or export `ADB_SERIAL`.
- **A dumped tree is a snapshot.** Animations and async loads invalidate it, so
  prefer `ui wait <query>` over `wait 3000` before acting on a fresh screen.
- **WebViews expose little.** Inside a WebView the accessibility tree is often
  a single node. Fall back to normalized coordinates read off a screenshot.
- **`app clear` is destructive** — it wipes accounts, databases and caches. Use
  `app restart` when you only want a fresh process.
- **`screen record` blocks** for the whole duration and caps at 180 seconds.

## Environment

| Variable | Effect |
|----------|--------|
| `ADB_PATH` | Path to the adb binary (default: `adb` from PATH) |
| `ADB_SERIAL` | Default device serial for every command |
| `ADB_SETTLE_MS` | Delay after UI actions in ms (default 300) |
| `ADB_ARTIFACT_DIR` | Where screenshots/recordings are written (default cwd) |
| `ADB_SKILLS_DIR` | Override the folder holding these SKILL.md files |

## Reading this file from the CLI

`adb-agent skills list` and `adb-agent skills get adb-cli` print these guides, so
an agent that has the CLI but not the skill installed can still read them
without hunting for the file.
